import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Generate an opaque token; only its hash is ever stored (T7.2). */
export function generateToken(bytes = 32): { token: string; tokenHash: string } {
  const token = randomBytes(bytes).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (!s) throw new Error("APP_SECRET is not set");
  return s;
}

/** HMAC-signed payload for signed expiring storage URLs (T5.1). */
export function signPayload(payload: string): string {
  return createHmac("sha256", appSecret()).update(payload).digest("base64url");
}

export function verifySignature(payload: string, signature: string): boolean {
  return constantTimeEqual(signPayload(payload), signature);
}

/** 6-digit OTP code. */
export function generateOtp(): { code: string; codeHash: string } {
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  return { code, codeHash: sha256Hex(code) };
}
