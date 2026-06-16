import { prisma } from "../db";
import { recordNotification } from "../notify/record";
import { workspaceOverseers } from "../notify/recipients";
import { loadPreferenceMap } from "../notify/preferences";
import { recordEvidence } from "../evidence";
import { resolveEffectiveIndex } from "./renewals";
import { decree43 } from "../calculators/rent";
import { daysBetween, formatDubaiDate, todayInDubai } from "../calculators/dates";

// Alert ladders (T9.2), config-defined per P3 workflow templates. Ladders run
// from Deadline rows; every send is REMINDER_SENT evidence. Idempotent: a rung
// fires once per deadline (checked against prior REMINDER_SENT events).

export interface LadderRung {
  /** days before dueAt (negative = after) */
  daysBefore: number;
  code: string;
}

export const LADDERS: Record<string, { kinds: string[]; rungs: LadderRung[] }> = {
  notice_gate_v1: {
    kinds: ["NOTICE_GATE"],
    rungs: [
      { daysBefore: 120, code: "T-120" },
      { daysBefore: 100, code: "T-100" },
      { daysBefore: 95, code: "T-95" },
      { daysBefore: 3, code: "72h-in-window" },
    ],
  },
  cheque_v1: {
    kinds: ["CHEQUE_DUE"],
    rungs: [
      { daysBefore: 7, code: "T-7" },
      { daysBefore: 0, code: "due" },
      { daysBefore: -3, code: "T+3" },
    ],
  },
  // RERA permit expiry on a listing (1B #3): a lapsed permit means the unit can no
  // longer be advertised, so warn well ahead and again as it closes in.
  listing_permit_v1: {
    kinds: ["PERMIT_EXPIRY"],
    rungs: [
      { daysBefore: 60, code: "T-60" },
      { daysBefore: 30, code: "T-30" },
      { daysBefore: 7, code: "T-7" },
    ],
  },
};

/** Run all ladders for a workspace. Called daily by the worker. */
export async function runAlertLadders(workspaceId: string): Promise<number> {
  const today = todayInDubai();
  const overseerIds = await workspaceOverseers(workspaceId);
  if (overseerIds.length === 0) return 0;
  // Batch the cadence prefs once for the whole run (no per-event N+1).
  const prefs = await loadPreferenceMap(workspaceId, overseerIds);

  let sent = 0;
  for (const [templateCode, ladder] of Object.entries(LADDERS)) {
    const deadlines = await prisma.deadline.findMany({
      where: { workspaceId, status: "OPEN", kind: { in: ladder.kinds as never } },
      include: { tenancy: { include: { property: true } } },
    });
    for (const deadline of deadlines) {
      const daysOut = daysBetween(today, deadline.dueAt);
      // Permit-expiry deadlines carry no tenancy; resolve the property directly so the
      // reminder still names the unit and the evidence is property- (not tenancy-) scoped.
      const prop =
        deadline.tenancy?.property ??
        (deadline.propertyId
          ? await prisma.property.findUnique({
              where: { id: deadline.propertyId },
              select: { community: true, unitNo: true },
            })
          : null);
      const where = prop ? `${prop.community} ${prop.unitNo ?? ""}`.trim() : "your portfolio";
      const evScopeType = deadline.tenancyId ? "TENANCY" : "PROPERTY";
      const evScopeId = deadline.tenancyId ?? deadline.propertyId ?? deadline.id;
      for (const rung of ladder.rungs) {
        if (daysOut !== rung.daysBefore) continue;
        const already = await prisma.evidenceEvent.findFirst({
          where: {
            workspaceId,
            type: "REMINDER_SENT",
            scopeType: evScopeType,
            scopeId: evScopeId,
            payload: { path: ["deadlineId"], equals: deadline.id },
            AND: { payload: { path: ["rung"], equals: rung.code } },
          },
        });
        if (already) continue;

        // RERA enrichment: notice-gate ladder only, and only when an index resolves.
        // Carries the index-based ceiling estimate + value-at-risk into the reminder.
        let subjectSuffix = "";
        let bodySuffix = "";
        if (templateCode === "notice_gate_v1" && deadline.tenancyId && deadline.tenancy) {
          const eff = await resolveEffectiveIndex(workspaceId, deadline.tenancyId, deadline.tenancy.property);
          if (eff) {
            const pos = decree43(Number(deadline.tenancy.annualRent), eff.marketRentAvg);
            const aed = (n: number) => `AED ${Math.round(n).toLocaleString("en-AE")}`;
            subjectSuffix = ` — est. ${aed(pos.valueAtRisk)}/yr at stake`;
            bodySuffix =
              `\n\nIndex-based ceiling estimate: ${aed(pos.ceiling)}.\n` +
              `Estimated ${aed(pos.valueAtRisk)}/yr at risk if a valid renewal notice is not served by ` +
              `${formatDubaiDate(deadline.dueAt)}. Based on supplied data and the captured index ` +
              `(source captured ${formatDubaiDate(eff.capturedAt)}). Review before action — record-keeping ` +
              `assistance, not legal advice.`;
          }
        }

        await recordNotification({
          workspaceId,
          templateCode,
          subject: `${deadline.kind.replace(/_/g, " ")} — ${where} — ${formatDubaiDate(deadline.dueAt)}${subjectSuffix}`,
          body:
            `Deadline reminder (${rung.code}).\n\n` +
            `Kind: ${deadline.kind}\nProperty: ${where}\nDue: ${formatDubaiDate(deadline.dueAt)}\n\n` +
            `Review before action. This is record-keeping assistance, not legal advice.` +
            bodySuffix,
          recipientUserIds: overseerIds,
          // The final 72h rung is the can't-miss one — always email immediately.
          urgent: rung.code === "72h-in-window",
          relatedType: evScopeType,
          relatedId: evScopeId,
          prefs,
        });
        await recordEvidence({
          workspaceId,
          type: "REMINDER_SENT",
          actorType: "SYSTEM",
          scopeType: evScopeType,
          scopeId: evScopeId,
          tenancyId: deadline.tenancyId,
          propertyId: deadline.propertyId,
          payload: { deadlineId: deadline.id, rung: rung.code, template: templateCode },
        });
        sent++;
      }
    }
  }
  return sent;
}
