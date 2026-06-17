import type { DeadlineKind, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, isDelegateRole, require_, scope } from "../authz";
import { recordAudit } from "../audit";
import { resolveClientScopeIds } from "./clientScope";
import { contactScopedWhere } from "./contactScope";
import { assertClientInDelegateScope, clientSetScopedWhere, resolveDelegateScopeIds } from "./delegateScope";
import { chequeDue, contractExpiry, noticeGate, renewalDate, toUtcDateOnly, type CalcResult } from "../calculators/dates";

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

/**
 * Keep a listing's RERA permit-expiry deadline (1B #3) in sync with its current
 * state. A live listing with a permit expiry date carries one OPEN PERMIT_EXPIRY
 * deadline (property-scoped, no tenancy); clearing the date or archiving the
 * listing cancels it. Discriminated by listing id so re-runs never duplicate.
 */
export async function syncListingPermitDeadline(
  listing: {
    id: string;
    workspaceId: string;
    propertyId: string;
    permitExpiry: Date | null;
    permitRef: string | null;
    status: string;
    archivedAt: Date | null;
  },
  db: Db = prisma,
) {
  const existing = await db.deadline.findFirst({
    where: {
      workspaceId: listing.workspaceId,
      kind: "PERMIT_EXPIRY",
      status: "OPEN",
      computedFrom: { path: ["discriminator"], equals: listing.id },
    },
  });
  const active = listing.permitExpiry != null && listing.status !== "ARCHIVED" && listing.archivedAt == null;
  if (!active) {
    if (existing) await db.deadline.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });
    return existing ? { ...existing, status: "CANCELLED" } : null;
  }
  const data = {
    dueAt: toUtcDateOnly(listing.permitExpiry!),
    computedFrom: {
      rule: "listing_permit_v1",
      discriminator: listing.id,
      listingId: listing.id,
      permitRef: listing.permitRef,
    } as Prisma.InputJsonValue,
  };
  if (existing) return db.deadline.update({ where: { id: existing.id }, data });
  return db.deadline.create({
    data: {
      workspaceId: listing.workspaceId,
      propertyId: listing.propertyId,
      tenancyId: null,
      kind: "PERMIT_EXPIRY",
      status: "OPEN",
      ...data,
    },
  });
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
  // Scope by the deadline's own property/tenancy (so manual, standalone deadlines
  // with no tenancy are still included): a persona to their Contact's records, a
  // CLIENT_VIEWER (or explicit filter) to a client's.
  let base: Prisma.DeadlineWhereInput;
  if (ctx.subjectContactId) {
    base = await contactScopedWhere(ctx, "DEADLINE");
  } else if (isDelegateRole(ctx.role)) {
    base = await clientSetScopedWhere(ctx, "DEADLINE");
  } else {
    base = { ...scope(ctx) };
    const clientId = ctx.clientPrincipalId ?? filters?.clientPrincipalId;
    if (clientId) {
      const ids = await resolveClientScopeIds(ctx.workspaceId, clientId);
      base.OR = [{ propertyId: { in: ids.propertyIds } }, { tenancyId: { in: ids.tenancyIds } }];
    }
  }
  return prisma.deadline.findMany({
    where: {
      ...base,
      status: "OPEN",
      ...(filters?.kind ? { kind: filters.kind } : {}),
      ...(filters?.propertyId ? { propertyId: filters.propertyId } : {}),
      ...(filters?.from || filters?.to
        ? { dueAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
        : {}),
    },
    orderBy: { dueAt: "asc" },
    include: { tenancy: { include: { property: true } } },
  });
}

/** Display label for a deadline — manual entries carry a title in computedFrom. */
export function deadlineLabel(d: { kind: DeadlineKind; computedFrom: unknown }): string {
  const cf = d.computedFrom as { rule?: string; title?: string } | null;
  if (cf?.title) return cf.title;
  return d.kind.replace(/_/g, " ");
}

/** A manual calendar entry (as opposed to a tenancy/Ejari-derived deadline). */
export function isManualDeadline(d: { computedFrom: unknown }): boolean {
  return (d.computedFrom as { rule?: string } | null)?.rule === "manual";
}

export interface ManualDeadlineInput {
  title: string;
  dueAt: Date;
  kind?: DeadlineKind;
  propertyId?: string;
  tenancyId?: string;
  note?: string;
}

/** Manual calendar entry (T3.3). Stored as a Deadline; title/note in computedFrom. */
export async function createManualDeadline(ctx: AuthzContext, input: ManualDeadlineInput) {
  require_(ctx, "deadlines.write");
  let propertyId = input.propertyId ?? null;
  if (isDelegateRole(ctx.role) && !input.tenancyId && !propertyId) {
    // A delegate may only create a deadline attached to an in-scope property/tenancy;
    // an unscoped workspace-level entry would sit outside its client boundary.
    throw new AuthzError("A delegate must attach a deadline to a property or tenancy", 422);
  }
  if (input.tenancyId) {
    const tenancy = await prisma.tenancy.findUnique({ where: { id: input.tenancyId }, include: { property: true } });
    if (isDelegateRole(ctx.role)) {
      assertClientInDelegateScope(
        ctx,
        tenancy ? { workspaceId: tenancy.workspaceId, clientPrincipalId: tenancy.property.clientPrincipalId } : null,
      );
    } else {
      assertSameWorkspace(ctx, tenancy);
    }
    propertyId = propertyId ?? tenancy!.propertyId;
  } else if (propertyId) {
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (isDelegateRole(ctx.role)) assertClientInDelegateScope(ctx, property);
    else assertSameWorkspace(ctx, property);
  }
  const deadline = await prisma.deadline.create({
    data: {
      workspaceId: ctx.workspaceId,
      kind: input.kind ?? "CUSTOM",
      dueAt: toUtcDateOnly(input.dueAt),
      status: "OPEN",
      propertyId,
      tenancyId: input.tenancyId ?? null,
      computedFrom: { rule: "manual", title: input.title, note: input.note ?? null } as Prisma.InputJsonValue,
    },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "deadline.create",
    objectType: "Deadline",
    objectId: deadline.id,
  });
  return deadline;
}

/** Mark a calendar entry done or cancelled (T3.3). */
export async function setDeadlineStatus(ctx: AuthzContext, id: string, status: "DONE" | "CANCELLED") {
  require_(ctx, "deadlines.write");
  const deadline = await prisma.deadline.findUnique({ where: { id } });
  if (isDelegateRole(ctx.role)) {
    if (!deadline || deadline.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
    const ids = await resolveDelegateScopeIds(ctx);
    const inScope =
      (!!deadline.propertyId && ids.propertyIds.includes(deadline.propertyId)) ||
      (!!deadline.tenancyId && ids.tenancyIds.includes(deadline.tenancyId));
    if (!inScope) throw new AuthzError("Not found", 404);
  } else {
    assertSameWorkspace(ctx, deadline);
  }
  // Only manual entries can be completed by hand. Tenancy/Ejari-derived
  // deadlines are owned by their contract lifecycle — regeneration would
  // otherwise resurrect a "done" computed deadline on the next routine edit.
  if (!isManualDeadline(deadline!)) {
    throw new AuthzError("Only manual calendar entries can be completed here", 422);
  }
  if (deadline!.status !== "OPEN") throw new AuthzError("Deadline is not open", 422);
  const updated = await prisma.deadline.update({ where: { id }, data: { status } });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: status === "DONE" ? "deadline.complete" : "deadline.cancel",
    objectType: "Deadline",
    objectId: id,
  });
  return updated;
}
