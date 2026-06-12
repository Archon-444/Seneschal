import { prisma } from "../db";
import { generateOtp, generateToken, hashToken, sha256Hex } from "../crypto";
import { notify } from "../notify";
import { recordAudit } from "../audit";

// Email OTP auth (T1.1) behind a clean abstraction — swapping to a hosted
// provider replaces this module and the AuthOtp/Session tables only.

const OTP_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

export async function requestOtp(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  // Always behave identically whether or not the account exists.
  if (!user) return;

  const { code, codeHash } = generateOtp();
  await prisma.authOtp.create({
    data: { email: normalized, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
  });

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, revokedAt: null },
  });
  await notify({
    workspaceId: membership?.workspaceId ?? "system",
    channel: "EMAIL",
    templateCode: "auth_otp_v1",
    subject: "Your Seneschal sign-in code",
    body: `Your sign-in code is ${code}. It expires in 10 minutes.`,
    toUserId: user.id,
    toAddress: normalized,
  });
}

export async function verifyOtp(
  email: string,
  code: string,
  meta?: { ip?: string; device?: string },
): Promise<{ sessionToken: string } | null> {
  const normalized = email.trim().toLowerCase();
  const otp = await prisma.authOtp.findFirst({
    where: { email: normalized, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.attempts >= MAX_OTP_ATTEMPTS) return null;

  if (otp.codeHash !== sha256Hex(code.trim())) {
    await prisma.authOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return null;
  }

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user) return null;

  const { token, tokenHash } = generateToken();
  await prisma.$transaction([
    prisma.authOtp.update({ where: { id: otp.id }, data: { usedAt: new Date() } }),
    prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        ip: meta?.ip ?? null,
        device: meta?.device ?? null,
      },
    }),
  ]);
  await recordAudit({
    actorType: user.isStaff ? "STAFF" : "USER",
    actorId: user.id,
    verb: "session.create",
    objectType: "Session",
    ip: meta?.ip ?? null,
  });
  return { sessionToken: token };
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
