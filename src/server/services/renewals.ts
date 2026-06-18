import { Prisma, type ActorType, type OfferParty, type RenewalStatus, type SecureLink, type TenancyStatus } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, isDelegateRole, require_, scope } from "../authz";
import { recordAudit } from "../audit";
import { recordEvidence } from "../evidence";
import { notify } from "../notify";
import { evaluateRenewalRisk } from "./risk";
import { resolveClientScopeIds } from "./clientScope";
import { resolveDelegateScopeIds } from "./delegateScope";
import { createSecureLink, consumeLinkUse } from "./secureLinks";
import { getTenancy, setTenancyStatus } from "./tenancies";
import { DECREE_43_CALCULATOR_VERSION, decree43, type RentPositionResult } from "../calculators/rent";
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
  /** PR6: the index family this figure came from (DLD's 2025 Smart Rental Index,
   *  the legacy RERA tool, or a manual concierge capture). Defaults to the live
   *  index for new captures. */
  indexSource?: "SMART_RENTAL_INDEX_2025" | "RERA_INDEX_LEGACY" | "MANUAL_CONCIERGE";
  /** PR6: optional comparable basis (community/building/size/bedrooms used to
   *  read the index), persisted verbatim so the capture is reproducible. */
  comparableBasis?: Record<string, unknown>;
  /** PR6: optional pointer to the source artefact (URL/screenshot id/reference). */
  sourceRef?: Record<string, unknown>;
  note?: string;
}

/**
 * Record a manually-captured market-rent index figure against a tenancy.
 *
 * PR6: the capture now persists its decree-43 derivation IN THE SAME ROW, stamped
 * with the live calculator version — so a renewal report can cite the figure AND
 * the math that yielded permittedNewRentMax without re-running anything. The
 * computed fields go ONLY into contemporaneous captures; older rows (pre-PR6)
 * keep their backfill NULLs and are rendered distinctly.
 *
 * The evidence row is stamped at the capture moment (createdAt defaults to now),
 * not batched against a later renewal-pipeline step — emit-at-the-real-moment is
 * the whole point of an append-only timeline.
 */
export async function captureRentIndex(ctx: AuthzContext, input: CaptureIndexInput) {
  require_(ctx, "renewals.write");
  if (!(input.marketRentAvg > 0)) {
    throw new AuthzError("Market rent must be a positive amount", 422);
  }
  const tenancy = await getTenancy(ctx, input.tenancyId); // enforces workspace + client scope

  // PR6 provenance: compute permittedNewRentMax at capture time, against the
  // tenancy's annualRent AS IT STANDS NOW. This figure is the snapshot — it must
  // not be recomputed later from a changed rent, or the row would lie about what
  // was known at capture moment.
  const position = decree43(Number(tenancy!.annualRent), input.marketRentAvg);

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
      // PR6 fields
      indexSource: input.indexSource ?? "SMART_RENTAL_INDEX_2025",
      gapPct: new Prisma.Decimal(position.gapPct),
      permittedPct: position.bandPct,
      permittedNewRentMax: new Prisma.Decimal(position.ceiling),
      calculatorVersion: DECREE_43_CALCULATOR_VERSION,
      comparableBasis: (input.comparableBasis as Prisma.InputJsonValue | undefined) ?? undefined,
      sourceRef: (input.sourceRef as Prisma.InputJsonValue | undefined) ?? undefined,
      // backfilledAt stays NULL — this is a contemporaneous capture.
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
    payload: {
      marketRentAvg: input.marketRentAvg,
      source: capture.source,
      indexSource: capture.indexSource,
      permittedPct: position.bandPct,
      permittedNewRentMax: position.ceiling,
      calculatorVersion: DECREE_43_CALCULATOR_VERSION,
    },
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
  latestIndex: { marketRentAvg: number; capturedAt: Date; source: string; isBenchmark: boolean } | null;
  position: RentPositionResult | null;
  renewalCase: { id: string; status: RenewalStatus; decidedOfferId: string | null } | null;
  offers: OfferView[];
}

export interface EffectiveIndex {
  marketRentAvg: number;
  capturedAt: Date;
  source: string;
  isBenchmark: boolean;
}

/** Benchmark fallback precedence — the single source of truth for both the
 *  per-tenancy resolver and the pipeline's batch pick: a building-specific
 *  capture wins over the community-wide (building null) one; among equals the
 *  latest wins. `candidates` must be ordered capturedAt desc. */
function pickBenchmark<T extends { community: string; building: string | null }>(
  candidates: T[],
  community: string,
  building: string | null,
): T | null {
  if (building) {
    const b = candidates.find((x) => x.community === community && x.building === building);
    if (b) return b;
  }
  return candidates.find((x) => x.community === community && x.building === null) ?? null;
}

/** Latest benchmark for a community(+building), applying {@link pickBenchmark}. */
async function resolveBenchmark(workspaceId: string, community: string, building: string | null) {
  const candidates = await prisma.rentIndexBenchmark.findMany({
    where: { workspaceId, community, OR: [{ building }, { building: null }] },
    orderBy: { capturedAt: "desc" },
  });
  return pickBenchmark(candidates, community, building);
}

/** Resolve the index figure that applies to a tenancy — the single source of
 *  truth for every surface (report, pipeline, property/client pages) and the
 *  notice-gate alert. Precedence: tenancy-specific RentIndexCapture →
 *  building benchmark → community benchmark → none. */
export async function resolveEffectiveIndex(
  workspaceId: string,
  tenancyId: string,
  property?: { community: string; building: string | null } | null,
): Promise<EffectiveIndex | null> {
  const capture = await prisma.rentIndexCapture.findFirst({
    where: { workspaceId, tenancyId },
    orderBy: { capturedAt: "desc" },
  });
  if (capture) {
    return {
      marketRentAvg: Number(capture.marketRentAvg),
      capturedAt: capture.capturedAt,
      source: capture.source,
      isBenchmark: false,
    };
  }
  if (property?.community) {
    const benchmark = await resolveBenchmark(workspaceId, property.community, property.building ?? null);
    if (benchmark) {
      return {
        marketRentAvg: Number(benchmark.marketRentAvg),
        capturedAt: benchmark.capturedAt,
        source: benchmark.source,
        isBenchmark: true,
      };
    }
  }
  return null;
}

export interface BenchmarkInput {
  community: string;
  building?: string;
  marketRentAvg: number;
  capturedAt?: Date;
  source?: string;
  note?: string;
}

/** Capture a community/building index benchmark reusable across units. */
export async function captureBenchmark(ctx: AuthzContext, input: BenchmarkInput) {
  require_(ctx, "renewals.write");
  if (!(input.marketRentAvg > 0)) throw new AuthzError("Market rent must be a positive amount", 422);
  if (!input.community.trim()) throw new AuthzError("Community is required", 422);

  const benchmark = await prisma.rentIndexBenchmark.create({
    data: {
      workspaceId: ctx.workspaceId,
      community: input.community.trim(),
      building: input.building?.trim() || null,
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
    scopeType: "WORKSPACE",
    scopeId: ctx.workspaceId,
    payload: { benchmark: true, community: benchmark.community, building: benchmark.building, marketRentAvg: input.marketRentAvg },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "renewal.capture_benchmark",
    objectType: "RentIndexBenchmark",
    objectId: benchmark.id,
  });
  return benchmark;
}

/** List captured benchmarks for the workspace (newest first). */
export async function listBenchmarks(ctx: AuthzContext) {
  require_(ctx, "renewals.read");
  return prisma.rentIndexBenchmark.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { capturedAt: "desc" },
  });
}

/** Assemble the renewal risk report for one tenancy. */
export async function getRenewalRisk(ctx: AuthzContext, tenancyId: string): Promise<RenewalRisk> {
  require_(ctx, "renewals.read");
  const tenancy = await getTenancy(ctx, tenancyId); // enforces workspace + client scope

  const [eff, renewalCase] = await Promise.all([
    resolveEffectiveIndex(ctx.workspaceId, tenancyId, tenancy!.property),
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
  const latestIndex = eff
    ? { marketRentAvg: eff.marketRentAvg, capturedAt: eff.capturedAt, source: eff.source, isBenchmark: eff.isBenchmark }
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
  isBenchmark: boolean;
  stage: RenewalStatus | null;
}

/** Tenancies approaching renewal (or with an open case), with computed position. */
export async function listRenewalPipeline(
  ctx: AuthzContext,
  opts?: { withinDays?: number; clientPrincipalId?: string },
): Promise<PipelineRow[]> {
  require_(ctx, "renewals.read");
  const within = opts?.withinDays ?? 120;
  const today = todayInDubai();
  const horizon = addDaysUtc(today, within);

  // Restrict to a client's tenancies: a CLIENT_VIEWER is always locked to its own
  // client; a fiduciary may pass an explicit clientPrincipalId (mirrors listDeadlines);
  // a delegate (MANAGING_AGENT) is locked to its assigned clients' tenancies.
  let scopedTenancyIds: string[] | null = null;
  if (isDelegateRole(ctx.role)) {
    scopedTenancyIds = (await resolveDelegateScopeIds(ctx)).tenancyIds;
  } else {
    const effectiveClientId = ctx.clientPrincipalId ?? opts?.clientPrincipalId ?? null;
    if (effectiveClientId) {
      const ids = await resolveClientScopeIds(ctx.workspaceId, effectiveClientId);
      scopedTenancyIds = ids.tenancyIds;
    }
  }
  // A delegate cannot call the fail-closed scope() — build the workspace filter directly.
  const wsFilter = isDelegateRole(ctx.role) ? { workspaceId: ctx.workspaceId } : scope(ctx);

  // Tenancies with an open renewal case stay in the pipeline even past the horizon.
  const openCases = await prisma.renewalCase.findMany({
    where: { workspaceId: ctx.workspaceId, status: { notIn: TERMINAL } },
    select: { tenancyId: true, status: true },
  });
  const caseStage = new Map(openCases.map((c) => [c.tenancyId, c.status]));

  const tenancies = await prisma.tenancy.findMany({
    where: {
      ...wsFilter,
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

  // Benchmarks for fallback in one query; pickBenchmark applies the shared
  // precedence per tenancy (no per-tenancy DB round-trip).
  const benchmarks = await prisma.rentIndexBenchmark.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { capturedAt: "desc" },
  });

  return tenancies.map((t) => {
    const gate = noticeGate(t.endDate, t.noticePeriodDays);
    const daysToGate = daysBetween(today, gate.date);
    const p = t.property;
    const latest = latestByTenancy.get(t.id);
    let isBenchmark = false;
    let marketRentAvg: number | null = latest ? Number(latest.marketRentAvg) : null;
    if (marketRentAvg == null) {
      const b = pickBenchmark(benchmarks, p.community, p.building ?? null);
      if (b) {
        marketRentAvg = Number(b.marketRentAvg);
        isBenchmark = true;
      }
    }
    const position = marketRentAvg != null ? decree43(Number(t.annualRent), marketRentAvg) : null;
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
      isBenchmark,
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


async function renewalPermittedMaxSnapshot(renewalCase: { indexCaptureId: string | null; tenancyId: string }) {
  const linkedCapture = renewalCase.indexCaptureId
    ? await prisma.rentIndexCapture.findUnique({ where: { id: renewalCase.indexCaptureId } })
    : null;
  const latestCapture =
    linkedCapture ??
    (await prisma.rentIndexCapture.findFirst({
      where: { tenancyId: renewalCase.tenancyId, permittedNewRentMax: { not: null } },
      orderBy: { capturedAt: "desc" },
    }));
  return latestCapture?.permittedNewRentMax ?? null;
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

  // PR6: snapshot the index-indicated ceiling AT THE MOMENT THE OFFER IS PROPOSED.
  // The field is intentionally NOT recomputed if a later capture changes the
  // figure — an offer's compliance posture has to be reproducible from the row
  // alone. Source preference: a capture explicitly linked to the case
  // (RenewalCase.indexCaptureId), else the latest capture against the tenancy.
  // Backfilled rows (NULL permittedNewRentMax) contribute no snapshot.
  const permittedMaxSnapshot = await renewalPermittedMaxSnapshot(renewalCase!);

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
      permittedMaxSnapshot,
    },
  });
  await prisma.renewalCase.update({ where: { id: renewalCase!.id }, data: { status: "NEGOTIATING", currentOfferId: offer.id } });
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
  await evaluateRenewalRisk(renewalCase!.id);
  return offer;
}

/** Accept an offer — the case is AGREED and the tenancy moves toward RENEWED. */
export async function acceptOffer(ctx: AuthzContext, offerId: string) {
  require_(ctx, "renewals.decide");
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  assertSameWorkspace(ctx, offer);
  const renewalCaseId = offer!.renewalCaseId;
  const tenancyId = offer!.tenancyId;
  if (!renewalCaseId || !tenancyId) throw new AuthzError("Not a renewal offer", 422);
  const tenancy = await getTenancy(ctx, tenancyId); // enforces client scope

  await prisma.offer.updateMany({
    where: { renewalCaseId, status: { in: ["SENT", "COUNTERED"] }, id: { not: offerId } },
    data: { status: "SUPERSEDED" },
  });
  await prisma.offer.update({ where: { id: offerId }, data: { status: "ACCEPTED" } });
  await prisma.renewalCase.update({
    where: { id: renewalCaseId },
    data: { status: "AGREED", decidedOfferId: offerId, currentOfferId: offerId },
  });
  await tryMoveTenancy(ctx, tenancyId, "RENEWED");
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "OFFER_ACCEPTED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "OFFER",
    scopeId: offerId,
    tenancyId,
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
  await evaluateRenewalRisk(renewalCaseId);
  return offer;
}

// ── Tenant secure-response link (no login; token-authenticated)

/** Issue a secure link to the tenant and email the proposal. */
export async function sendOfferToTenant(ctx: AuthzContext, offerId: string) {
  require_(ctx, "renewals.write");
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  assertSameWorkspace(ctx, offer);
  if (!offer!.tenancyId) throw new AuthzError("Not a renewal offer", 422);
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
  if (!offer || !offer.tenancyId) return null;
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

/**
 * Shared core for a tenant's response to a renewal offer — used by BOTH the no-login
 * secure-link path and the authenticated portal path (2B #17), so the two can never
 * diverge in how they supersede/counter/accept. `source` carries only what differs:
 * the actor identity and whether a secure link was involved.
 */
async function applyTenantOfferResponse(
  offer: { id: string; workspaceId: string; renewalCaseId: string | null; tenancyId: string | null; version: number },
  input: TenantResponseInput,
  source: { actorType: ActorType; actorId?: string; viaSecureLinkId?: string },
) {
  if (!offer.renewalCaseId || !offer.tenancyId) throw new AuthzError("Not a renewal offer", 422);
  const renewalCaseId = offer.renewalCaseId;
  const tenancyId = offer.tenancyId;
  const workspaceId = offer.workspaceId;
  const renewalCase = await prisma.renewalCase.findUnique({ where: { id: renewalCaseId } });
  const propertyId = renewalCase?.propertyId;
  const viaLink = source.viaSecureLinkId != null;
  const actor = { actorType: source.actorType, actorId: source.actorId ?? null };

  if (input.action === "COUNTER") {
    if (!(input.annualRent && input.annualRent > 0) || !input.paymentSchedule) {
      throw new AuthzError("A counter needs a rent and a payment schedule", 422);
    }
    await prisma.offer.updateMany({
      where: { renewalCaseId, status: { in: ["SENT", "COUNTERED"] } },
      data: { status: "SUPERSEDED" },
    });
    // scope-audit: offer pre-validated by callers — respondToOfferViaLink (secure-link
    // token) and respondToOfferAsTenant (getTenancy contact-scope gate).
    const last = await prisma.offer.findFirst({ where: { renewalCaseId }, orderBy: { version: "desc" } });
    const permittedMaxSnapshot = renewalCase ? await renewalPermittedMaxSnapshot(renewalCase) : null;
    const created = await prisma.offer.create({
      data: {
        workspaceId,
        renewalCaseId,
        tenancyId,
        version: (last?.version ?? 0) + 1,
        party: "TENANT",
        annualRent: new Prisma.Decimal(input.annualRent),
        paymentSchedule: input.paymentSchedule,
        paymentMethod: input.paymentMethod ?? null,
        note: input.note ?? null,
        status: "COUNTERED",
        viaSecureLinkId: source.viaSecureLinkId ?? null,
        permittedMaxSnapshot,
      },
    });
    await prisma.renewalCase.update({ where: { id: renewalCaseId }, data: { status: "NEGOTIATING", currentOfferId: created.id } });
    await recordEvidence({
      workspaceId,
      type: "OFFER_COUNTERED",
      ...actor,
      scopeType: "OFFER",
      scopeId: created.id,
      tenancyId,
      propertyId,
      payload: { version: created.version, annualRent: input.annualRent, paymentSchedule: input.paymentSchedule, viaLink },
    });
  } else if (input.action === "ACCEPT") {
    await prisma.offer.updateMany({
      where: { renewalCaseId, status: { in: ["SENT", "COUNTERED"] }, id: { not: offer.id } },
      data: { status: "SUPERSEDED" },
    });
    await prisma.offer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
    await prisma.renewalCase.update({ where: { id: renewalCaseId }, data: { status: "AGREED", decidedOfferId: offer.id, currentOfferId: offer.id } });
    const tenancy = await prisma.tenancy.findUnique({ where: { id: tenancyId } });
    if (tenancy && RENEW_FROM.has(tenancy.status)) {
      await prisma.tenancy.update({ where: { id: tenancyId }, data: { status: "RENEWED" } });
      await recordEvidence({
        workspaceId,
        type: "FIELD_CORRECTED",
        ...actor,
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
      ...actor,
      scopeType: "OFFER",
      scopeId: offer.id,
      tenancyId,
      propertyId,
      payload: { version: offer.version, viaLink },
    });
  } else {
    // ASK — log the tenant's question against the case record.
    await recordEvidence({
      workspaceId,
      type: "TENANT_ACKNOWLEDGED",
      ...actor,
      scopeType: "OFFER",
      scopeId: offer.id,
      tenancyId,
      propertyId,
      payload: { question: input.note ?? "", viaLink },
    });
  }
  await evaluateRenewalRisk(renewalCaseId);
}

/** Public — record a tenant's response to an offer via secure link. No AuthzContext. */
export async function respondToOfferViaLink(link: SecureLink, input: TenantResponseInput) {
  if (link.purpose !== "TENANT_OFFER") throw new AuthzError("Wrong link purpose", 400);
  const offer = await prisma.offer.findUnique({ where: { id: link.scopeId } });
  if (!offer) throw new AuthzError("Offer not found", 404);
  // H4: consume-first; a lost race short-circuits before the response is applied,
  // so a capped offer link can't record two tenant responses.
  const { consumed } = await consumeLinkUse(link.id);
  if (!consumed) throw new AuthzError("This link is no longer available", 410);
  await applyTenantOfferResponse(offer, input, { actorType: "TENANT_LINK", viaSecureLinkId: link.id });
  return { ok: true as const };
}

/** Authenticated counterpart (2B #17): a TENANT persona responds to a renewal offer
 *  on their OWN tenancy in-app. getTenancy enforces the contact scope, so a tenant can
 *  only ever respond to an offer on a tenancy they hold. */
export async function respondToOfferAsTenant(ctx: AuthzContext, offerId: string, input: TenantResponseInput) {
  require_(ctx, "offers.respond");
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer || offer.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  if (!offer.tenancyId) throw new AuthzError("Not a renewal offer", 422);
  await getTenancy(ctx, offer.tenancyId); // contact-scope gate
  await applyTenantOfferResponse(offer, input, { actorType: "USER", actorId: ctx.userId });
  return { ok: true as const };
}

/** The renewal offers on a tenant's own tenancy (newest first), for the portal. */
export async function listOffersForTenant(ctx: AuthzContext, tenancyId: string) {
  require_(ctx, "offers.read");
  await getTenancy(ctx, tenancyId); // contact-scope gate
  return prisma.offer.findMany({
    where: { workspaceId: ctx.workspaceId, tenancyId },
    orderBy: { version: "desc" },
  });
}

export interface MintRenewedTenancyInput {
  renewalCaseId: string;
  /** First day of the successor tenancy (Asia/Dubai date-only). */
  startDate: Date;
  /** Last day of the successor tenancy. */
  endDate: Date;
  /** Annual rent for the successor tenancy (the agreed figure). */
  annualRent: number;
  /** Optional successor contract document. */
  contractDocId?: string;
  paymentTermsNote?: string;
  noticePeriodDays?: number;
}

/**
 * Mint the successor Tenancy from an AGREED RenewalCase.
 *
 * The successor row carries `renewsFromTenancyId` pointing at the predecessor;
 * the predecessor's status moves to RENEWED; the case's `renewedTenancyId` is
 * set (and the case status moves to RENEWED).
 *
 * Single evidence event — RENEWAL_COMPLETED, emitted at THIS moment. We do NOT
 * back-fill the prior renewal events (ASSESSMENT_CREATED / INDEX_CAPTURED /
 * NOTICE_GENERATED|APPROVED|SERVED / OFFER_PROPOSED|COUNTERED|ACCEPTED /
 * TENANT_ACKNOWLEDGED) here — those rows were already emitted at their own
 * moments. Batching them at mint time would stamp every one with the mint
 * timestamp and the timeline would be a lie.
 */
export async function mintRenewedTenancy(ctx: AuthzContext, input: MintRenewedTenancyInput) {
  require_(ctx, "renewals.decide");
  const rc = await prisma.renewalCase.findUnique({ where: { id: input.renewalCaseId } });
  assertSameWorkspace(ctx, rc);
  if (rc!.status !== "AGREED") {
    throw new AuthzError(`Case must be AGREED to mint a successor (current: ${rc!.status})`, 422);
  }
  if (rc!.renewedTenancyId) {
    throw new AuthzError("A successor tenancy has already been minted for this case", 409);
  }
  if (!(input.annualRent > 0)) throw new AuthzError("Successor rent must be a positive amount", 422);
  if (input.endDate.getTime() <= input.startDate.getTime()) {
    throw new AuthzError("Successor endDate must be after startDate", 422);
  }
  const predecessor = await getTenancy(ctx, rc!.tenancyId); // client-scope gate

  const successor = await prisma.tenancy.create({
    data: {
      workspaceId: ctx.workspaceId,
      propertyId: rc!.propertyId,
      landlordContactId: predecessor!.landlordContactId,
      tenantContactId: predecessor!.tenantContactId,
      startDate: toUtcDateOnly(input.startDate),
      endDate: toUtcDateOnly(input.endDate),
      annualRent: new Prisma.Decimal(input.annualRent),
      paymentTermsNote: input.paymentTermsNote ?? predecessor!.paymentTermsNote ?? null,
      noticePeriodDays: input.noticePeriodDays ?? predecessor!.noticePeriodDays,
      status: "ACTIVE",
      source: "MANUAL",
      contractDocId: input.contractDocId ?? null,
      renewsFromTenancyId: predecessor!.id,
    },
  });
  await prisma.$transaction([
    prisma.tenancy.update({ where: { id: predecessor!.id }, data: { status: "RENEWED" } }),
    prisma.renewalCase.update({
      where: { id: rc!.id },
      data: { status: "RENEWED", renewedTenancyId: successor.id },
    }),
  ]);
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "RENEWAL_COMPLETED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "RENEWAL_CASE",
    scopeId: rc!.id,
    tenancyId: successor.id,
    propertyId: rc!.propertyId,
    payload: {
      predecessorTenancyId: predecessor!.id,
      successorTenancyId: successor.id,
      annualRent: input.annualRent,
      startDate: input.startDate.toISOString(),
      endDate: input.endDate.toISOString(),
    },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "renewal.mint_successor",
    objectType: "RenewalCase",
    objectId: rc!.id,
  });
  return successor;
}
