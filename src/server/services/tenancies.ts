import { Prisma, type RecordSource, type TenancyStatus } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_ } from "../authz";
import { recordAudit } from "../audit";
import { recordEvidence } from "../evidence";
import { toUtcDateOnly } from "../calculators/dates";
import { regenerateDeadlinesForTenancy } from "./deadlines";
import { evaluateRiskForTenancy } from "./risk";
import { assertReadable } from "./contactScope";

// Tenancy CRUD (T2.4). Create/update regenerates deadlines (T3.2); status
// transitions are logged as evidence; archive cancels open deadlines.

export async function getTenancy(ctx: AuthzContext, id: string) {
  require_(ctx, "tenancies.read");
  const tenancy = await prisma.tenancy.findUnique({
    where: { id },
    include: {
      property: true,
      paymentItems: { orderBy: { seq: "asc" } },
      deadlines: { where: { status: "OPEN" }, orderBy: { dueAt: "asc" } },
    },
  });
  await assertReadable(ctx, { kind: "tenancy", row: tenancy });
  return tenancy!;
}

export interface TenancyInput {
  propertyId: string;
  landlordContactId?: string;
  tenantContactId?: string;
  ejariNo?: string;
  startDate: Date;
  endDate: Date;
  annualRent: number;
  depositAmount?: number;
  paymentTermsNote?: string;
  noticePeriodDays?: number;
  contractDocId?: string;
  source?: RecordSource;
}

export async function createTenancy(ctx: AuthzContext, data: TenancyInput) {
  require_(ctx, "tenancies.write");
  const property = await prisma.property.findUnique({ where: { id: data.propertyId } });
  assertSameWorkspace(ctx, property);

  const tenancy = await prisma.tenancy.create({
    data: {
      workspaceId: ctx.workspaceId,
      propertyId: data.propertyId,
      landlordContactId: data.landlordContactId,
      tenantContactId: data.tenantContactId,
      ejariNo: data.ejariNo,
      startDate: toUtcDateOnly(data.startDate),
      endDate: toUtcDateOnly(data.endDate),
      annualRent: new Prisma.Decimal(data.annualRent),
      depositAmount: data.depositAmount != null ? new Prisma.Decimal(data.depositAmount) : null,
      paymentTermsNote: data.paymentTermsNote,
      noticePeriodDays: data.noticePeriodDays ?? 90,
      contractDocId: data.contractDocId,
      source: data.source ?? "MANUAL",
    },
  });
  await regenerateDeadlinesForTenancy(tenancy.id);
  await evaluateRiskForTenancy(tenancy.id);
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "tenancy.create",
    objectType: "Tenancy",
    objectId: tenancy.id,
  });
  return tenancy;
}

export async function updateTenancy(ctx: AuthzContext, id: string, data: Partial<TenancyInput>) {
  require_(ctx, "tenancies.write");
  await getTenancy(ctx, id);
  const tenancy = await prisma.tenancy.update({
    where: { id },
    data: {
      landlordContactId: data.landlordContactId,
      tenantContactId: data.tenantContactId,
      ejariNo: data.ejariNo,
      startDate: data.startDate ? toUtcDateOnly(data.startDate) : undefined,
      endDate: data.endDate ? toUtcDateOnly(data.endDate) : undefined,
      annualRent: data.annualRent != null ? new Prisma.Decimal(data.annualRent) : undefined,
      depositAmount: data.depositAmount != null ? new Prisma.Decimal(data.depositAmount) : undefined,
      paymentTermsNote: data.paymentTermsNote,
      noticePeriodDays: data.noticePeriodDays,
      contractDocId: data.contractDocId,
    },
  });
  await regenerateDeadlinesForTenancy(id);
  await evaluateRiskForTenancy(id);
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "tenancy.update",
    objectType: "Tenancy",
    objectId: id,
  });
  return tenancy;
}

const ALLOWED_STATUS: Record<TenancyStatus, TenancyStatus[]> = {
  ACTIVE: ["RENEWAL_DUE", "NOTICE_SERVED", "NEGOTIATING", "ENDING", "DISPUTED", "ARCHIVED"],
  RENEWAL_DUE: ["NOTICE_SERVED", "NEGOTIATING", "RENEWED", "ENDING", "DISPUTED"],
  NOTICE_SERVED: ["NEGOTIATING", "RENEWED", "ENDING", "DISPUTED"],
  NEGOTIATING: ["RENEWED", "ENDING", "DISPUTED"],
  RENEWED: ["ARCHIVED"],
  ENDING: ["ARCHIVED", "DISPUTED"],
  DISPUTED: ["ACTIVE", "ENDING", "ARCHIVED"],
  ARCHIVED: [],
};

export async function setTenancyStatus(ctx: AuthzContext, id: string, status: TenancyStatus) {
  require_(ctx, "tenancies.write");
  const tenancy = await getTenancy(ctx, id);
  if (!ALLOWED_STATUS[tenancy!.status].includes(status)) {
    throw new AuthzError(`Cannot move tenancy from ${tenancy!.status} to ${status}`, 422);
  }
  const updated = await prisma.tenancy.update({ where: { id }, data: { status } });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "FIELD_CORRECTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "TENANCY",
    scopeId: id,
    tenancyId: id,
    propertyId: tenancy!.propertyId,
    payload: { field: "status", from: tenancy!.status, to: status },
  });
  return updated;
}

export async function archiveTenancy(ctx: AuthzContext, id: string) {
  require_(ctx, "tenancies.write");
  const tenancy = await getTenancy(ctx, id);
  const updated = await prisma.tenancy.update({
    where: { id },
    data: { archivedAt: new Date(), status: "ARCHIVED" },
  });
  await regenerateDeadlinesForTenancy(id); // cancels open deadlines
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "tenancy.archive",
    objectType: "Tenancy",
    objectId: id,
  });
  void tenancy;
  return updated;
}
