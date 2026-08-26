import { describe, expect, it } from "vitest";
import {
  generateOtp,
  generateToken,
  hashPassword,
  hashToken,
  PasswordPolicyError,
  sha256Hex,
  signPayload,
  verifyPassword,
  verifySignature,
} from "@/server/crypto";

describe("crypto", () => {
  it("generateToken returns a token whose hash matches hashToken", () => {
    const { token, tokenHash } = generateToken();
    expect(hashToken(token)).toBe(tokenHash);
    expect(token).not.toBe(tokenHash);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("sha256Hex is stable", () => {
    expect(sha256Hex("seneschal")).toBe(sha256Hex(Buffer.from("seneschal")));
  });

  it("signed payloads verify and tampering fails", () => {
    const sig = signPayload("file:abc:123");
    expect(verifySignature("file:abc:123", sig)).toBe(true);
    expect(verifySignature("file:abc:124", sig)).toBe(false);
    expect(verifySignature("file:abc:123", sig + "x")).toBe(false);
  });

  it("otp codes are 6 digits and hashed", () => {
    const { code, codeHash } = generateOtp();
    expect(code).toMatch(/^\d{6}$/);
    expect(sha256Hex(code)).toBe(codeHash);
  });

  it("hashPassword is scrypt-encoded, never stores the plaintext, and round-trips", async () => {
    const hash = await hashPassword("test-passphrase");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(hash).not.toContain("test-passphrase");
    expect(await verifyPassword("test-passphrase", hash)).toBe(true);
    expect(await verifyPassword("wrong-passphrase", hash)).toBe(false);
    await expect(hashPassword("short")).rejects.toBeInstanceOf(PasswordPolicyError);
  });
});
