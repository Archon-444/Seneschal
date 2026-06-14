import { Prisma, type OfferParty, type RenewalStatus, type SecureLink, type TenancyStatus } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_, scope } from "../authz";
import { recordAudit } from "../audit";
import { recordEvidence } from "../evidence";
import { notify } from "../notify";
import { resolveClientScopeIds } from "./clientScope";
import { createSecureLink, consumeLinkUse } from "./secureLinks";
import { getTenancy, setTenancyStatus } from "./tenancies";
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
// close the notice gate is, and where the rent sits against the Decree 43 ceiling estimate
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

export interface OfferView {
  id: string;
  version: number;
  party: OfferParty;
  annualRent: number;
  paymentSchedule: string;
  paymentMethod: string | null;
  termMonths: number | null;
  status: string;
  note: string | null;
  createdAt: Date;
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
  renewalCase: { id: string; status: RenewalStatus; decidedOfferId: string | null } | null;
  offers: OfferView[];
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
      where: { workspaceId: ctx.workspaceId, tenancyId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const offers = renewalCase
    ? await prisma.offer.findMany({
        where: { renewalCaseId: renewalCase.id },
        orderBy: { version: "asc" },
      })
    : [];

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
    renewalCase: renewalCase
      ? { id: renewalCase.id, status: renewalCase.status, decidedOfferId: renewalCase.decidedOfferId }
      : null,
    offers: offers.map((o) => ({
      id: o.id,
      version: o.version,
      party: o.party,
      annualRent: Number(o.annualRent),
      paymentSchedule: o.paymentSchedule,
      paymentMethod: o.paymentMethod,
      termMonths: o.termMonths,
      status: o.status,
      note: o.note,
      createdAt: o.createdAt,
    })),
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

// ── Negotiation: offers, counters, decisions, notice

/** Best-effort tenancy status move — skips silently when the transition isn't
 *  legal for the current status (the RenewalCase status stays authoritative). */
async function tryMoveTenancy(ctx: AuthzContext, tenancyId: string, target: TenancyStatus) {
  try {
    await setTenancyStatus(ctx, tenancyId, target);
  } catch (e) {
    if (!(e instanceof AuthzError && e.status === 422)) throw e;
  }
}

export interface OfferInput {
  renewalCaseId: string;
  party: OfferParty;
  annualRent: number;
  paymentSchedule: string;
  paymentMethod?: string;
  termMonths?: number;
  startDate?: Date;
  note?: string;
  viaSecureLinkId?: string;
}

/** Propose a landlord offer or record a tenant counter — a new versioned Offer. */
export async function proposeOffer(ctx: AuthzContext, input: OfferInput) {
  require_(ctx, "renewals.write");
  if (!(input.annualRent > 0)) throw new AuthzError("Offer rent must be a positive amount", 422);
  const renewalCase = await prisma.renewalCase.findUnique({ where: { id: input.renewalCaseId } });
  assertSameWorkspace(ctx, renewalCase);
  await getTenancy(ctx, renewalCase!.tenancyId); // enforces client scope

  // Supersede any still-open offer; the newest figure is the one on the table.
  await prisma.offer.updateMany({
    where: { renewalCaseId: renewalCase!.id, status: { in: ["SENT", "COUNTERED"] } },
    data: { status: "SUPERSEDED" },
  });
  const last = await prisma.offer.findFirst({
    where: { renewalCaseId: renewalCase!.id },
    orderBy: { version: "desc" },
  });
  const version = (last?.version ?? 0) + 1;

  const offer = await prisma.offer.create({
    data: {
      workspaceId: ctx.workspaceId,
      renewalCaseId: renewalCase!.id,
      tenancyId: renewalCase!.tenancyId,
      version,
      party: input.party,
      annualRent: new Prisma.Decimal(input.annualRent),
      paymentSchedule: input.paymentSchedule,
      paymentMethod: input.paymentMethod ?? null,
      termMonths: input.termMonths ?? null,
      startDate: input.startDate ? toUtcDateOnly(input.startDate) : null,
      note: input.note ?? null,
      status: input.party === "TENANT" ? "COUNTERED" : "SENT",
      createdById: ctx.userId,
      viaSecureLinkId: input.viaSecureLinkId ?? null,
    },
  });
  await prisma.renewalCase.update({ where: { id: renewalCase!.id }, data: { status: "NEGOTIATING" } });
  await tryMoveTenancy(ctx, renewalCase!.tenancyId, "NEGOTIATING");
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: input.party === "TENANT" ? "OFFER_COUNTERED" : "OFFER_PROPOSED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "OFFER",
    scopeId: offer.id,
    tenancyId: renewalCase!.tenancyId,
    propertyId: renewalCase!.propertyId,
    payload: { version, party: input.party, annualRent: input.annualRent, paymentSchedule: input.paymentSchedule },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "renewal.propose_offer",
    objectType: "Offer",
    objectId: offer.id,
  });
  return offer;
}

/** Accept an offer — the case is AGREED and the tenancy moves toward RENEWED. */
export async function acceptOffer(ctx: AuthzContext, offerId: string) {
  require_(ctx, "renewals.decide");
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  assertSameWorkspace(ctx, offer);
  const tenancy = await getTenancy(ctx, offer!.tenancyId); // enforces client scope

  await prisma.offer.updateMany({
    where: { renewalCaseId: offer!.renewalCaseId, status: { in: ["SENT", "COUNTERED"] }, id: { not: offerId } },
    data: { status: "SUPERSEDED" },
  });
  await prisma.offer.update({ where: { id: offerId }, data: { status: "ACCEPTED" } });
  await prisma.renewalCase.update({
    where: { id: offer!.renewalCaseId },
    data: { status: "AGREED", decidedOfferId: offerId },
  });
  await tryMoveTenancy(ctx, offer!.tenancyId, "RENEWED");
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "OFFER_ACCEPTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "OFFER",
    scopeId: offerId,
    tenancyId: offer!.tenancyId,
    propertyId: tenancy!.propertyId,
    payload: { version: offer!.version, annualRent: Number(offer!.annualRent) },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "renewal.accept_offer",
    objectType: "Offer",
    objectId: offerId,
  });
  return offer;
}

/** Mark the change notice served on a renewal case. */
export async function serveNotice(
  ctx: AuthzContext,
  renewalCaseId: string,
  opts?: { noticeDocId?: string; servedAt?: Date },
) {
  require_(ctx, "renewals.decide");
  const renewalCase = await prisma.renewalCase.findUnique({ where: { id: renewalCaseId } });
  assertSameWorkspace(ctx, renewalCase);
  await getTenancy(ctx, renewalCase!.tenancyId); // enforces client scope

  const updated = await prisma.renewalCase.update({
    where: { id: renewalCaseId },
    data: {
      status: "NOTICE_SERVED",
      noticeServedAt: opts?.servedAt ?? new Date(),
      noticeDocId: opts?.noticeDocId ?? null,
    },
  });
  await tryMoveTenancy(ctx, renewalCase!.tenancyId, "NOTICE_SERVED");
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "NOTICE_SERVED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "RENEWAL_CASE",
    scopeId: renewalCaseId,
    tenancyId: renewalCase!.tenancyId,
    propertyId: renewalCase!.propertyId,
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "renewal.serve_notice",
    objectType: "RenewalCase",
    objectId: renewalCaseId,
  });
  return updated;
}

// ── Tenant secure-response link (no login; token-authenticated)

/** Issue a secure link to the tenant and email the proposal. */
export async function sendOfferToTenant(ctx: AuthzContext, offerId: string) {
  require_(ctx, "renewals.write");
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  assertSameWorkspace(ctx, offer);
  const tenancy = await getTenancy(ctx, offer!.tenancyId); // enforces client scope

  const link = await createSecureLink(ctx, {
    purpose: "TENANT_OFFER",
    scopeType: "OFFER",
    scopeId: offerId,
    contactId: tenancy!.tenantContactId ?? undefined,
    maxUses: 5,
  });
  const unit = [tenancy!.property.community, tenancy!.property.unitNo].filter(Boolean).join(" · ");
  await notify({
    workspaceId: ctx.workspaceId,
    channel: "EMAIL",
    templateCode: "renewal_offer_v1",
    toContactId: tenancy!.tenantContactId ?? undefined,
    subject: `Renewal proposal — ${unit || "your tenancy"}`,
    body: `Your landlord has shared a renewal proposal of AED ${Number(offer!.annualRent).toLocaleString("en-AE")}/yr. View it and respond (accept, counter, or ask a question): ${link.url}`,
    relatedType: "OFFER",
    relatedId: offerId,
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "renewal.send_offer",
    objectType: "Offer",
    objectId: offerId,
  });
  return link;
}

export interface TenantOfferView {
  offerId: string;
  version: number;
  proposedRent: number;
  paymentSchedule: string;
  paymentMethod: string | null;
  termMonths: number | null;
  note: string | null;
  status: string;
  unit: string;
  currentRent: number;
  marketRentAvg: number | null;
}

/** Public — render data for a tenant-offer secure link. No AuthzContext. */
export async function getOfferForLink(link: SecureLink): Promise<TenantOfferView | null> {
  if (link.purpose !== "TENANT_OFFER") return null;
  const offer = await prisma.offer.findUnique({ where: { id: link.scopeId } });
  if (!offer) return null;
  const tenancy = await prisma.tenancy.findUnique({
    where: { id: offer.tenancyId },
    include: { property: true },
  });
  if (!tenancy) return null;
  const index = await prisma.rentIndexCapture.findFirst({
    where: { tenancyId: offer.tenancyId },
    orderBy: { capturedAt: "desc" },
  });
  return {
    offerId: offer.id,
    version: offer.version,
    proposedRent: Number(offer.annualRent),
    paymentSchedule: offer.paymentSchedule,
    paymentMethod: offer.paymentMethod,
    termMonths: offer.termMonths,
    note: offer.note,
    status: offer.status,
    unit: [tenancy.property.community, tenancy.property.building, tenancy.property.unitNo].filter(Boolean).join(" · "),
    currentRent: Number(tenancy.annualRent),
    marketRentAvg: index ? Number(index.marketRentAvg) : null,
  };
}

const RENEW_FROM = new Set<TenancyStatus>(["RENEWAL_DUE", "NOTICE_SERVED", "NEGOTIATING"]);

export interface TenantResponseInput {
  action: "ACCEPT" | "COUNTER" | "ASK";
  annualRent?: number;
  paymentSchedule?: string;
  paymentMethod?: string;
  note?: string;
}

/** Public — record a tenant's response to an offer via secure link. No AuthzContext. */
export async function respondToOfferViaLink(link: SecureLink, input: TenantResponseInput) {
  if (link.purpose !== "TENANT_OFFER") throw new AuthzError("Wrong link purpose", 400);
  const offer = await prisma.offer.findUnique({ where: { id: link.scopeId } });
  if (!offer) throw new AuthzError("Offer not found", 404);
  const renewalCase = await prisma.renewalCase.findUnique({ where: { id: offer.renewalCaseId } });
  const workspaceId = link.workspaceId;
  const tenancyId = offer.tenancyId;
  const propertyId = renewalCase?.propertyId;

  if (input.action === "COUNTER") {
    if (!(input.annualRent && input.annualRent > 0) || !input.paymentSchedule) {
      throw new AuthzError("A counter needs a rent and a payment schedule", 422);
    }
    await prisma.offer.updateMany({
      where: { renewalCaseId: offer.renewalCaseId, status: { in: ["SENT", "COUNTERED"] } },
      data: { status: "SUPERSEDED" },
    });
    const last = await prisma.offer.findFirst({
      where: { renewalCaseId: offer.renewalCaseId },
      orderBy: { version: "desc" },
    });
    const created = await prisma.offer.create({
      data: {
        workspaceId,
        renewalCaseId: offer.renewalCaseId,
        tenancyId,
        version: (last?.version ?? 0) + 1,
        party: "TENANT",
        annualRent: new Prisma.Decimal(input.annualRent),
        paymentSchedule: input.paymentSchedule,
        paymentMethod: input.paymentMethod ?? null,
        note: input.note ?? null,
        status: "COUNTERED",
        viaSecureLinkId: link.id,
      },
    });
    await prisma.renewalCase.update({ where: { id: offer.renewalCaseId }, data: { status: "NEGOTIATING" } });
    await recordEvidence({
      workspaceId,
      type: "OFFER_COUNTERED",
      actorType: "TENANT_LINK",
      scopeType: "OFFER",
      scopeId: created.id,
      tenancyId,
      propertyId,
      payload: { version: created.version, annualRent: input.annualRent, paymentSchedule: input.paymentSchedule, viaLink: true },
    });
  } else if (input.action === "ACCEPT") {
    await prisma.offer.updateMany({
      where: { renewalCaseId: offer.renewalCaseId, status: { in: ["SENT", "COUNTERED"] }, id: { not: offer.id } },
      data: { status: "SUPERSEDED" },
    });
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
    await prisma.renewalCase.update({
      where: { id: offer.renewalCaseId },
      data: { status: "AGREED", decidedOfferId: offer.id },
    });
    const tenancy = await prisma.tenancy.findUnique({ where: { id: tenancyId } });
    if (tenancy && RENEW_FROM.has(tenancy.status)) {
      await prisma.tenancy.update({ where: { id: tenancyId }, data: { status: "RENEWED" } });
      await recordEvidence({
        workspaceId,
        type: "FIELD_CORRECTED",
        actorType: "TENANT_LINK",
        scopeType: "TENANCY",
        scopeId: tenancyId,
        tenancyId,
        propertyId,
        payload: { field: "status", from: tenancy.status, to: "RENEWED" },
      });
    }
    await recordEvidence({
      workspaceId,
      type: "OFFER_ACCEPTED",
      actorType: "TENANT_LINK",
      scopeType: "OFFER",
      scopeId: offer.id,
      tenancyId,
      propertyId,
      payload: { version: offer.version, viaLink: true },
    });
  } else {
    // ASK — log the tenant's question against the case record.
    await recordEvidence({
      workspaceId,
      type: "TENANT_ACKNOWLEDGED",
      actorType: "TENANT_LINK",
      scopeType: "OFFER",
      scopeId: offer.id,
      tenancyId,
      propertyId,
      payload: { question: input.note ?? "", viaLink: true },
    });
  }

  await consumeLinkUse(link.id);
  return { ok: true as const };
}
