import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { signPayload, verifySignature } from "../crypto";

// Private object storage (T5.1 — release blocking). No client-facing public
// URLs: files are reachable only through short-lived HMAC-signed URLs served
// by /api/v1/files, which verifies the signature and writes DocumentAccessLog.
//
// Drivers:
//  - local (dev/test): writes under .storage/
//  - blob  (production on Vercel): Vercel Blob. Blob URLs are public-but-
//    unguessable; the URL is stored only in Document.storageKey and never
//    rendered to clients — downloads still flow through the signed route with
//    the SHA-256 re-verified. Declared pilot tradeoff vs a strictly private
//    bucket; an S3/Supabase private-bucket driver is the 1B upgrade path.

export interface StorageDriver {
  /** Store bytes; returns the canonical storage key to persist on the Document row. */
  put(key: string, data: Buffer): Promise<string>;
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
    return key;
  },
  async get(key) {
    return readFile(safeLocalPath(key));
  },
};

const blobDriver: StorageDriver = {
  async put(key, data) {
    const { put } = await import("@vercel/blob");
    const blob = await put(key, data, {
      access: "public", // unguessable URL; treated as a server-side secret
      addRandomSuffix: true,
      contentType: "application/octet-stream",
    });
    return blob.url;
  },
  async get(key) {
    if (!/^https:\/\//.test(key)) throw new Error("Invalid blob storage key");
    const res = await fetch(key);
    if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  },
};

export function storage(): StorageDriver {
  return process.env.STORAGE_DRIVER === "blob" ? blobDriver : localDriver;
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
