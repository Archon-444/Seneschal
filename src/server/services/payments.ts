import { Prisma, type EvidenceType, type Instrument, type PaymentStatus } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, isDelegateRole, require_, scope } from "../authz";
import { recordEvidence } from "../evidence";
import { formatDubaiDate, toUtcDateOnly, todayInDubai } from "../calculators/dates";
import { regenerateDeadlinesForTenancy } from "./deadlines";
import { clearPaymentLate, evaluateRiskForTenancy, raisePaymentLate } from "./risk";
import { recordNotification } from "../notify/record";
import { workspaceOverseers } from "../notify/recipients";
import { loadPreferenceMap, type PreferenceMap } from "../notify/preferences";
import { assertReadable, contactScopedWhere } from "./contactScope";
import { assertClientInDelegateScope, clientSetScopedWhere } from "./delegateScope";
import { getTenancy } from "./tenancies";
import { getDocument, logDocumentAccess } from "./documents";
import { signedFileUrl } from "../storage";

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
    include: { tenancy: { include: { property: true } } },
  });
  if (isDelegateRole(ctx.role)) {
    assertClientInDelegateScope(
      ctx,
      item ? { workspaceId: item.workspaceId, clientPrincipalId: item.tenancy.property.clientPrincipalId } : null,
    );
  } else {
    assertSameWorkspace(ctx, item);
  }

  const allowed = TRANSITIONS[item!.status] ?? [];
  if (!allowed.includes(to)) {
    throw new AuthzError(`Invalid payment transition ${item!.status} → ${to}`, 422);
  }
  if (opts?.proofDocId) {
    const doc = await prisma.document.findUnique({ where: { id: opts.proofDocId } });
    // assertReadable gates the proof doc by client scope for a delegate, workspace for an operator.
    if (isDelegateRole(ctx.role)) await assertReadable(ctx, { kind: "document", row: doc });
    else assertSameWorkspace(ctx, doc);
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

  // A bounced cheque is can't-miss — alert overseers immediately (urgent bypasses
  // any digest cadence), in addition to the CHEQUE_BOUNCED evidence above.
  if (to === "BOUNCED") {
    const where = item!.tenancy.property
      ? `${item!.tenancy.property.community} ${item!.tenancy.property.unitNo ?? ""}`.trim()
      : "a property";
    await recordNotification({
      workspaceId: ctx.workspaceId,
      templateCode: "payment_bounced_v1",
      subject: `Cheque bounced — ${where} — ${item!.chequeNo ?? `#${item!.seq}`}`,
      body:
        `A cheque has been recorded as BOUNCED.\n\n` +
        `Property: ${where}\nCheque: ${item!.chequeNo ?? `#${item!.seq}`} · ${String(item!.amount)} AED\n\n` +
        `Record-keeping reminder only — Seneschal holds no funds. Review before action.`,
      recipientUserIds: await workspaceOverseers(ctx.workspaceId),
      urgent: true,
      relatedType: "TENANCY",
      relatedId: item!.tenancyId,
    });
  }
  return updated;
}

/**
 * Late detection job (T4.3). Marks LATE anything past due without RECEIVED+,
 * raises PAYMENT_LATE and sends a reminder to the workspace's overseers.
 * Idempotent across reruns: each item flips to LATE here, so the SCHEDULED/
 * REQUESTED filter excludes it next time — one reminder per item.
 */
export async function detectLatePayments(workspaceId?: string): Promise<number> {
  const today = todayInDubai();
  // scope-audit: system late-detection job (cron), workspace-batch, no persona ctx.
  const due = await prisma.paymentItem.findMany({
    where: {
      ...(workspaceId ? { workspaceId } : {}),
      status: { in: ["SCHEDULED", "REQUESTED"] },
      dueDate: { lt: today },
    },
    include: { tenancy: { include: { property: true } } },
  });

  // Resolve each workspace's overseers + cadence prefs once (no per-item N+1).
  const overseersByWorkspace = new Map<string, { ids: string[]; prefs: PreferenceMap }>();
  async function overseersFor(wsId: string) {
    let entry = overseersByWorkspace.get(wsId);
    if (!entry) {
      const ids = await workspaceOverseers(wsId);
      entry = { ids, prefs: await loadPreferenceMap(wsId, ids) };
      overseersByWorkspace.set(wsId, entry);
    }
    return entry;
  }

  for (const item of due) {
    await prisma.paymentItem.update({ where: { id: item.id }, data: { status: "LATE" } });
    await raisePaymentLate(item.id);

    const where = item.tenancy.property
      ? `${item.tenancy.property.community} ${item.tenancy.property.unitNo ?? ""}`.trim()
      : "a property";
    const { ids, prefs } = await overseersFor(item.workspaceId);
    await recordNotification({
      workspaceId: item.workspaceId,
      templateCode: "payment_late_v1",
      subject: `Cheque overdue — ${where} — ${formatDubaiDate(item.dueDate)}`,
      body:
        `A scheduled payment is past due and not yet recorded as received.\n\n` +
        `Property: ${where}\nCheque: ${item.chequeNo ?? `#${item.seq}`} · ${String(item.amount)} AED\n` +
        `Was due: ${formatDubaiDate(item.dueDate)}\n\n` +
        `Record-keeping reminder only — Seneschal holds no funds. Review before action.`,
      recipientUserIds: ids,
      relatedType: "TENANCY",
      relatedId: item.tenancyId,
      prefs,
    });
  }
  return due.length;
}

/**
 * The read-only cheque/deposit receipt vault (2B #18). Receipt documents are
 * PAYMENT_ITEM-scoped, so a tenant reaches them only through their own payment items'
 * contact scope. Returns the receipts for a tenancy's items, keyed by payment item.
 */
export async function listTenancyReceipts(ctx: AuthzContext, tenancyId: string) {
  require_(ctx, "payments.read");
  await getTenancy(ctx, tenancyId); // contact-scope gate
  const items = await prisma.paymentItem.findMany({ where: { workspaceId: ctx.workspaceId, tenancyId }, select: { id: true } });
  const docs = await prisma.document.findMany({
    where: { workspaceId: ctx.workspaceId, scopeType: "PAYMENT_ITEM", scopeId: { in: items.map((i) => i.id) }, archivedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return docs; // each doc.scopeId is its payment item id
}

/**
 * Mint a signed URL for a payment receipt AND record DEPOSIT_RECEIPT_VIEWED. Goes
 * through getDocument first, so the persona contact-scope check (assertReadable) gates
 * it — a tenant can only view receipts on their own payment items. Restricted to
 * PAYMENT_ITEM-scoped documents so it cannot be used as a generic file door.
 */
export async function viewPaymentReceipt(ctx: AuthzContext, documentId: string) {
  require_(ctx, "payments.read");
  const doc = await getDocument(ctx, documentId); // assertReadable persona/scope gate
  if (doc.scopeType !== "PAYMENT_ITEM" || !doc.scopeId) {
    throw new AuthzError("Not a payment receipt", 422);
  }
  await logDocumentAccess({ workspaceId: ctx.workspaceId, documentId, actorUserId: ctx.userId, action: "VIEWED" });
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "DEPOSIT_RECEIPT_VIEWED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "PAYMENT_ITEM",
    scopeId: doc.scopeId,
    payload: { documentId },
  });
  return { url: signedFileUrl(documentId), fileName: doc.fileName };
}

export async function listPayments(
  ctx: AuthzContext,
  opts?: { tenancyId?: string; status?: PaymentStatus },
) {
  require_(ctx, "payments.read");
  const base = ctx.subjectContactId
    ? await contactScopedWhere(ctx, "PAYMENT_ITEM")
    : isDelegateRole(ctx.role)
      ? await clientSetScopedWhere(ctx, "PAYMENT_ITEM")
      : {
          ...scope(ctx),
          ...(ctx.clientPrincipalId
            ? { tenancy: { property: { clientPrincipalId: ctx.clientPrincipalId } } }
            : {}),
        };
  return prisma.paymentItem.findMany({
    where: {
      ...base,
      ...(opts?.tenancyId ? { tenancyId: opts.tenancyId } : {}),
      ...(opts?.status ? { status: opts.status } : {}),
    },
    orderBy: [{ dueDate: "asc" }, { seq: "asc" }],
    include: { tenancy: { include: { property: true } } },
  });
}
