import type { DocAccessAction, DocumentKind, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, assertSameWorkspace, require_, scope } from "../authz";
import { sha256Hex } from "../crypto";
import { newStorageKey, signedFileUrl, storage } from "../storage";
import { recordEvidence } from "../evidence";

// Documents (E5). SHA-256 at ingest; every touch goes to DocumentAccessLog
// (T5.2 — its own insert-only table, never buried in AuditEvent); downloads
// only via signed expiring URLs (T5.1).

export interface UploadInput {
  scopeType: ScopeType;
  scopeId?: string;
  kind: DocumentKind;
  fileName: string;
  mime: string;
  data: Buffer;
}

export async function uploadDocument(ctx: AuthzContext, input: UploadInput) {
  require_(ctx, "documents.write");
  const doc = await ingestDocument({
    workspaceId: ctx.workspaceId,
    uploadedById: ctx.userId,
    ...input,
  });
  await logDocumentAccess({
    workspaceId: ctx.workspaceId,
    documentId: doc.id,
    actorUserId: ctx.userId,
    action: "UPLOADED",
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "DOCUMENT_UPLOADED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    payload: { documentId: doc.id, fileName: input.fileName, sha256: doc.sha256 },
  });
  return doc;
}

/** Shared ingest path (also used by secure-link uploads and email intake). */
export async function ingestDocument(args: {
  workspaceId: string;
  scopeType: ScopeType;
  scopeId?: string;
  kind: DocumentKind;
  fileName: string;
  mime: string;
  data: Buffer;
  uploadedById?: string;
  secureLinkId?: string;
}) {
  const sha256 = sha256Hex(args.data);
  const storageKey = newStorageKey(args.workspaceId, args.fileName);
  await storage().put(storageKey, args.data);
  return prisma.document.create({
    data: {
      workspaceId: args.workspaceId,
      scopeType: args.scopeType,
      scopeId: args.scopeId ?? null,
      kind: args.kind,
      fileName: args.fileName,
      mime: args.mime,
      sizeBytes: args.data.length,
      storageKey,
      sha256,
      uploadedById: args.uploadedById ?? null,
      secureLinkId: args.secureLinkId ?? null,
    },
  });
}

export async function logDocumentAccess(args: {
  workspaceId: string;
  documentId: string;
  action: DocAccessAction;
  actorUserId?: string;
  secureLinkId?: string;
  ip?: string;
  device?: string;
}) {
  return prisma.documentAccessLog.create({
    data: {
      workspaceId: args.workspaceId,
      documentId: args.documentId,
      actorUserId: args.actorUserId ?? null,
      secureLinkId: args.secureLinkId ?? null,
      action: args.action,
      ip: args.ip ?? null,
      device: args.device ?? null,
    },
  });
}

export async function listDocuments(
  ctx: AuthzContext,
  opts?: { scopeType?: ScopeType; scopeId?: string; kind?: DocumentKind; includeArchived?: boolean },
) {
  require_(ctx, "documents.read");
  return prisma.document.findMany({
    where: {
      ...scope(ctx),
      ...(opts?.scopeType ? { scopeType: opts.scopeType } : {}),
      ...(opts?.scopeId ? { scopeId: opts.scopeId } : {}),
      ...(opts?.kind ? { kind: opts.kind } : {}),
      ...(opts?.includeArchived ? {} : { archivedAt: null }),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getDocument(ctx: AuthzContext, id: string) {
  require_(ctx, "documents.read");
  const doc = await prisma.document.findUnique({ where: { id } });
  assertSameWorkspace(ctx, doc);
  return doc;
}

/** Issue a signed expiring URL and log the VIEW intent. */
export async function getDocumentUrl(ctx: AuthzContext, id: string) {
  const doc = await getDocument(ctx, id);
  await logDocumentAccess({
    workspaceId: ctx.workspaceId,
    documentId: id,
    actorUserId: ctx.userId,
    action: "VIEWED",
  });
  return { url: signedFileUrl(id), fileName: doc!.fileName, mime: doc!.mime };
}

/** Fetch bytes for a signed-URL download; verifies stored hash (T5.1 AC). */
export async function readDocumentBytes(documentId: string) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return null;
  const data = await storage().get(doc.storageKey);
  if (sha256Hex(data) !== doc.sha256) {
    throw new Error(`Integrity failure: stored hash mismatch for document ${documentId}`);
  }
  return { doc, data };
}

export async function archiveDocument(ctx: AuthzContext, id: string) {
  require_(ctx, "documents.write");
  await getDocument(ctx, id);
  const doc = await prisma.document.update({ where: { id }, data: { archivedAt: new Date() } });
  await logDocumentAccess({
    workspaceId: ctx.workspaceId,
    documentId: id,
    actorUserId: ctx.userId,
    action: "DELETED", // archive action logged under DELETED enum; row remains
  });
  return doc;
}

export async function getDocumentAccessLog(ctx: AuthzContext, documentId: string) {
  require_(ctx, "documents.read");
  await getDocument(ctx, documentId);
  return prisma.documentAccessLog.findMany({
    where: { documentId },
    orderBy: { createdAt: "desc" },
  });
}
