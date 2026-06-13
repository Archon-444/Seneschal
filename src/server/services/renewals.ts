import { Prisma, type RenewalStatus } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_, scope } from "../authz";
import { recordAudit } from "../audit";
import { recordEvidence } from "../evidence";
import { resolveClientScopeIds } from "./clientScope";
import { getTenancy } from "./tenancies";
import { decree43, type RentPositionResult } from "../calculators/rent";
import {
  contractExpiry,
  daysBetween,
  noticeGate,
  renewalDate,
  toUtcDateOnly,
  todayInDubai,
} from "../calculators/dates";

// Renewal Risk Desk (decision support). A renewal is driven by two facts: how
// close the notice gate is, and where the rent sits against the lawful Decree 43
// ceiling. RenewalCase tracks the workflow; RentIndexCapture is the captured DLD
// reference. Every figure here is an estimate for review — not legal advice.

const TERMINAL: RenewalStatus[] = ["RENEWED", "DECLINED", "LAPSED"];

function addDaysUtc(d: Date, days: number): Date {
  const r = toUtcDateOnly(d);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Open (or return the existing) renewal case for a tenancy. */
export async function openRenewalCase(ctx: AuthzContext, tenancyId: string) {
  require_(ctx, "renewals.write");
  const tenancy = await getTenancy(ctx, tenancyId); // enforces workspace + client scope

  const existing = await prisma.renewalCase.findFirst({
    where: { workspaceId: ctx.workspaceId, tenancyId, status: { notIn: TERMINAL } },
  });
  if (existing) return existing;

  const gate = noticeGate(tenancy!.endDate, tenancy!.noticePeriodDays);
  const renewal = renewalDate(tenancy!.endDate);
  const created = await prisma.renewalCase.create({
    data: {
      workspaceId: ctx.workspaceId,
      tenancyId,
      propertyId: tenancy!.propertyId,
      status: "ASSESSING",
      currentRentSnapshot: tenancy!.annualRent,
      noticeGateAt: gate.date,
      expiresAt: contractExpiry(tenancy!.endDate).date,
      renewalDate: renewal.date,
      createdById: ctx.userId,
    },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "RENEWAL_ASSESSMENT_CREATED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "RENEWAL_CASE",
    scopeId: created.id,
    tenancyId,
    propertyId: tenancy!.propertyId,
    payload: { currentRent: Number(tenancy!.annualRent) },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "renewal.open",
    objectType: "RenewalCase",
    objectId: created.id,
  });
  return created;
}

export interface CaptureIndexInput {
  tenancyId: string;
  marketRentAvg: number;
  capturedAt?: Date;
  source?: string;
  note?: string;
}

/** Record a manually-captured market-rent index figure against a tenancy. */
export async function captureRentIndex(ctx: AuthzContext, input: CaptureIndexInput) {
  require_(ctx, "renewals.write");
  if (!(input.marketRentAvg > 0)) {
    throw new AuthzError("Market rent must be a positive amount", 422);
  }
  const tenancy = await getTenancy(ctx, input.tenancyId); // enforces workspace + client scope

  const capture = await prisma.rentIndexCapture.create({
    data: {
      workspaceId: ctx.workspaceId,
      tenancyId: input.tenancyId,
      propertyId: tenancy!.propertyId,
      marketRentAvg: new Prisma.Decimal(input.marketRentAvg),
      source: input.source?.trim() || "DLD Smart Rental Index",
      capturedAt: input.capturedAt ?? new Date(),
      capturedById: ctx.userId,
      note: input.note ?? null,
    },
  });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "INDEX_CAPTURED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "TENANCY",
    scopeId: input.tenancyId,
    tenancyId: input.tenancyId,
    propertyId: tenancy!.propertyId,
    payload: { marketRentAvg: input.marketRentAvg, source: capture.source },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "renewal.capture_index",
    objectType: "RentIndexCapture",
    objectId: capture.id,
  });
  return capture;
}

export interface RenewalRisk {
  tenancy: NonNullable<Awaited<ReturnType<typeof getTenancy>>>;
  noticeGateAt: Date;
  expiresAt: Date;
  renewalDate: Date;
  daysToGate: number;
  gatePassed: boolean;
  latestIndex: { marketRentAvg: number; capturedAt: Date; source: string } | null;
  position: RentPositionResult | null;
  renewalCase: { id: string; status: RenewalStatus } | null;
}

/** Assemble the renewal risk report for one tenancy. */
export async function getRenewalRisk(ctx: AuthzContext, tenancyId: string): Promise<RenewalRisk> {
  require_(ctx, "renewals.read");
  const tenancy = await getTenancy(ctx, tenancyId); // enforces workspace + client scope

  const [latest, renewalCase] = await Promise.all([
    prisma.rentIndexCapture.findFirst({
      where: { workspaceId: ctx.workspaceId, tenancyId },
      orderBy: { capturedAt: "desc" },
    }),
    prisma.renewalCase.findFirst({
      where: { workspaceId: ctx.workspaceId, tenancyId, status: { notIn: TERMINAL } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const gate = noticeGate(tenancy!.endDate, tenancy!.noticePeriodDays);
  const today = todayInDubai();
  const daysToGate = daysBetween(today, gate.date);
  const latestIndex = latest
    ? { marketRentAvg: Number(latest.marketRentAvg), capturedAt: latest.capturedAt, source: latest.source }
    : null;
  const position = latestIndex
    ? decree43(Number(tenancy!.annualRent), latestIndex.marketRentAvg)
    : null;

  return {
    tenancy: tenancy!,
    noticeGateAt: gate.date,
    expiresAt: contractExpiry(tenancy!.endDate).date,
    renewalDate: renewalDate(tenancy!.endDate).date,
    daysToGate,
    gatePassed: daysToGate < 0,
    latestIndex,
    position,
    renewalCase: renewalCase ? { id: renewalCase.id, status: renewalCase.status } : null,
  };
}

export interface PipelineRow {
  tenancyId: string;
  unit: string;
  ownerName: string | null;
  noticeGateAt: Date;
  daysToGate: number;
  gatePassed: boolean;
  renewalDate: Date;
  currentRent: number;
  gapPct: number | null;
  valueAtRisk: number | null;
  stage: RenewalStatus | null;
}

/** Tenancies approaching renewal (or with an open case), with computed position. */
export async function listRenewalPipeline(
  ctx: AuthzContext,
  opts?: { withinDays?: number },
): Promise<PipelineRow[]> {
  require_(ctx, "renewals.read");
  const within = opts?.withinDays ?? 120;
  const today = todayInDubai();
  const horizon = addDaysUtc(today, within);

  // CLIENT_VIEWER: restrict to the client's own tenancies (same pattern as listDeadlines).
  let scopedTenancyIds: string[] | null = null;
  if (ctx.clientPrincipalId) {
    const ids = await resolveClientScopeIds(ctx.workspaceId, ctx.clientPrincipalId);
    scopedTenancyIds = ids.tenancyIds;
  }

  // Tenancies with an open renewal case stay in the pipeline even past the horizon.
  const openCases = await prisma.renewalCase.findMany({
    where: { workspaceId: ctx.workspaceId, status: { notIn: TERMINAL } },
    select: { tenancyId: true, status: true },
  });
  const caseStage = new Map(openCases.map((c) => [c.tenancyId, c.status]));

  const tenancies = await prisma.tenancy.findMany({
    where: {
      ...scope(ctx),
      archivedAt: null,
      ...(scopedTenancyIds ? { id: { in: scopedTenancyIds } } : {}),
      OR: [
        { endDate: { lte: horizon } },
        { id: { in: [...caseStage.keys()] } },
      ],
    },
    include: { property: true },
    orderBy: { endDate: "asc" },
  });

  if (tenancies.length === 0) return [];

  // Owner display names (Property has clientPrincipalId but no relation).
  const clientIds = [...new Set(tenancies.map((t) => t.property.clientPrincipalId).filter(Boolean))] as string[];
  const clients = clientIds.length
    ? await prisma.clientPrincipal.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const clientName = new Map(clients.map((c) => [c.id, c.displayName]));

  // Latest index capture per tenancy.
  const captures = await prisma.rentIndexCapture.findMany({
    where: { workspaceId: ctx.workspaceId, tenancyId: { in: tenancies.map((t) => t.id) } },
    orderBy: { capturedAt: "desc" },
  });
  const latestByTenancy = new Map<string, (typeof captures)[number]>();
  for (const c of captures) if (!latestByTenancy.has(c.tenancyId)) latestByTenancy.set(c.tenancyId, c);

  return tenancies.map((t) => {
    const gate = noticeGate(t.endDate, t.noticePeriodDays);
    const daysToGate = daysBetween(today, gate.date);
    const latest = latestByTenancy.get(t.id);
    const position = latest ? decree43(Number(t.annualRent), Number(latest.marketRentAvg)) : null;
    const p = t.property;
    const unit = [p.community, p.building, p.unitNo].filter(Boolean).join(" · ");
    return {
      tenancyId: t.id,
      unit,
      ownerName: p.clientPrincipalId ? clientName.get(p.clientPrincipalId) ?? null : null,
      noticeGateAt: gate.date,
      daysToGate,
      gatePassed: daysToGate < 0,
      renewalDate: renewalDate(t.endDate).date,
      currentRent: Number(t.annualRent),
      gapPct: position ? position.gapPct : null,
      valueAtRisk: position ? position.valueAtRisk : null,
      stage: caseStage.get(t.id) ?? null,
    };
  });
}
