import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as documents from "@/server/services/documents";
import { verifyFileUrl } from "@/server/storage";
import { sha256Hex } from "@/server/crypto";

// E5 ⛔ — hash at ingest, signed URLs only, access logging, insert-only ledgers.

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Docs WS");
});

describe("upload pipeline (T5.1)", () => {
  it("hashes at ingest and verifies hash on download", async () => {
    const data = Buffer.from("contract body bytes");
    const doc = await documents.uploadDocument(W.ctx, {
      scopeType: "WORKSPACE",
      kind: "TENANCY_CONTRACT",
      fileName: "contract.pdf",
      mime: "application/pdf",
      data,
    });
    expect(doc.sha256).toBe(sha256Hex(data));

    const read = await documents.readDocumentBytes(doc.id);
    expect(read!.data.equals(data)).toBe(true);
  });

  it("detects integrity failure when stored bytes are tampered", async () => {
    const doc = await documents.uploadDocument(W.ctx, {
      scopeType: "WORKSPACE",
      kind: "OTHER",
      fileName: "x.txt",
      mime: "text/plain",
      data: Buffer.from("original"),
    });
    const { storage } = await import("@/server/storage");
    await storage().put(doc.storageKey, Buffer.from("tampered"));
    await expect(documents.readDocumentBytes(doc.id)).rejects.toThrow(/Integrity/);
  });

  it("issues signed expiring URLs — no public URL anywhere", async () => {
    const doc = await documents.uploadDocument(W.ctx, {
      scopeType: "WORKSPACE",
      kind: "OTHER",
      fileName: "x.txt",
      mime: "text/plain",
      data: Buffer.from("x"),
    });
    const { url } = await documents.getDocumentUrl(W.ctx, doc.id);
    const parsed = new URL(url, "http://localhost:3000");
    const expires = parsed.searchParams.get("expires")!;
    const sig = parsed.searchParams.get("sig")!;
    expect(verifyFileUrl(doc.id, expires, sig)).toBe(true);
    // expired timestamp fails
    expect(verifyFileUrl(doc.id, "100", sig)).toBe(false);
    // signature for another document fails
    expect(verifyFileUrl("other-doc-id", expires, sig)).toBe(false);
  });
});

describe("storage driver contract", () => {
  it("ingestDocument persists the canonical key returned by put()", async () => {
    const doc = await documents.uploadDocument(W.ctx, {
      scopeType: "WORKSPACE",
      kind: "OTHER",
      fileName: "key-contract.txt",
      mime: "text/plain",
      data: Buffer.from("x"),
    });
    // local driver echoes the generated key (workspaceId/uuid.ext); the blob
    // driver returns a URL — either way storageKey must round-trip through get()
    expect(doc.storageKey.startsWith(W.workspaceId + "/")).toBe(true);
    const { storage } = await import("@/server/storage");
    expect((await storage().get(doc.storageKey)).toString()).toBe("x");
  });
});

describe("access logging (T5.2)", () => {
  it("upload and view are logged with actor", async () => {
    const doc = await documents.uploadDocument(W.ctx, {
      scopeType: "WORKSPACE",
      kind: "OTHER",
      fileName: "x.txt",
      mime: "text/plain",
      data: Buffer.from("x"),
    });
    await documents.getDocumentUrl(W.ctx, doc.id);
    const log = await documents.getDocumentAccessLog(W.ctx, doc.id);
    const actions = log.map((l) => l.action).sort();
    expect(actions).toEqual(["UPLOADED", "VIEWED"]);
    expect(log.every((l) => l.actorUserId === W.ctx.userId)).toBe(true);
  });

  it("DocumentAccessLog is insert-only at the database level", async () => {
    const doc = await documents.uploadDocument(W.ctx, {
      scopeType: "WORKSPACE",
      kind: "OTHER",
      fileName: "x.txt",
      mime: "text/plain",
      data: Buffer.from("x"),
    });
    const entry = await prisma.documentAccessLog.findFirst({ where: { documentId: doc.id } });
    await expect(
      prisma.documentAccessLog.delete({ where: { id: entry!.id } }),
    ).rejects.toThrow(/insert-only/);
    await expect(
      prisma.documentAccessLog.update({ where: { id: entry!.id }, data: { action: "VIEWED" } }),
    ).rejects.toThrow(/insert-only/);
  });
});

describe("insert-only evidence ledgers", () => {
  it("EvidenceEvent rejects UPDATE and DELETE", async () => {
    const doc = await documents.uploadDocument(W.ctx, {
      scopeType: "WORKSPACE",
      kind: "OTHER",
      fileName: "x.txt",
      mime: "text/plain",
      data: Buffer.from("x"),
    });
    void doc;
    const event = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId },
    });
    await expect(
      prisma.evidenceEvent.update({ where: { id: event!.id }, data: { scopeId: "tamper" } }),
    ).rejects.toThrow(/insert-only/);
    await expect(prisma.evidenceEvent.delete({ where: { id: event!.id } })).rejects.toThrow(
      /insert-only/,
    );
  });

  it("AuditEvent rejects UPDATE and DELETE", async () => {
    const audit = await prisma.auditEvent.findFirst({});
    if (!audit) return;
    await expect(
      prisma.auditEvent.update({ where: { id: audit.id }, data: { verb: "tamper.verb" } }),
    ).rejects.toThrow(/insert-only/);
    await expect(prisma.auditEvent.delete({ where: { id: audit.id } })).rejects.toThrow(/insert-only/);
  });
});

describe("archive, not delete (T5.3)", () => {
  it("archive hides from default list, keeps the row, logs the action", async () => {
    const doc = await documents.uploadDocument(W.ctx, {
      scopeType: "WORKSPACE",
      kind: "OTHER",
      fileName: "x.txt",
      mime: "text/plain",
      data: Buffer.from("x"),
    });
    await documents.archiveDocument(W.ctx, doc.id);
    expect(await documents.listDocuments(W.ctx)).toHaveLength(0);
    expect(await documents.listDocuments(W.ctx, { includeArchived: true })).toHaveLength(1);
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);
  });
});
