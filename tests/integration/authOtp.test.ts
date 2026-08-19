import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb } from "../helpers";
import { requestOtp, verifyOtp } from "@/server/auth";
import { sha256Hex } from "@/server/crypto";

// H8 — OTP throttling + single-live-code invariant.

const OTP_TTL_MS = 10 * 60 * 1000;
let email: string;

beforeEach(async () => {
  await resetDb();
  const W = await makeWorkspace("Auth WS");
  email = "otp-user@test.example";
  const user = await prisma.user.create({ data: { email, name: "OTP User" } });
  await prisma.membership.create({
    data: { workspaceId: W.workspaceId, userId: user.id, role: "FIDUCIARY" },
  });
});

describe("requestOtp throttling", () => {
  it("silently throttles a rapid resend (cooldown) — one live code, not two", async () => {
    await requestOtp(email);
    await requestOtp(email); // within the 60s cooldown → ignored
    const rows = await prisma.authOtp.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
  });

  it("does nothing (and creates nothing) for an unknown account", async () => {
    await requestOtp("nobody@test.example");
    expect(await prisma.authOtp.count({ where: { email: "nobody@test.example" } })).toBe(0);
  });

  it("a reissue invalidates the prior code and leaves exactly one live code", async () => {
    // Seed a known prior code, backdated past the cooldown so the reissue proceeds.
    const priorHash = sha256Hex("123456");
    const prior = await prisma.authOtp.create({
      data: {
        email,
        codeHash: priorHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        createdAt: new Date(Date.now() - 2 * 60_000),
      },
    });

    await requestOtp(email); // past cooldown → invalidate prior, issue new

    // prior code no longer verifies
    expect(await verifyOtp(email, "123456")).toBeNull();
    // prior row was expired in place (insert-only spirit: not deleted)
    const reread = await prisma.authOtp.findUnique({ where: { id: prior.id } });
    expect(reread!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    // exactly one live code remains (the new one)
    const live = await prisma.authOtp.findMany({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(live).toHaveLength(1);
  });
});

// Issue #56 acceptance criterion — MAX_OTP_ATTEMPTS is the brute-force ceiling
// on a six-digit code, so it needs a test that actually reaches it. The
// load-bearing assertion is the last one: once the ceiling is hit, even the
// CORRECT code stops working. A counter that increments but does not lock is
// indistinguishable from no counter at all.

describe("verifyOtp attempt ceiling (H8)", () => {
  const MAX_OTP_ATTEMPTS = 5;

  async function seedKnownCode(code: string) {
    return prisma.authOtp.create({
      data: {
        email,
        codeHash: sha256Hex(code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
  }

  it("locks the code out after MAX_OTP_ATTEMPTS wrong guesses, correct code included", async () => {
    const otp = await seedKnownCode("424242");

    for (let i = 1; i <= MAX_OTP_ATTEMPTS; i++) {
      expect(await verifyOtp(email, "000000")).toBeNull();
      const row = await prisma.authOtp.findUnique({ where: { id: otp.id } });
      expect(row!.attempts).toBe(i);
    }

    // the ceiling is now reached — the real code must no longer work
    expect(await verifyOtp(email, "424242")).toBeNull();
    // and no session was minted along the way
    expect(await prisma.session.count()).toBe(0);
    // the row is not consumed, so a lockout cannot be mistaken for a successful use
    const locked = await prisma.authOtp.findUnique({ where: { id: otp.id } });
    expect(locked!.usedAt).toBeNull();
  });

  it("a correct guess before the ceiling still signs in and consumes the code", async () => {
    const otp = await seedKnownCode("424242");
    for (let i = 0; i < MAX_OTP_ATTEMPTS - 1; i++) {
      expect(await verifyOtp(email, "000000")).toBeNull();
    }

    const result = await verifyOtp(email, "424242");
    expect(result?.sessionToken).toBeTruthy();
    const used = await prisma.authOtp.findUnique({ where: { id: otp.id } });
    expect(used!.usedAt).toBeTruthy();
    expect(await prisma.session.count()).toBe(1);
  });

  it("a locked-out code cannot be revived by exhausting attempts and re-verifying", async () => {
    await seedKnownCode("424242");
    for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) await verifyOtp(email, "000000");

    // repeated attempts past the ceiling stay refused and stop incrementing
    expect(await verifyOtp(email, "424242")).toBeNull();
    expect(await verifyOtp(email, "000000")).toBeNull();
    const row = await prisma.authOtp.findFirst({ where: { email } });
    expect(row!.attempts).toBe(MAX_OTP_ATTEMPTS);
  });
});
