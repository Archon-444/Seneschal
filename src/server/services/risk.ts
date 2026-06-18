import type { Prisma, RiskCode, ScopeType, Severity } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, require_, scope } from "../authz";
import { allScopeIds, resolveClientScopeIds } from "./clientScope";
import { recordEvidence } from "../evidence";
import { daysBetween, todayInDubai } from "../calculators/dates";

// Deterministic risk rules engine (T8.4). 1A rule set only — no anomaly agent.
// One open flag per code per scope (DB unique constraint backs this up);
// raise and clear both write evidence events. ruleVersion cited on every flag.

export const RULE_VERSION = "1a.1";

type Db = Prisma.TransactionClient;

async function raiseFlag(
  db: Db,
  args: {
    workspaceId: string;
    scopeType: ScopeType;
    scopeId: string;
    code: RiskCode;
    severity: Severity;
    tenancyId?: string;
    propertyId?: string;
  },
) {
  const open = await db.riskFlag.findFirst({
    where: {
      workspaceId: args.workspaceId,
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      code: args.code,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });
  if (open) return open; // idempotent

  const flag = await db.riskFlag.create({
    data: {
      workspaceId: args.workspaceId,
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      code: args.code,
      severity: args.severity,
      raisedBy: "RULE",
      ruleVersion: RULE_VERSION,
    },
  });
  await recordEvidence(
    {
      workspaceId: args.workspaceId,
      type: "RISK_FLAG_RAISED",
      actorType: "SYSTEM",
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      tenancyId: args.tenancyId,
      propertyId: args.propertyId,
      payload: { code: args.code, severity: args.severity, ruleVersion: RULE_VERSION },
    },
    db,
  );
  return flag;
}

async function clearFlag(
  db: Db,
  args: {
    workspaceId: string;
    scopeType: ScopeType;
    scopeId: string;
    code: RiskCode;
    tenancyId?: string;
    propertyId?: string;
    clearedById?: string;
  },
) {
  const open = await db.riskFlag.findFirst({
    where: {
      workspaceId: args.workspaceId,
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      code: args.code,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });
  if (!open) return;
  // H2: the unique constraint is now partial (active flags only), so CLEARED rows
  // may accumulate as history — no need to delete prior cleared rows before this
  // transition. The append-only ledger keeps the full trail.
  await db.riskFlag.update({
    where: { id: open.id },
    data: { status: "CLEARED", clearedAt: new Date(), clearedById: args.clearedById ?? null },
  });
  await recordEvidence(
    {
      workspaceId: args.workspaceId,
      type: "RISK_FLAG_CLEARED",
      actorType: "SYSTEM",
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      tenancyId: args.tenancyId,
      propertyId: args.propertyId,
      payload: { code: args.code, ruleVersion: RULE_VERSION },
    },
    db,
  );
}

/**
 * Evaluate tenancy-scoped rules: MISSING_EJARI, MISSING_END_DATE,
 * CHEQUE_TOTAL_MISMATCH, NOTICE_GATE_WITHIN_30D. Called on write and nightly.
 */
export async function evaluateRiskForTenancy(tenancyId: string, db: Db = prisma) {
  const tenancy = await db.tenancy.findUnique({
    where: { id: tenancyId },
    include: { paymentItems: true },
  });
  if (!tenancy || tenancy.archivedAt) return;

  const base = {
    workspaceId: tenancy.workspaceId,
    scopeType: "TENANCY" as ScopeType,
    scopeId: tenancy.id,
    tenancyId: tenancy.id,
    propertyId: tenancy.propertyId,
  };

  // MISSING_EJARI — clear condition: ejariNo present
  if (!tenancy.ejariNo) await raiseFlag(db, { ...base, code: "MISSING_EJARI", severity: "WARN" });
  else await clearFlag(db, { ...base, code: "MISSING_EJARI" });

  // MISSING_END_DATE — endDate is non-null in schema, but imports may set epoch sentinel
  // (kept for parity with rule set; clears when a real end date exists)
  if (tenancy.endDate.getTime() === 0) {
    await raiseFlag(db, { ...base, code: "MISSING_END_DATE", severity: "CRITICAL" });
  } else {
    await clearFlag(db, { ...base, code: "MISSING_END_DATE" });
  }

  // CHEQUE_TOTAL_MISMATCH — warn, never block (T4.1)
  const items = tenancy.paymentItems.filter((i) => i.status !== "CANCELLED");
  if (items.length > 0) {
    const total = items.reduce((s, i) => s + Number(i.amount), 0);
    if (Math.abs(total - Number(tenancy.annualRent)) > 0.009) {
      await raiseFlag(db, { ...base, code: "CHEQUE_TOTAL_MISMATCH", severity: "WARN" });
    } else {
      await clearFlag(db, { ...base, code: "CHEQUE_TOTAL_MISMATCH" });
    }
  }

  // NOTICE_GATE_WITHIN_30D — clear condition: gate passed or moved out of window
  const gate = await db.deadline.findFirst({
    where: { tenancyId: tenancy.id, kind: "NOTICE_GATE", status: "OPEN" },
  });
  const today = todayInDubai();
  if (gate) {
    const days = daysBetween(today, gate.dueAt);
    if (days >= 0 && days <= 30) {
      await raiseFlag(db, { ...base, code: "NOTICE_GATE_WITHIN_30D", severity: "CRITICAL" });
    } else {
      await clearFlag(db, { ...base, code: "NOTICE_GATE_WITHIN_30D" });
    }
  } else {
    await clearFlag(db, { ...base, code: "NOTICE_GATE_WITHIN_30D" });
  }
}

/** PAYMENT_LATE for a payment item (raised by the late-detection job, T4.3). */
export async function raisePaymentLate(paymentItemId: string, db: Db = prisma) {
  const item = await db.paymentItem.findUnique({
    where: { id: paymentItemId },
    include: { tenancy: true },
  });
  if (!item) return;
  await raiseFlag(db, {
    workspaceId: item.workspaceId,
    scopeType: "PAYMENT_ITEM",
    scopeId: item.id,
    code: "PAYMENT_LATE",
    severity: "CRITICAL",
    tenancyId: item.tenancyId,
    propertyId: item.tenancy.propertyId,
  });
}

export async function clearPaymentLate(paymentItemId: string, db: Db = prisma) {
  const item = await db.paymentItem.findUnique({
    where: { id: paymentItemId },
    include: { tenancy: true },
  });
  if (!item) return;
  await clearFlag(db, {
    workspaceId: item.workspaceId,
    scopeType: "PAYMENT_ITEM",
    scopeId: item.id,
    code: "PAYMENT_LATE",
    tenancyId: item.tenancyId,
    propertyId: item.tenancy.propertyId,
  });
}

/** PROOF_OVERDUE for a proof request (raised by the overdue sweep, T7.1). */
export async function raiseProofOverdue(proofRequestId: string, workspaceId: string, db: Db = prisma) {
  await raiseFlag(db, {
    workspaceId,
    scopeType: "PROOF_REQUEST",
    scopeId: proofRequestId,
    code: "PROOF_OVERDUE",
    severity: "WARN",
  });
}

export async function clearProofOverdue(proofRequestId: string, workspaceId: string, db: Db = prisma) {
  await clearFlag(db, {
    workspaceId,
    scopeType: "PROOF_REQUEST",
    scopeId: proofRequestId,
    code: "PROOF_OVERDUE",
  });
}

/**
 * PR6 renewal risk evaluator (idempotent, per-case).
 *
 * Raises/clears the two Stage-2 renewal codes against the case scope:
 *
 *   PROPOSED_INCREASE_ABOVE_INDEX_BAND — raised when the active Offer
 *   exceeds the index-indicated ceiling. RenewalCase.proposedRent is legacy/cache
 *   data only; the offer row is the source of truth for the live proposal.
 *
 *   RENEWAL_NOTICE_WINDOW_MISSED — raised when today (Asia/Dubai) is past
 *   noticeGateAt and noticeServedAt is still NULL. Cleared once a notice is
 *   served (or the gate is no longer past, e.g. after a noticeGateAt move).
 *
 * Idempotent: safe to call after any field change on the case or its capture;
 * the underlying raise/clear are no-ops if state already matches.
 */
export async function evaluateRenewalRisk(renewalCaseId: string, db: Db = prisma) {
  const rc = await db.renewalCase.findUnique({ where: { id: renewalCaseId } });
  if (!rc || rc.archivedAt) return;

  const base = {
    workspaceId: rc.workspaceId,
    scopeType: "RENEWAL_CASE" as ScopeType,
    scopeId: rc.id,
    tenancyId: rc.tenancyId,
    propertyId: rc.propertyId,
  };

  // PROPOSED_INCREASE_ABOVE_INDEX_BAND
  const capture = rc.indexCaptureId
    ? await db.rentIndexCapture.findUnique({ where: { id: rc.indexCaptureId } })
    : await db.rentIndexCapture.findFirst({
        where: { tenancyId: rc.tenancyId, permittedNewRentMax: { not: null } },
        orderBy: { capturedAt: "desc" },
      });
  const activeOffer = rc.currentOfferId
    ? await db.offer.findUnique({ where: { id: rc.currentOfferId } })
    : await db.offer.findFirst({
        where: { renewalCaseId: rc.id, status: { in: ["SENT", "COUNTERED", "ACCEPTED"] } },
        orderBy: { version: "desc" },
      });
  const ceiling = activeOffer?.permittedMaxSnapshot
    ? Number(activeOffer.permittedMaxSnapshot)
    : capture?.permittedNewRentMax
      ? Number(capture.permittedNewRentMax)
      : null;
  const proposed = activeOffer ? Number(activeOffer.annualRent) : null;
  if (ceiling != null && proposed != null && proposed > ceiling) {
    await raiseFlag(db, { ...base, code: "PROPOSED_INCREASE_ABOVE_INDEX_BAND", severity: "WARN" });
  } else {
    await clearFlag(db, { ...base, code: "PROPOSED_INCREASE_ABOVE_INDEX_BAND" });
  }

  // RENEWAL_NOTICE_WINDOW_MISSED
  const today = todayInDubai();
  const gatePassed = rc.noticeGateAt ? today.getTime() > rc.noticeGateAt.getTime() : false;
  if (gatePassed && !rc.noticeServedAt) {
    await raiseFlag(db, { ...base, code: "RENEWAL_NOTICE_WINDOW_MISSED", severity: "CRITICAL" });
  } else {
    await clearFlag(db, { ...base, code: "RENEWAL_NOTICE_WINDOW_MISSED" });
  }
}

/** TENANCY_OVERLAP raised from import conflict detection (T6.1). */
export async function raiseTenancyOverlap(tenancyId: string, db: Db = prisma) {
  const tenancy = await db.tenancy.findUnique({ where: { id: tenancyId } });
  if (!tenancy) return;
  await raiseFlag(db, {
    workspaceId: tenancy.workspaceId,
    scopeType: "TENANCY",
    scopeId: tenancyId,
    code: "TENANCY_OVERLAP",
    severity: "WARN",
    tenancyId,
    propertyId: tenancy.propertyId,
  });
}

/** Nightly evaluation across a workspace (outbox topic risk.evaluate). */
export async function evaluateWorkspaceRisk(workspaceId: string) {
  // scope-audit: nightly risk evaluation cron, workspace-batch, no persona ctx.
  const tenancies = await prisma.tenancy.findMany({
    where: { workspaceId, archivedAt: null },
    select: { id: true },
  });
  for (const t of tenancies) await evaluateRiskForTenancy(t.id);

  const renewalCases = await prisma.renewalCase.findMany({
    where: { workspaceId, archivedAt: null, status: { notIn: ["RENEWED", "DECLINED", "LAPSED"] } },
    select: { id: true },
  });
  for (const rc of renewalCases) await evaluateRenewalRisk(rc.id);
}

// ── Queries + acknowledge

export async function listRiskFlags(ctx: AuthzContext, opts?: { includeCleared?: boolean }) {
  require_(ctx, "riskflags.read");
  // CLIENT_VIEWER: flags are scope-polymorphic — restrict to the client's scopes.
  const clientIds = ctx.clientPrincipalId
    ? allScopeIds(await resolveClientScopeIds(ctx.workspaceId, ctx.clientPrincipalId))
    : null;
  return prisma.riskFlag.findMany({
    where: {
      ...scope(ctx),
      ...(clientIds ? { scopeId: { in: clientIds } } : {}),
      ...(opts?.includeCleared ? {} : { status: { in: ["OPEN", "ACKNOWLEDGED"] } }),
    },
    orderBy: { raisedAt: "desc" },
  });
}

export async function acknowledgeFlag(ctx: AuthzContext, id: string) {
  require_(ctx, "riskflags.ack");
  const flag = await prisma.riskFlag.findUnique({ where: { id } });
  if (!flag || flag.workspaceId !== ctx.workspaceId) return null;
  return prisma.riskFlag.update({ where: { id }, data: { status: "ACKNOWLEDGED" } });
}
