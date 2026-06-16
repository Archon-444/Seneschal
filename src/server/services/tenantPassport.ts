import { Prisma, type DocumentKind, type TenantPassport } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_ } from "../authz";
import { ingestDocument, logDocumentAccess } from "./documents";
import { recordEvidence } from "../evidence";
import { toUtcDateOnly } from "../calculators/dates";

// Tenant passport (1C) — a tenant's reusable rental profile, scoped to their own
// Contact (Membership.subjectContactId). The TENANT persona owns exactly one; the
// fail-closed boundary holds because every read is filtered by `contactId`, never
// scope(ctx) (which throws for a persona). Operators read by id within the workspace.

export interface PassportInput {
  employer?: string | null;
  jobTitle?: string | null;
  monthlyIncome?: number | null;
  nationality?: string | null;
  householdSize?: number | null;
  moveInBy?: Date | null;
  summary?: string | null;
  status?: "DRAFT" | "READY";
}

/** The persona's own Contact id, or throw — passport writes are TENANT-only. */
function tenantContactId(ctx: AuthzContext): string {
  if (ctx.role !== "TENANT" || !ctx.subjectContactId) {
    throw new AuthzError("Only a tenant can manage a passport", 403);
  }
  return ctx.subjectContactId;
}

/** The tenant's passport, created on first access so /passport always resolves. */
export async function getOrCreateMyPassport(ctx: AuthzContext): Promise<TenantPassport> {
  require_(ctx, "passport.read");
  const contactId = tenantContactId(ctx);
  const existing = await prisma.tenantPassport.findUnique({
    where: { workspaceId_contactId: { workspaceId: ctx.workspaceId, contactId } },
  });
  if (existing) return existing;
  return prisma.tenantPassport.create({
    data: { workspaceId: ctx.workspaceId, contactId },
  });
}

export async function updateMyPassport(ctx: AuthzContext, input: PassportInput): Promise<TenantPassport> {
  require_(ctx, "passport.write");
  const contactId = tenantContactId(ctx);
  const passport = await getOrCreateMyPassport(ctx);
  const data: Prisma.TenantPassportUncheckedUpdateInput = {};
  if (input.employer !== undefined) data.employer = input.employer;
  if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle;
  if (input.monthlyIncome !== undefined) {
    data.monthlyIncome = input.monthlyIncome == null ? null : new Prisma.Decimal(input.monthlyIncome);
  }
  if (input.nationality !== undefined) data.nationality = input.nationality;
  if (input.householdSize !== undefined) data.householdSize = input.householdSize;
  if (input.moveInBy !== undefined) data.moveInBy = input.moveInBy == null ? null : toUtcDateOnly(input.moveInBy);
  if (input.summary !== undefined) data.summary = input.summary;
  if (input.status !== undefined) data.status = input.status;
  return prisma.tenantPassport.update({
    where: { workspaceId_contactId: { workspaceId: ctx.workspaceId, contactId } },
    data,
  });
}

/**
 * Attach a supporting document to the tenant's own passport (1C #6). Reuses the
 * shared storage/ingest path; the document is scoped TENANT_PASSPORT so it is
 * reachable only through the owner's contact scope. Records DOCUMENT_UPLOADED.
 * Gated on passport.write so the tenant needs no broad documents.write.
 */
export async function uploadPassportDocument(
  ctx: AuthzContext,
  file: { fileName: string; mime: string; data: Buffer; kind?: DocumentKind },
) {
  require_(ctx, "passport.write");
  tenantContactId(ctx);
  const passport = await getOrCreateMyPassport(ctx);
  const doc = await ingestDocument({
    workspaceId: ctx.workspaceId,
    scopeType: "TENANT_PASSPORT",
    scopeId: passport.id,
    kind: file.kind ?? "ID_DOCUMENT",
    fileName: file.fileName,
    mime: file.mime,
    data: file.data,
    uploadedById: ctx.userId,
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
    scopeType: "TENANT_PASSPORT",
    scopeId: passport.id,
    payload: { documentId: doc.id, fileName: file.fileName, kind: doc.kind },
  });
  return doc;
}

/** The documents attached to the tenant's own passport (newest first). */
export async function listPassportDocuments(ctx: AuthzContext, passportId?: string) {
  require_(ctx, "passport.read");
  // Default to the caller's own passport; an explicit id is verified via getPassport.
  const passport = passportId ? await getPassport(ctx, passportId) : await getOrCreateMyPassport(ctx);
  return prisma.document.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      scopeType: "TENANT_PASSPORT",
      scopeId: passport.id,
      archivedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Read a passport by id, enforcing ownership: a TENANT may only read their own;
 *  operators (passport.read) may read any within their workspace. */
export async function getPassport(ctx: AuthzContext, id: string): Promise<TenantPassport> {
  require_(ctx, "passport.read");
  const passport = await prisma.tenantPassport.findUnique({ where: { id } });
  if (!passport || passport.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  if (ctx.subjectContactId && passport.contactId !== ctx.subjectContactId) {
    throw new AuthzError("Not found", 404);
  }
  return passport;
}
