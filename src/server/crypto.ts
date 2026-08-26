import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

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

/** 6-digit OTP code. Leftover helper; login no longer issues OTPs. */
export function generateOtp(): { code: string; codeHash: string } {
  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
  return { code, codeHash: sha256Hex(code) };
}

const scrypt = promisify(scryptCb);
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
export const MIN_PASSWORD_LENGTH = 10;

export class PasswordPolicyError extends Error {
  constructor(message = "Password must be at least 10 characters.") {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

export function assertPasswordPolicy(plain: string): void {
  if (typeof plain !== "string" || plain.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError();
  }
}

/** scrypt$N$r$p$salt$hash — salt and key are base64url. Never log the result. */
export async function hashPassword(plain: string): Promise<string> {
  assertPasswordPolicy(plain);
  const salt = randomBytes(16);
  const key = (await scrypt(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })) as Buffer;
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64url");
    expected = Buffer.from(parts[5], "base64url");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  const key = (await scrypt(plain, salt, expected.length, { N, r, p })) as Buffer;
  return key.length === expected.length && timingSafeEqual(key, expected);
}
