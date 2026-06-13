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
//  - blob  (production on Vercel): Vercel Blob, configured as a PRIVATE store.
//    Bytes are reachable only via the SDK with BLOB_READ_WRITE_TOKEN — the
//    stored url is not publicly fetchable. Clients still download solely through
//    the signed, access-logged /api/v1/files route with SHA-256 re-verified.

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
      access: "private", // store is private; bytes reachable only via the token
      addRandomSuffix: true,
      contentType: "application/octet-stream",
    });
    return blob.url;
  },
  async get(key) {
    if (!/^https:\/\//.test(key)) throw new Error("Invalid blob storage key");
    const { get } = await import("@vercel/blob");
    const result = await get(key, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error(`Blob get failed for ${key}`);
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
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
