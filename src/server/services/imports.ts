import { Prisma, type ContactKind, type ImportSource, type ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_, scope } from "../authz";
import { recordAudit } from "../audit";
import { recordEvidence } from "../evidence";
import { toUtcDateOnly } from "../calculators/dates";
import { regenerateDeadlinesForTenancy } from "./deadlines";
import { evenChequeSchedule } from "./payments";
import { evaluateRiskForTenancy, raiseTenancyOverlap } from "./risk";
import { findContactReferences } from "./contactReferences";

// ImportBatch machinery (T6.1 — release blocking). Nothing writes to trusted
// records until commit; conflicts block the ROW, not the batch; commit is
// atomic; rollback archives created records via createdRecordRefs.

/**
 * One record a commit created (or one document scope it moved), remembered on
 * ImportRow.createdRecordRefs so rollback can undo exactly what was done.
 * `prior` is only set for DocumentScope, and carries the scope the document
 * held before the commit re-pointed it at the new tenancy.
 */
export interface ImportRecordRef {
  type: "Contact" | "Property" | "Tenancy" | "PaymentItem" | "DocumentScope";
  id: string;
  prior?: { scopeType: string; scopeId: string | null };
}

export interface ImportPartyFields {
  name?: string;
  emiratesId?: string;
  email?: string;
  phone?: string;
  nationality?: string;
  company?: string;
  licenseNo?: string;
  licensingAuthority?: string;
}

export interface ImportRowData {
  // property
  community: string;
  building?: string;
  unitNo?: string;
  propertyType?: string;
  bedrooms?: number;
  clientPrincipalId?: string;
  propertyId?: string;
  usage?: string;
  plotNo?: string;
  makaniNo?: string;
  dewaPremiseNo?: string;
  sizeSqm?: number;
  // tenancy
  ejariNo?: string;
  startDate: string; // ISO date
  endDate: string;
  annualRent: number;
  depositAmount?: number;
  noticePeriodDays?: number;
  paymentTermsNote?: string;
  // parties: reuse an existing contact by id, otherwise create/match from fields
  landlordContactId?: string;
  tenantContactId?: string;
  landlordName?: string;
  tenantName?: string;
  landlord?: ImportPartyFields;
  tenant?: ImportPartyFields;
  // payment schedule — extracted items win; chequeCount fills an even split when none
  chequeCount?: number;
  paymentItems?: {
    seq: number;
    dueDate: string;
    amount: number;
    instrument?: "CHEQUE" | "TRANSFER" | "DDS";
    chequeNo?: string;
    bank?: string;
  }[];
}

/** Collapse whitespace and case so "AL NOOR PROPERTIES LLC" matches the directory. */
export function normalizePartyName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export async function createImportBatch(
  ctx: AuthzContext,
  source: ImportSource,
  fileDocId?: string,
) {
  require_(ctx, "imports.manage");
  const batch = await prisma.importBatch.create({
    data: { workspaceId: ctx.workspaceId, source, fileDocId: fileDocId ?? null },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "import.create",
    objectType: "ImportBatch",
    objectId: batch.id,
  });
  return batch;
}

export async function addImportRows(
  ctx: AuthzContext,
  batchId: string,
  rows: { raw: Record<string, unknown>; mapped: ImportRowData }[],
) {
  require_(ctx, "imports.manage");
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  assertSameWorkspace(ctx, batch);
  if (batch!.status === "COMMITTED" || batch!.status === "ROLLED_BACK") {
    throw new AuthzError("Batch is finalized", 422);
  }
  for (const row of rows) {
    await prisma.importRow.create({
      data: {
        workspaceId: ctx.workspaceId,
        batchId,
        rawJson: row.raw as Prisma.InputJsonValue,
        mappedJson: row.mapped as unknown as Prisma.InputJsonValue,
      },
    });
  }
  await prisma.importBatch.update({ where: { id: batchId }, data: { status: "MAPPED" } });
  return detectConflicts(ctx, batchId);
}

/** Conflict pass: duplicate ejariNo, overlapping tenancy dates per property. Blocks rows. */
export async function detectConflicts(ctx: AuthzContext, batchId: string) {
  require_(ctx, "imports.manage");
  // scope-audit: operator-only (imports.manage); all matching is bounded to ctx.workspaceId
  // for de-duplication — no persona reaches this path.
  const rows = await prisma.importRow.findMany({
    where: { batchId, status: { in: ["PENDING", "CONFLICT"] } },
  });
  const seenEjari = new Set<string>();
  for (const row of rows) {
    const data = row.mappedJson as unknown as ImportRowData;
    let conflict: string | null = null;

    if (data.ejariNo) {
      if (seenEjari.has(data.ejariNo)) {
        conflict = `Duplicate ejariNo within batch: ${data.ejariNo}`;
      } else {
        seenEjari.add(data.ejariNo);
        const existing = await prisma.tenancy.findFirst({
          where: { workspaceId: ctx.workspaceId, ejariNo: data.ejariNo, archivedAt: null },
        });
        if (existing) conflict = `Duplicate ejariNo: ${data.ejariNo} already on record`;
      }
    }

    if (!conflict && data.community && data.unitNo) {
      const property = await prisma.property.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          community: data.community,
          building: data.building ?? null,
          unitNo: data.unitNo,
          archivedAt: null,
        },
      });
      if (property) {
        const overlap = await prisma.tenancy.findFirst({
          where: {
            propertyId: property.id,
            archivedAt: null,
            startDate: { lte: new Date(data.endDate) },
            endDate: { gte: new Date(data.startDate) },
          },
        });
        if (overlap) {
          conflict = `Overlapping tenancy dates for ${data.community} ${data.unitNo}`;
        }
      }
    }

    await prisma.importRow.update({
      where: { id: row.id },
      data: { status: conflict ? "CONFLICT" : "PENDING", conflictReason: conflict },
    });
  }
  return prisma.importRow.findMany({ where: { batchId }, orderBy: { id: "asc" } });
}

/**
 * Commit (atomic): accepted rows become Property/Tenancy/PaymentItem records;
 * CONFLICT and REJECTED rows are skipped — they block the row, not the batch.
 */
export async function commitImportBatch(ctx: AuthzContext, batchId: string) {
  require_(ctx, "imports.manage");
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { rows: true },
  });
  assertSameWorkspace(ctx, batch);
  if (batch!.status === "COMMITTED") throw new AuthzError("Batch already committed", 422);
  if (batch!.status === "ROLLED_BACK") throw new AuthzError("Batch was rolled back", 422);

  const committable = batch!.rows.filter((r) => r.status === "PENDING" || r.status === "ACCEPTED");
  const createdTenancyIds: string[] = [];
  // AuditEvent stores only a payloadHash, so the readable from/to of each
  // document move rides on the batch's evidence payload (MEDIUM-6).
  const documentRescopes: {
    documentId: string;
    from: { scopeType: string; scopeId: string | null };
    to: { scopeType: string; scopeId: string | null };
  }[] = [];

  await prisma.$transaction(async (tx) => {
    for (const row of committable) {
      const data = row.mappedJson as unknown as ImportRowData;
      const refs: ImportRecordRef[] = [];

      const landlord = await resolveImportParty(tx, ctx, {
        kind: "OWNER",
        contactId: data.landlordContactId,
        name: data.landlordName ?? data.landlord?.name,
        fields: data.landlord,
      });
      const tenant = await resolveImportParty(tx, ctx, {
        kind: "TENANT",
        contactId: data.tenantContactId,
        name: data.tenantName ?? data.tenant?.name,
        fields: data.tenant,
      });
      if (landlord.created && landlord.id) refs.push({ type: "Contact", id: landlord.id });
      if (tenant.created && tenant.id) refs.push({ type: "Contact", id: tenant.id });

      let property =
        (data.propertyId
          ? await tx.property.findFirst({
              where: { id: data.propertyId, workspaceId: ctx.workspaceId, archivedAt: null },
            })
          : null) ??
        (await tx.property.findFirst({
          where: {
            workspaceId: ctx.workspaceId,
            community: data.community,
            building: data.building ?? null,
            unitNo: data.unitNo ?? null,
            archivedAt: null,
          },
        }));
      if (!property) {
        property = await tx.property.create({
          data: {
            workspaceId: ctx.workspaceId,
            clientPrincipalId: data.clientPrincipalId ?? null,
            ownerContactId: landlord.id,
            community: data.community,
            building: data.building,
            unitNo: data.unitNo,
            propertyType: data.propertyType,
            bedrooms: data.bedrooms,
            usage: data.usage,
            plotNo: data.plotNo,
            makaniNo: data.makaniNo,
            dewaPremiseNo: data.dewaPremiseNo,
            sizeSqm: data.sizeSqm != null ? new Prisma.Decimal(data.sizeSqm) : undefined,
          },
        });
        refs.push({ type: "Property", id: property.id });
      } else if (!property.ownerContactId && landlord.id) {
        property = await tx.property.update({
          where: { id: property.id },
          data: { ownerContactId: landlord.id },
        });
      }

      const contractDocId = batch!.source === "DOCUMENTS" ? batch!.fileDocId : null;
      const tenancy = await tx.tenancy.create({
        data: {
          workspaceId: ctx.workspaceId,
          propertyId: property.id,
          landlordContactId: landlord.id,
          tenantContactId: tenant.id,
          ejariNo: data.ejariNo ?? null,
          startDate: toUtcDateOnly(new Date(data.startDate)),
          endDate: toUtcDateOnly(new Date(data.endDate)),
          annualRent: new Prisma.Decimal(data.annualRent),
          depositAmount:
            data.depositAmount != null ? new Prisma.Decimal(data.depositAmount) : null,
          noticePeriodDays: data.noticePeriodDays ?? 90,
          paymentTermsNote: data.paymentTermsNote,
          contractDocId,
          source: batch!.source === "EXCEL" ? "EXCEL" : "OCR",
        },
      });
      refs.push({ type: "Tenancy", id: tenancy.id });
      createdTenancyIds.push(tenancy.id);

      if (contractDocId) {
        const doc = await tx.document.findFirst({
          where: { id: contractDocId, workspaceId: ctx.workspaceId },
        });
        if (doc) {
          // scopeType/scopeId is permission-bearing: listDocuments and
          // contactScopedWhere resolve readability from it. Moving a document
          // that is already attached to another record would take it out of
          // that record's scope, so refuse rather than silently re-point.
          const attachedElsewhere =
            (doc.scopeType === "TENANCY" && doc.scopeId !== tenancy.id) ||
            (doc.scopeType === "PROPERTY" && doc.scopeId !== property.id);
          if (attachedElsewhere) {
            throw new AuthzError(
              "That document is already attached to another record; detach it first",
              422,
            );
          }
          const prior = { scopeType: doc.scopeType as string, scopeId: doc.scopeId };
          await tx.document.update({
            where: { id: contractDocId },
            data: { scopeType: "TENANCY", scopeId: tenancy.id },
          });
          // Remembered so rollback can put it back, and audited because a
          // scope change decides who can read the file.
          refs.push({ type: "DocumentScope", id: contractDocId, prior });
          documentRescopes.push({
            documentId: contractDocId,
            from: prior,
            to: { scopeType: "TENANCY", scopeId: tenancy.id },
          });
          await recordAudit(
            {
              workspaceId: ctx.workspaceId,
              actorType: ctx.isStaff ? "STAFF" : "USER",
              actorId: ctx.userId,
              onBehalfOfId: ctx.onBehalfOfId,
              verb: "document.rescope",
              objectType: "Document",
              objectId: contractDocId,
              payload: { from: prior, to: { scopeType: "TENANCY", scopeId: tenancy.id } },
            },
            tx,
          );
        }
      }

      const schedule = resolveSchedule(data);
      for (const item of schedule) {
        const created = await tx.paymentItem.create({
          data: {
            workspaceId: ctx.workspaceId,
            tenancyId: tenancy.id,
            seq: item.seq,
            dueDate: toUtcDateOnly(new Date(item.dueDate)),
            amount: new Prisma.Decimal(item.amount),
            instrument: item.instrument ?? "CHEQUE",
            chequeNo: item.chequeNo,
            bank: item.bank,
          },
        });
        refs.push({ type: "PaymentItem", id: created.id });
      }

      await tx.importRow.update({
        where: { id: row.id },
        data: { status: "ACCEPTED", createdRecordRefs: refs as unknown as Prisma.InputJsonValue },
      });
    }

    await tx.importBatch.update({
      where: { id: batchId },
      data: { status: "COMMITTED", committedAt: new Date(), reviewerId: ctx.userId },
    });

    await recordEvidence(
      {
        workspaceId: ctx.workspaceId,
        type: "IMPORT_COMMITTED",
        actorType: ctx.isStaff ? "STAFF" : "USER",
        actorId: ctx.userId,
        onBehalfOfId: ctx.onBehalfOfId,
        scopeType: "IMPORT_BATCH",
        scopeId: batchId,
        payload: {
          committedRows: committable.length,
          conflictRows: batch!.rows.filter((r) => r.status === "CONFLICT").length,
          documentRescopes,
        },
      },
      tx,
    );
    await recordAudit(
      {
        workspaceId: ctx.workspaceId,
        actorType: ctx.isStaff ? "STAFF" : "USER",
        actorId: ctx.userId,
        onBehalfOfId: ctx.onBehalfOfId,
        verb: "import.commit",
        objectType: "ImportBatch",
        objectId: batchId,
      },
      tx,
    );
  });

  // post-commit derivations (deadlines + risk) — outside the atomic write
  for (const tenancyId of createdTenancyIds) {
    await regenerateDeadlinesForTenancy(tenancyId);
    await evaluateRiskForTenancy(tenancyId);
  }
  // overlap flags for rows that were committed despite a same-batch sibling conflict
  for (const row of batch!.rows.filter((r) => r.status === "CONFLICT")) {
    const reason = row.conflictReason ?? "";
    if (reason.startsWith("Overlapping")) {
      // flag carried by the existing tenancy involved in the overlap
      const data = row.mappedJson as unknown as ImportRowData;
      const property = await prisma.property.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          community: data.community,
          unitNo: data.unitNo ?? null,
        },
      });
      if (property) {
        const overlapped = await prisma.tenancy.findFirst({
          where: { propertyId: property.id, archivedAt: null },
        });
        if (overlapped) await raiseTenancyOverlap(overlapped.id);
      }
    }
  }

  return prisma.importBatch.findUnique({ where: { id: batchId }, include: { rows: true } });
}

/** Rollback: archive every record the batch created (restore-of-visibility safe). */
export async function rollbackImportBatch(ctx: AuthzContext, batchId: string) {
  require_(ctx, "imports.manage");
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { rows: true },
  });
  assertSameWorkspace(ctx, batch);
  if (batch!.status !== "COMMITTED") throw new AuthzError("Only committed batches roll back", 422);

  const keptContacts: { id: string; referencedBy: string[] }[] = [];
  const documentRescopes: {
    documentId: string;
    from: { scopeType: string; scopeId: string | null };
    to: { scopeType: string; scopeId: string | null };
  }[] = [];

  await prisma.$transaction(async (tx) => {
    // Contacts are archived in a second pass, after this batch's own properties
    // and tenancies are archived, so a batch's own rows never count as the live
    // reference that keeps its contact alive (MEDIUM-7).
    const createdContactIds: string[] = [];

    for (const row of batch!.rows) {
      const refs = (row.createdRecordRefs as unknown as ImportRecordRef[] | null) ?? [];
      for (const ref of refs) {
        if (ref.type === "Property") {
          await tx.property.update({ where: { id: ref.id }, data: { archivedAt: new Date() } });
        } else if (ref.type === "Tenancy") {
          await tx.tenancy.update({
            where: { id: ref.id },
            data: { archivedAt: new Date(), status: "ARCHIVED" },
          });
          await tx.deadline.updateMany({
            where: { tenancyId: ref.id, status: "OPEN" },
            data: { status: "CANCELLED" },
          });
        } else if (ref.type === "PaymentItem") {
          await tx.paymentItem.update({ where: { id: ref.id }, data: { status: "CANCELLED" } });
        } else if (ref.type === "DocumentScope" && ref.prior) {
          // Commit re-pointed this document at the new tenancy, and scopeType/
          // scopeId is what decides who can read it. Undo the move so the file
          // does not stay attached to an archived tenancy (MEDIUM-6).
          const doc = await tx.document.findFirst({
            where: { id: ref.id, workspaceId: ctx.workspaceId },
          });
          if (doc) {
            await tx.document.update({
              where: { id: ref.id },
              data: { scopeType: ref.prior.scopeType as ScopeType, scopeId: ref.prior.scopeId },
            });
            const move = {
              documentId: ref.id,
              from: { scopeType: doc.scopeType as string, scopeId: doc.scopeId },
              to: ref.prior,
            };
            documentRescopes.push(move);
            await recordAudit(
              {
                workspaceId: ctx.workspaceId,
                actorType: ctx.isStaff ? "STAFF" : "USER",
                actorId: ctx.userId,
                onBehalfOfId: ctx.onBehalfOfId,
                verb: "document.rescope",
                objectType: "Document",
                objectId: ref.id,
                payload: { ...move, reason: "import.rollback" },
              },
              tx,
            );
          }
        } else if (ref.type === "Contact") {
          createdContactIds.push(ref.id);
        }
      }
    }

    for (const contactId of new Set(createdContactIds)) {
      const referencedBy = await findContactReferences(ctx.workspaceId, contactId, tx);
      if (referencedBy.length) {
        // A later batch reused this contact, or an operator attached it
        // elsewhere. Archiving it would blank a live record's counterparty, so
        // keep it and say so on the rollback evidence event.
        keptContacts.push({ id: contactId, referencedBy });
        continue;
      }
      await tx.contact.update({ where: { id: contactId }, data: { archivedAt: new Date() } });
    }
    await tx.importBatch.update({
      where: { id: batchId },
      data: { status: "ROLLED_BACK", rolledBackAt: new Date() },
    });
    await recordEvidence(
      {
        workspaceId: ctx.workspaceId,
        type: "IMPORT_ROLLED_BACK",
        actorType: ctx.isStaff ? "STAFF" : "USER",
        actorId: ctx.userId,
        onBehalfOfId: ctx.onBehalfOfId,
        scopeType: "IMPORT_BATCH",
        scopeId: batchId,
        payload: { rows: batch!.rows.length, keptContacts, documentRescopes },
      },
      tx,
    );
    await recordAudit(
      {
        workspaceId: ctx.workspaceId,
        actorType: ctx.isStaff ? "STAFF" : "USER",
        actorId: ctx.userId,
        onBehalfOfId: ctx.onBehalfOfId,
        verb: "import.rollback",
        objectType: "ImportBatch",
        objectId: batchId,
      },
      tx,
    );
  });

  return prisma.importBatch.findUnique({ where: { id: batchId }, include: { rows: true } });
}

export async function listImportBatches(ctx: AuthzContext) {
  require_(ctx, "imports.manage");
  return prisma.importBatch.findMany({
    where: scope(ctx),
    orderBy: { createdAt: "desc" },
    include: { rows: { select: { id: true, status: true } } },
  });
}

export async function getImportBatch(ctx: AuthzContext, id: string) {
  require_(ctx, "imports.manage");
  const batch = await prisma.importBatch.findUnique({
    where: { id },
    include: { rows: true },
  });
  assertSameWorkspace(ctx, batch);
  return batch!;
}

/** Excel/CSV template parsing (T6.2). Bad rows isolated, never failing the file. */
export function parseCsvRows(csv: string): { raw: Record<string, unknown>; mapped: ImportRowData | null; error?: string }[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const raw: Record<string, unknown> = {};
    headers.forEach((h, i) => (raw[h] = cells[i] ?? ""));
    try {
      const mapped: ImportRowData = {
        community: must(raw, "community"),
        building: str(raw, "building"),
        unitNo: str(raw, "unitNo"),
        propertyType: str(raw, "propertyType"),
        bedrooms: num(raw, "bedrooms"),
        ejariNo: str(raw, "ejariNo"),
        startDate: must(raw, "startDate"),
        endDate: must(raw, "endDate"),
        annualRent: mustNum(raw, "annualRent"),
        depositAmount: num(raw, "depositAmount"),
        noticePeriodDays: num(raw, "noticePeriodDays"),
        tenantName: str(raw, "tenantName"),
        landlordName: str(raw, "landlordName"),
      };
      return { raw, mapped };
    } catch (err) {
      return { raw, mapped: null, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function must(raw: Record<string, unknown>, key: string): string {
  const v = String(raw[key] ?? "").trim();
  if (!v) throw new Error(`Missing required column ${key}`);
  return v;
}
function str(raw: Record<string, unknown>, key: string): string | undefined {
  const v = String(raw[key] ?? "").trim();
  return v || undefined;
}
function num(raw: Record<string, unknown>, key: string): number | undefined {
  const v = String(raw[key] ?? "").trim();
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Column ${key} is not a number`);
  return n;
}
function mustNum(raw: Record<string, unknown>, key: string): number {
  const n = num(raw, key);
  if (n == null) throw new Error(`Missing required column ${key}`);
  return n;
}

function collapseName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function resolveSchedule(data: ImportRowData): NonNullable<ImportRowData["paymentItems"]> {
  if (data.paymentItems && data.paymentItems.length > 0) return data.paymentItems;
  if (!data.chequeCount || data.chequeCount <= 0) return [];
  return evenChequeSchedule({
    startDate: new Date(data.startDate),
    endDate: new Date(data.endDate),
    annualRent: data.annualRent,
    chequeCount: data.chequeCount,
  }).map((item) => ({
    seq: item.seq,
    dueDate: item.dueDate.toISOString().slice(0, 10),
    amount: item.amount,
    instrument: "CHEQUE" as const,
  }));
}

/**
 * Reuse an existing contact (explicit id, unique Emirates ID, or unique name of
 * the same kind) or create one. Multiple name matches never auto-bind — the
 * reviewer must pick. Called inside the import transaction.
 */
async function resolveImportParty(
  tx: Prisma.TransactionClient,
  ctx: AuthzContext,
  args: {
    kind: ContactKind;
    contactId?: string;
    name?: string;
    fields?: ImportPartyFields;
  },
): Promise<{ id: string | null; created: boolean }> {
  if (args.contactId) {
    const existing = await tx.contact.findFirst({
      where: { id: args.contactId, workspaceId: ctx.workspaceId, archivedAt: null },
    });
    if (!existing) throw new AuthzError("Contact not found", 404);
    return { id: existing.id, created: false };
  }

  const emiratesId = args.fields?.emiratesId?.trim() || undefined;
  if (emiratesId) {
    const byId = await tx.contact.findMany({
      where: { workspaceId: ctx.workspaceId, kind: args.kind, archivedAt: null, emiratesId },
    });
    if (byId.length === 1) return { id: byId[0].id, created: false };
  }

  const name = args.name?.trim() ? collapseName(args.name) : undefined;
  if (name) {
    const byName = await tx.contact.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        kind: args.kind,
        archivedAt: null,
        name: { equals: name, mode: "insensitive" },
      },
    });
    if (byName.length === 1) return { id: byName[0].id, created: false };
  }

  if (!name) return { id: null, created: false };

  const contact = await tx.contact.create({
    data: {
      workspaceId: ctx.workspaceId,
      kind: args.kind,
      name,
      emiratesId,
      email: args.fields?.email?.trim() || undefined,
      phone: args.fields?.phone?.trim() || undefined,
      nationality: args.fields?.nationality?.trim() || undefined,
      company: args.fields?.company?.trim() || undefined,
      licenseNo: args.fields?.licenseNo?.trim() || undefined,
      licensingAuthority: args.fields?.licensingAuthority?.trim() || undefined,
    },
  });
  await recordAudit(
    {
      workspaceId: ctx.workspaceId,
      actorType: ctx.isStaff ? "STAFF" : "USER",
      actorId: ctx.userId,
      onBehalfOfId: ctx.onBehalfOfId,
      verb: "contact.create",
      objectType: "Contact",
      objectId: contact.id,
    },
    tx,
  );
  return { id: contact.id, created: true };
}
