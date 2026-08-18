import { prisma } from "../db";
import { type AuthzContext, require_ } from "../authz";
import { recordEvidence } from "../evidence";
import { formatDubaiDate, isoDate, todayInDubai } from "../calculators/dates";
import { EVIDENCE_LABELS, listEvidenceForTenancy } from "./evidenceQuery";
import { getTenancy } from "./tenancies";
import { logDocumentAccess } from "./documents";
import { buildEvidencePackPdf, type EvidencePackData } from "../pdf/evidencePackPdf";

export type { EvidencePackData };

// Lawyer-ready evidence pack per tenancy: chronology + document manifest with
// SHA-256 hashes. Honestly framed as a hash manifest, not a sealed chain.
// Zero enum churn: EVIDENCE_PACK_EXPORTED and DocAccessAction.EXPORTED were
// reserved unused; this is their first use.

export async function buildEvidencePack(ctx: AuthzContext, tenancyId: string): Promise<EvidencePackData> {
  require_(ctx, "evidence.export");
  const tenancy = await getTenancy(ctx, tenancyId);

  const [landlord, tenant, cases, chronology] = await Promise.all([
    tenancy.landlordContactId
      ? prisma.contact.findUnique({ where: { id: tenancy.landlordContactId } })
      : Promise.resolve(null),
    tenancy.tenantContactId
      ? prisma.contact.findUnique({ where: { id: tenancy.tenantContactId } })
      : Promise.resolve(null),
    prisma.renewalCase.findMany({
      where: { workspaceId: ctx.workspaceId, tenancyId },
      select: { id: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
    listEvidenceForTenancy(ctx, tenancyId),
  ]);

  const caseIds = cases.map((c) => c.id);
  const proofs = await prisma.proofRequest.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      OR: [
        { scopeType: "TENANCY", scopeId: tenancyId },
        { scopeType: "PROPERTY", scopeId: tenancy.propertyId },
        ...(caseIds.length ? [{ scopeType: "RENEWAL_CASE" as const, scopeId: { in: caseIds } }] : []),
        ...(tenancy.paymentItems.length
          ? [{ scopeType: "PAYMENT_ITEM" as const, scopeId: { in: tenancy.paymentItems.map((i) => i.id) } }]
          : []),
      ],
    },
    select: { id: true },
  });
  const proofIds = proofs.map((p) => p.id);

  const documents = await prisma.document.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      archivedAt: null,
      OR: [
        { scopeType: "TENANCY", scopeId: tenancyId },
        ...(caseIds.length ? [{ scopeType: "RENEWAL_CASE" as const, scopeId: { in: caseIds } }] : []),
        ...(proofIds.length ? [{ scopeType: "PROOF_REQUEST" as const, scopeId: { in: proofIds } }] : []),
      ],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fileName: true,
      kind: true,
      sizeBytes: true,
      sha256: true,
      createdAt: true,
      uploadedById: true,
    },
  });

  return {
    generatedAt: formatDubaiDate(todayInDubai()),
    tenancy: {
      id: tenancy.id,
      ejariNo: tenancy.ejariNo,
      startDate: tenancy.startDate,
      endDate: tenancy.endDate,
      annualRent: Number(tenancy.annualRent),
      status: tenancy.status,
    },
    property: {
      id: tenancy.property.id,
      community: tenancy.property.community,
      building: tenancy.property.building,
      unitNo: tenancy.property.unitNo,
    },
    parties: {
      landlord: landlord?.name ?? "not recorded",
      tenant: tenant?.name ?? "not recorded",
    },
    cases: cases.map((c) => ({ id: c.id, status: c.status })),
    chronology: chronology.map((e) => ({
      id: e.id,
      createdAt: e.createdAt,
      type: e.type,
      label: EVIDENCE_LABELS[e.type] ?? e.type,
      actorType: e.actorType,
    })),
    documents,
  };
}

export async function exportEvidencePack(ctx: AuthzContext, tenancyId: string): Promise<Buffer> {
  const pack = await buildEvidencePack(ctx, tenancyId);
  const pdf = await buildEvidencePackPdf(pack);

  for (const file of pack.documents) {
    // First use of the reserved EXPORTED access action. The pack identifies the
    // document by hash; it does not embed bytes (archiveDocument logs DELETED
    // for an archive for the same reason: the enum is the closest fit).
    await logDocumentAccess({
      workspaceId: ctx.workspaceId,
      documentId: file.id,
      actorUserId: ctx.userId,
      action: "EXPORTED",
    });
  }

  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "EVIDENCE_PACK_EXPORTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "TENANCY",
    scopeId: tenancyId,
    tenancyId,
    propertyId: pack.property.id,
    payload: {
      documentIds: pack.documents.map((d) => d.id),
      documentHashes: pack.documents.map((d) => d.sha256),
      eventCount: pack.chronology.length,
      generatedAt: pack.generatedAt,
    },
  });

  return pdf;
}

/** Filename for the Content-Disposition header. Date-only, Dubai calendar. */
export function evidencePackFilename(tenancyId: string, generatedAt = todayInDubai()): string {
  return `evidence-pack-${tenancyId.slice(0, 8)}-${isoDate(generatedAt)}.pdf`;
}
