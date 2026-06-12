import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { signPayload, verifySignature } from "../crypto";

// Private object storage (T5.1 — release blocking). No public URLs anywhere:
// files are reachable only through short-lived HMAC-signed URLs served by
// /api/v1/files, which verifies the signature and writes DocumentAccessLog.
// The local driver writes under .storage/; an S3-compatible driver slots in
// behind the same interface.

export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

function localDir(): string {
  return process.env.STORAGE_LOCAL_DIR ?? ".storage";
}

function safeLocalPath(key: string): string {
  const path = normalize(join(localDir(), key));
  if (!path.startsWith(normalize(localDir()))) throw new Error("Invalid storage key");
  return path;
}

const localDriver: StorageDriver = {
  async put(key, data) {
    const path = safeLocalPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  },
  async get(key) {
    return readFile(safeLocalPath(key));
  },
};

export function storage(): StorageDriver {
  // STORAGE_DRIVER=s3 reserved; local is the 1A dev/test driver.
  return localDriver;
}

export function newStorageKey(workspaceId: string, fileName: string): string {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return `${workspaceId}/${randomUUID()}${ext}`;
}

const DEFAULT_TTL_SECONDS = 300;

/** Build a signed, expiring download URL for a document. */
export function signedFileUrl(documentId: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signPayload(`file:${documentId}:${expires}`);
  return `/api/v1/files/${documentId}?expires=${expires}&sig=${sig}`;
}

export function verifyFileUrl(documentId: string, expires: string, sig: string): boolean {
  const exp = Number(expires);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return verifySignature(`file:${documentId}:${exp}`, sig);
}
