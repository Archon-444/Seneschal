import { Prisma, type ImportSource } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_, scope } from "../authz";
import { recordAudit } from "../audit";
import { recordEvidence } from "../evidence";
import { toUtcDateOnly } from "../calculators/dates";
import { regenerateDeadlinesForTenancy } from "./deadlines";
import { evaluateRiskForTenancy, raiseTenancyOverlap } from "./risk";

// ImportBatch machinery (T6.1 — release blocking). Nothing writes to trusted
// records until commit; conflicts block the ROW, not the batch; commit is
// atomic; rollback archives created records via createdRecordRefs.

export interface ImportRowData {
  // property
  community: string;
  building?: string;
  unitNo?: string;
  propertyType?: string;
  bedrooms?: number;
  clientPrincipalId?: string;
  // tenancy
  ejariNo?: string;
  startDate: string; // ISO date
  endDate: string;
  annualRent: number;
  depositAmount?: number;
  noticePeriodDays?: number;
  landlordName?: string;
  tenantName?: string;
  // payment schedule
  paymentItems?: {
    seq: number;
    dueDate: string;
    amount: number;
    instrument?: "CHEQUE" | "TRANSFER" | "DDS";
    chequeNo?: string;
    bank?: string;
  }[];
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

  await prisma.$transaction(async (tx) => {
    for (const row of committable) {
      const data = row.mappedJson as unknown as ImportRowData;
      const refs: { type: string; id: string }[] = [];

      let property = await tx.property.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          community: data.community,
          building: data.building ?? null,
          unitNo: data.unitNo ?? null,
          archivedAt: null,
        },
      });
      if (!property) {
        property = await tx.property.create({
          data: {
            workspaceId: ctx.workspaceId,
            clientPrincipalId: data.clientPrincipalId ?? null,
            community: data.community,
            building: data.building,
            unitNo: data.unitNo,
            propertyType: data.propertyType,
            bedrooms: data.bedrooms,
          },
        });
        refs.push({ type: "Property", id: property.id });
      }

      const tenancy = await tx.tenancy.create({
        data: {
          workspaceId: ctx.workspaceId,
          propertyId: property.id,
          ejariNo: data.ejariNo ?? null,
          startDate: toUtcDateOnly(new Date(data.startDate)),
          endDate: toUtcDateOnly(new Date(data.endDate)),
          annualRent: new Prisma.Decimal(data.annualRent),
          depositAmount:
            data.depositAmount != null ? new Prisma.Decimal(data.depositAmount) : null,
          noticePeriodDays: data.noticePeriodDays ?? 90,
          source: batch!.source === "EXCEL" ? "EXCEL" : "OCR",
        },
      });
      refs.push({ type: "Tenancy", id: tenancy.id });
      createdTenancyIds.push(tenancy.id);

      for (const item of data.paymentItems ?? []) {
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

  await prisma.$transaction(async (tx) => {
    for (const row of batch!.rows) {
      const refs = (row.createdRecordRefs as { type: string; id: string }[] | null) ?? [];
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
        }
      }
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
        payload: { rows: batch!.rows.length },
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
