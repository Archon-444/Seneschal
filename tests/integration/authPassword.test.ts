import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb } from "../helpers";
import {
  LOGIN_FAILED_MESSAGE,
  MAX_LOGIN_FAILURES,
  loginWithPassword,
  requestPasswordReset,
  resetPassword,
  setUserPassword,
} from "@/server/auth";
import { hashToken } from "@/server/crypto";

// Password door: unknown emails share the same failure message, lockout after
// MAX_LOGIN_FAILURES includes the correct password, reset tokens are hashed
// and single-use.

const PASSWORD = "test-passphrase";
const WRONG = "wrong-passphrase";
let email: string;
let userId: string;

beforeEach(async () => {
  await resetDb();
  const W = await makeWorkspace("Auth WS");
  email = "pwd-user@test.example";
  const user = await prisma.user.create({ data: { email, name: "Password User" } });
  userId = user.id;
  await prisma.membership.create({
    data: { workspaceId: W.workspaceId, userId: user.id, role: "FIDUCIARY" },
  });
  await setUserPassword(userId, PASSWORD);
});

function payloadBody(payload: unknown): string | undefined {
  return (payload as { body?: string } | null)?.body;
}

function tokenFromResetMail(payload: unknown): string {
  const match = payloadBody(payload)?.match(/\/login\/reset\/([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error("reset mail did not carry a token URL");
  return match[1];
}

describe("loginWithPassword", () => {
  it("returns the same message for an unknown email and a wrong password", async () => {
    const unknown = await loginWithPassword("nobody@test.example", PASSWORD);
    const wrong = await loginWithPassword(email, WRONG);
    expect(unknown).toEqual({ error: LOGIN_FAILED_MESSAGE });
    expect(wrong).toEqual({ error: LOGIN_FAILED_MESSAGE });
    expect(await prisma.session.count()).toBe(0);
  });

  it("signs in on the correct password and mints a session", async () => {
    const result = await loginWithPassword(email, PASSWORD);
    expect("sessionToken" in result && result.sessionToken.length).toBeGreaterThan(16);
    expect(await prisma.session.count()).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLoginCount).toBe(0);
    expect(user.loginLockedUntil).toBeNull();
  });

  it("locks the account after MAX_LOGIN_FAILURES wrong guesses, correct password included", async () => {
    for (let i = 1; i <= MAX_LOGIN_FAILURES; i++) {
      expect(await loginWithPassword(email, WRONG)).toEqual({ error: LOGIN_FAILED_MESSAGE });
      const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(row.failedLoginCount).toBe(i);
    }

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(locked.loginLockedUntil).not.toBeNull();
    expect(locked.loginLockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // the ceiling is now reached — the real password must no longer work
    expect(await loginWithPassword(email, PASSWORD)).toEqual({ error: LOGIN_FAILED_MESSAGE });
    expect(await prisma.session.count()).toBe(0);

    // further attempts while locked do not keep incrementing
    expect(await loginWithPassword(email, WRONG)).toEqual({ error: LOGIN_FAILED_MESSAGE });
    const still = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(still.failedLoginCount).toBe(MAX_LOGIN_FAILURES);
  });

  it("a correct guess before the ceiling still signs in and clears the counter", async () => {
    for (let i = 0; i < MAX_LOGIN_FAILURES - 1; i++) {
      expect(await loginWithPassword(email, WRONG)).toEqual({ error: LOGIN_FAILED_MESSAGE });
    }
    const result = await loginWithPassword(email, PASSWORD);
    expect("sessionToken" in result).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.failedLoginCount).toBe(0);
    expect(user.loginLockedUntil).toBeNull();
  });
});

describe("password reset", () => {
  it("does nothing (and creates nothing) for an unknown account", async () => {
    await requestPasswordReset("nobody@test.example");
    expect(await prisma.passwordReset.count()).toBe(0);
  });

  it("silently throttles a rapid resend (cooldown) — one live token, not two", async () => {
    await requestPasswordReset(email);
    await requestPasswordReset(email);
    const rows = await prisma.passwordReset.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
  });

  it("stores only the hash; a reissue invalidates the prior token", async () => {
    await requestPasswordReset(email);
    const prior = await prisma.passwordReset.findFirstOrThrow({ where: { userId } });
    await prisma.passwordReset.update({
      where: { id: prior.id },
      data: { createdAt: new Date(Date.now() - 2 * 60_000) },
    });

    await requestPasswordReset(email);

    const reread = await prisma.passwordReset.findUniqueOrThrow({ where: { id: prior.id } });
    expect(reread.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());

    const live = await prisma.passwordReset.findMany({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(live).toHaveLength(1);
    expect(live[0]!.tokenHash).not.toBe(prior.tokenHash);
  });

  it("the mailed token verifies against the stored hash, is single-use, and refuses expiry", async () => {
    await requestPasswordReset(email);
    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    const token = tokenFromResetMail(ob.payload);
    const row = await prisma.passwordReset.findFirstOrThrow({ where: { userId, usedAt: null } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toBe(token);

    const first = await resetPassword(token, "new-passphrase");
    expect("sessionToken" in first).toBe(true);

    const reused = await resetPassword(token, "other-passphrase");
    expect(reused).toEqual({ error: "This reset link is no longer valid." });

    await prisma.passwordReset.updateMany({
      where: { userId },
      data: { createdAt: new Date(Date.now() - 2 * 60_000) },
    });
    await requestPasswordReset(email);
    const latest = await prisma.outbox.findFirstOrThrow({
      where: { topic: "notification.send" },
      orderBy: { createdAt: "desc" },
    });
    const expiredToken = tokenFromResetMail(latest.payload);
    const live = await prisma.passwordReset.findFirstOrThrow({
      where: { tokenHash: hashToken(expiredToken) },
    });
    await prisma.passwordReset.update({
      where: { id: live.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await resetPassword(expiredToken, "fresh-passphrase")).toEqual({
      error: "This reset link is no longer valid.",
    });
  });

  it("after reset, the new password signs in and the old one does not", async () => {
    await requestPasswordReset(email);
    const ob = await prisma.outbox.findFirstOrThrow({ where: { topic: "notification.send" } });
    const token = tokenFromResetMail(ob.payload);
    await resetPassword(token, "rotated-passphrase");

    expect(await loginWithPassword(email, PASSWORD)).toEqual({ error: LOGIN_FAILED_MESSAGE });
    const next = await loginWithPassword(email, "rotated-passphrase");
    expect("sessionToken" in next).toBe(true);
  });
});
