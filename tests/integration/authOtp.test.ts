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
