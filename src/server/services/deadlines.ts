import type { DeadlineKind, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, clientScope, require_, scope } from "../authz";
import { chequeDue, contractExpiry, noticeGate, renewalDate, type CalcResult } from "../calculators/dates";

// Deadline generation (T3.2): regenerated on every tenancy create/update and
// payment schedule change. Upsert semantics — never a duplicate open deadline;
// all open deadlines cancelled on tenancy archive.

type Db = Prisma.TransactionClient;

function computedFrom(calc: CalcResult): Prisma.InputJsonValue {
  return { rule: `${calc.rule}_${calc.version}`, inputs: calc.inputs } as Prisma.InputJsonValue;
}

async function upsertDeadline(
  db: Db,
  args: {
    workspaceId: string;
    tenancyId: string;
    propertyId: string;
    kind: DeadlineKind;
    calc: CalcResult;
    discriminator?: string; // e.g. payment item id for CHEQUE_DUE
  },
) {
  const existing = await db.deadline.findFirst({
    where: {
      workspaceId: args.workspaceId,
      tenancyId: args.tenancyId,
      kind: args.kind,
      status: "OPEN",
      ...(args.discriminator
        ? { computedFrom: { path: ["discriminator"], equals: args.discriminator } }
        : {}),
    },
  });
  const data = {
    dueAt: args.calc.date,
    computedFrom: {
      ...(computedFrom(args.calc) as object),
      ...(args.discriminator ? { discriminator: args.discriminator } : {}),
    } as Prisma.InputJsonValue,
  };
  if (existing) {
    return db.deadline.update({ where: { id: existing.id }, data });
  }
  return db.deadline.create({
    data: {
      workspaceId: args.workspaceId,
      tenancyId: args.tenancyId,
      propertyId: args.propertyId,
      kind: args.kind,
      status: "OPEN",
      ...data,
    },
  });
}

/** Recompute all deadlines for a tenancy from its current state. */
export async function regenerateDeadlinesForTenancy(tenancyId: string, db: Db = prisma) {
  const tenancy = await db.tenancy.findUnique({
    where: { id: tenancyId },
    include: { paymentItems: true },
  });
  if (!tenancy) throw new Error(`Tenancy ${tenancyId} not found`);

  if (tenancy.archivedAt) {
    await db.deadline.updateMany({
      where: { tenancyId, status: "OPEN" },
      data: { status: "CANCELLED" },
    });
    return;
  }

  const base = {
    workspaceId: tenancy.workspaceId,
    tenancyId: tenancy.id,
    propertyId: tenancy.propertyId,
  };
  const gate = noticeGate(tenancy.endDate, tenancy.noticePeriodDays);
  await upsertDeadline(db, { ...base, kind: "NOTICE_GATE", calc: gate });
  await upsertDeadline(db, { ...base, kind: "CONTRACT_EXPIRY", calc: contractExpiry(tenancy.endDate) });
  await upsertDeadline(db, { ...base, kind: "RENEWAL_DATE", calc: renewalDate(tenancy.endDate) });

  // cache for list views; authoritative rows live in Deadline
  await db.tenancy.update({ where: { id: tenancy.id }, data: { noticeGateAt: gate.date } });

  const activeItems = tenancy.paymentItems.filter((i) => i.status !== "CANCELLED");
  for (const item of activeItems) {
    await upsertDeadline(db, {
      ...base,
      kind: "CHEQUE_DUE",
      calc: chequeDue(item.dueDate),
      discriminator: item.id,
    });
  }
  // cancel cheque deadlines whose payment item disappeared or was cancelled
  const chequeDeadlines = await db.deadline.findMany({
    where: { tenancyId, kind: "CHEQUE_DUE", status: "OPEN" },
  });
  const liveIds = new Set(activeItems.map((i) => i.id));
  for (const d of chequeDeadlines) {
    const disc = (d.computedFrom as { discriminator?: string } | null)?.discriminator;
    if (disc && !liveIds.has(disc)) {
      await db.deadline.update({ where: { id: d.id }, data: { status: "CANCELLED" } });
    }
  }
}

// ── Calendar + list views (T3.3)

export interface DeadlineFilters {
  clientPrincipalId?: string;
  propertyId?: string;
  kind?: DeadlineKind;
  from?: Date;
  to?: Date;
}

export async function listDeadlines(ctx: AuthzContext, filters?: DeadlineFilters) {
  require_(ctx, "deadlines.read");
  const client = clientScope(ctx);
  return prisma.deadline.findMany({
    where: {
      ...scope(ctx),
      status: "OPEN",
      ...(filters?.kind ? { kind: filters.kind } : {}),
      ...(filters?.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters?.from || filters?.to
        ? { dueAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
      tenancy: {
        property: {
          ...(client.clientPrincipalId ? { clientPrincipalId: client.clientPrincipalId } : {}),
          ...(filters?.clientPrincipalId ? { clientPrincipalId: filters.clientPrincipalId } : {}),
        },
      },
    },
    orderBy: { dueAt: "asc" },
    include: { tenancy: { include: { property: true } } },
  });
}
