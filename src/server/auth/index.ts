import { prisma } from "../db";
import {
  assertPasswordPolicy,
  generateToken,
  hashPassword,
  hashToken,
  PasswordPolicyError,
  verifyPassword,
} from "../crypto";
import { notify } from "../notify";
import { recordAudit } from "../audit";

// Email + password behind the same Session table the OTP door used.
// Swapping to OIDC later mints the same hashed session cookie; authorization
// stays membership + role. Tenants and one-shot sign-off stay on SecureLink.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const RESET_COOLDOWN_MS = 60 * 1000;

export const LOGIN_FAILED_MESSAGE = "Invalid email or password.";

let dummyHashPromise: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(`dummy-not-a-password:${process.env.APP_SECRET ?? "dev"}`);
  return dummyHashPromise;
}

async function spendOnPassword(plain: string, stored: string | null): Promise<boolean> {
  if (stored) return verifyPassword(plain, stored);
  await verifyPassword(plain, await dummyPasswordHash());
  return false;
}

export async function createSession(
  userId: string,
  isPlatformAdmin: boolean,
  meta?: { ip?: string; device?: string },
): Promise<string> {
  const { token, tokenHash } = generateToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: meta?.ip ?? null,
      device: meta?.device ?? null,
    },
  });
  await recordAudit({
    actorType: isPlatformAdmin ? "STAFF" : "USER",
    actorId: userId,
    verb: "session.create",
    objectType: "Session",
    ip: meta?.ip ?? null,
  });
  return token;
}

export async function setUserPassword(userId: string, plain: string): Promise<void> {
  assertPasswordPolicy(plain);
  const passwordHash = await hashPassword(plain);
  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      passwordSetAt: new Date(),
      failedLoginCount: 0,
      loginLockedUntil: null,
    },
  });
}

/**
 * Sign in. Unknown emails, missing passwords, wrong passwords, and lockouts
 * all return the same message. A lockout after MAX_LOGIN_FAILURES refuses even
 * the correct password until loginLockedUntil.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  meta?: { ip?: string; device?: string },
): Promise<{ sessionToken: string } | { error: string }> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  const locked = user?.loginLockedUntil != null && user.loginLockedUntil.getTime() > Date.now();
  const matches = await spendOnPassword(password, user?.passwordHash ?? null);
  if (!user || locked || !matches) {
    if (user && !locked) {
      const nextCount = user.failedLoginCount + 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: nextCount,
          loginLockedUntil: nextCount >= MAX_LOGIN_FAILURES ? new Date(Date.now() + LOGIN_LOCK_MS) : user.loginLockedUntil,
        },
      });
    }
    return { error: LOGIN_FAILED_MESSAGE };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, loginLockedUntil: null },
  });
  const sessionToken = await createSession(user.id, user.isPlatformAdmin, meta);
  return { sessionToken };
}

/**
 * Always succeeds from the caller's point of view. If the email has a user,
 * a reset token is minted (prior live tokens expired) and mailed. The raw
 * token is never stored. Cooldown is silent so a victim inbox cannot be flooded.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return;

  const recent = await prisma.passwordReset.findFirst({
    where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (recent) return;

  await prisma.passwordReset.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date() },
  });

  const { token, tokenHash } = generateToken();
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MS),
    },
  });

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, revokedAt: null },
  });
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  const url = `${base}/login/reset/${token}`;
  await notify({
    workspaceId: membership?.workspaceId ?? "system",
    channel: "EMAIL",
    templateCode: "auth_reset_v1",
    subject: "Reset your Seneschal password",
    body: `Reset your password using this one-time link (expires in 1 hour):\n${url}`,
    toUserId: user.id,
    toAddress: normalized,
  });
}

export async function resetPassword(
  token: string,
  plain: string,
  meta?: { ip?: string; device?: string },
): Promise<{ sessionToken: string } | { error: string }> {
  try {
    assertPasswordPolicy(plain);
  } catch (e) {
    if (e instanceof PasswordPolicyError) return { error: e.message };
    throw e;
  }

  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    return { error: "This reset link is no longer valid." };
  }

  const user = await prisma.user.findUnique({ where: { id: row.userId } });
  if (!user) return { error: "This reset link is no longer valid." };

  const passwordHash = await hashPassword(plain);
  await prisma.$transaction([
    prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null, id: { not: row.id } },
      data: { expiresAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        failedLoginCount: 0,
        loginLockedUntil: null,
      },
    }),
  ]);
  const sessionToken = await createSession(user.id, user.isPlatformAdmin, meta);
  return { sessionToken };
}

export async function sessionUser(sessionToken: string | undefined) {
  if (!sessionToken) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(sessionToken) },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
}

export async function revokeSession(sessionToken: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(sessionToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export { MAX_LOGIN_FAILURES, PasswordPolicyError };
