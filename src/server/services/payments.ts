import { Prisma, type EvidenceType, type Instrument, type PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_, scope } from "../authz";
import { recordEvidence } from "../evidence";
import { toUtcDateOnly, todayInDubai } from "../calculators/dates";
import { regenerateDeadlinesForTenancy } from "./deadlines";
import { clearPaymentLate, evaluateRiskForTenancy, raisePaymentLate } from "./risk";
import { enqueue } from "../outbox";
import { getTenancy } from "./tenancies";

// Payments register (E4) — record-keeping only, Seneschal never holds funds.

export interface PaymentItemInput {
  seq: number;
  dueDate: Date;
  amount: number;
  instrument?: Instrument;
  chequeNo?: string;
  bank?: string;
  notes?: string;
}

/** Replace a tenancy's payment schedule (T4.1). Σ≠annualRent warns, never blocks. */
export async function setPaymentSchedule(
  ctx: AuthzContext,
  tenancyId: string,
  items: PaymentItemInput[],
) {
  require_(ctx, "payments.write");
  const tenancy = await getTenancy(ctx, tenancyId);

  const seqs = new Set(items.map((i) => i.seq));
  if (seqs.size !== items.length) throw new AuthzError("Duplicate seq in schedule", 422);

  await prisma.$transaction(async (tx) => {
    // keep items that already moved past SCHEDULED; replace the rest
    const movable = await tx.paymentItem.findMany({
      where: { tenancyId, status: "SCHEDULED" },
    });
    await tx.paymentItem.deleteMany({
      where: { id: { in: movable.map((m) => m.id) } },
    });
    for (const item of items) {
      const clash = await tx.paymentItem.findFirst({ where: { tenancyId, seq: item.seq } });
      if (clash) continue; // seq already held by a non-SCHEDULED item — keep history
      await tx.paymentItem.create({
        data: {
          workspaceId: ctx.workspaceId,
          tenancyId,
          seq: item.seq,
          dueDate: toUtcDateOnly(item.dueDate),
          amount: new Prisma.Decimal(item.amount),
          instrument: item.instrument ?? "CHEQUE",
          chequeNo: item.chequeNo,
          bank: item.bank,
          notes: item.notes,
        },
      });
    }
  });
  await regenerateDeadlinesForTenancy(tenancyId);
  await evaluateRiskForTenancy(tenancyId); // CHEQUE_TOTAL_MISMATCH check
  void tenancy;
  return prisma.paymentItem.findMany({ where: { tenancyId }, orderBy: { seq: "asc" } });
}

// T4.2 — state machine. Each transition writes its matching EvidenceEvent.
const TRANSITIONS: Partial<Record<PaymentStatus, PaymentStatus[]>> = {
  SCHEDULED: ["REQUESTED", "RECEIVED", "LATE", "CANCELLED"],
  REQUESTED: ["RECEIVED", "LATE", "CANCELLED"],
  RECEIVED: ["DEPOSITED", "CANCELLED"],
  DEPOSITED: ["CLEARED", "BOUNCED"],
  LATE: ["RECEIVED", "CANCELLED"],
  BOUNCED: ["RECEIVED", "CANCELLED"],
  CLEARED: [],
  CANCELLED: [],
};

const TRANSITION_EVIDENCE: Partial<Record<PaymentStatus, EvidenceType>> = {
  RECEIVED: "CHEQUE_RECEIVED",
  DEPOSITED: "CHEQUE_DEPOSITED",
  CLEARED: "CHEQUE_CLEARED",
  BOUNCED: "CHEQUE_BOUNCED",
  REQUESTED: "CHEQUE_DUE",
};

export async function transitionPayment(
  ctx: AuthzContext,
  paymentItemId: string,
  to: PaymentStatus,
  opts?: { proofDocId?: string; notes?: string },
) {
  require_(ctx, "payments.write");
  const item = await prisma.paymentItem.findUnique({
    where: { id: paymentItemId },
    include: { tenancy: true },
  });
  assertSameWorkspace(ctx, item);

  const allowed = TRANSITIONS[item!.status] ?? [];
  if (!allowed.includes(to)) {
    throw new AuthzError(`Invalid payment transition ${item!.status} → ${to}`, 422);
  }
  if (opts?.proofDocId) {
    const doc = await prisma.document.findUnique({ where: { id: opts.proofDocId } });
    assertSameWorkspace(ctx, doc);
  }

  const updated = await prisma.paymentItem.update({
    where: { id: paymentItemId },
    data: {
      status: to,
      proofDocId: opts?.proofDocId ?? undefined,
      confirmedById: ctx.userId,
      notes: opts?.notes ?? undefined,
    },
  });

  const evidenceType = TRANSITION_EVIDENCE[to];
  if (evidenceType) {
    await recordEvidence({
      workspaceId: ctx.workspaceId,
      type: evidenceType,
      actorType: ctx.isStaff ? "STAFF" : "USER",
      actorId: ctx.userId,
      onBehalfOfId: ctx.onBehalfOfId,
      scopeType: "PAYMENT_ITEM",
      scopeId: paymentItemId,
      tenancyId: item!.tenancyId,
      propertyId: item!.tenancy.propertyId,
      payload: {
        from: item!.status,
        to,
        seq: item!.seq,
        amount: String(item!.amount),
        chequeNo: item!.chequeNo,
        proofDocId: opts?.proofDocId ?? null,
        confirmedBy: ctx.userId,
      },
    });
  }

  if (["RECEIVED", "CLEARED", "CANCELLED"].includes(to)) {
    await clearPaymentLate(paymentItemId);
  }
  return updated;
}

/**
 * Late detection job (T4.3). Marks LATE anything past due without RECEIVED+,
 * raises PAYMENT_LATE and queues a reminder. Idempotent across reruns.
 */
export async function detectLatePayments(workspaceId?: string): Promise<number> {
  const today = todayInDubai();
  const due = await prisma.paymentItem.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      status: { in: ["SCHEDULED", "REQUESTED"] },
      dueDate: { lt: today },
    },
    include: { tenancy: true },
  });
  for (const item of due) {
    await prisma.paymentItem.update({ where: { id: item.id }, data: { status: "LATE" } });
    await raisePaymentLate(item.id);
    await enqueue("notification.send", {
      kind: "payment_late_reminder",
      workspaceId: item.workspaceId,
      paymentItemId: item.id,
    });
  }
  return due.length;
}

export async function listPayments(
  ctx: AuthzContext,
  opts?: { tenancyId?: string; status?: PaymentStatus },
) {
  require_(ctx, "payments.read");
  return prisma.paymentItem.findMany({
    where: {
      ...scope(ctx),
      ...(opts?.tenancyId ? { tenancyId: opts.tenancyId } : {}),
      ...(opts?.status ? { status: opts.status } : {}),
      ...(ctx.clientPrincipalId
        ? { tenancy: { property: { clientPrincipalId: ctx.clientPrincipalId } } }
        : {}),
    },
    orderBy: [{ dueDate: "asc" }, { seq: "asc" }],
    include: { tenancy: { include: { property: true } } },
  });
}
