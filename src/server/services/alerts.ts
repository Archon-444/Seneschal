import { prisma } from "../db";
import { notify } from "../notify";
import { recordEvidence } from "../evidence";
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
};

/** Run all ladders for a workspace. Called daily by the worker. */
export async function runAlertLadders(workspaceId: string): Promise<number> {
  const today = todayInDubai();
  const admins = await prisma.membership.findMany({
    where: { workspaceId, revokedAt: null, role: { in: ["WORKSPACE_ADMIN", "FIDUCIARY", "MANAGER"] } },
    include: { user: true },
  });
  if (admins.length === 0) return 0;

  let sent = 0;
  for (const [templateCode, ladder] of Object.entries(LADDERS)) {
    const deadlines = await prisma.deadline.findMany({
      where: { workspaceId, status: "OPEN", kind: { in: ladder.kinds as never } },
      include: { tenancy: { include: { property: true } } },
    });
    for (const deadline of deadlines) {
      const daysOut = daysBetween(today, deadline.dueAt);
      for (const rung of ladder.rungs) {
        if (daysOut !== rung.daysBefore) continue;
        const already = await prisma.evidenceEvent.findFirst({
          where: {
            workspaceId,
            type: "REMINDER_SENT",
            scopeType: "TENANCY",
            scopeId: deadline.tenancyId ?? deadline.id,
            payload: { path: ["deadlineId"], equals: deadline.id },
            AND: { payload: { path: ["rung"], equals: rung.code } },
          },
        });
        if (already) continue;

        const where = deadline.tenancy?.property
          ? `${deadline.tenancy.property.community} ${deadline.tenancy.property.unitNo ?? ""}`.trim()
          : "your portfolio";
        for (const admin of admins) {
          await notify({
            workspaceId,
            channel: "EMAIL",
            templateCode,
            subject: `${deadline.kind.replace(/_/g, " ")} — ${where} — ${formatDubaiDate(deadline.dueAt)}`,
            body:
              `Deadline reminder (${rung.code}).\n\n` +
              `Kind: ${deadline.kind}\nProperty: ${where}\nDue: ${formatDubaiDate(deadline.dueAt)}\n\n` +
              `Review before action. This is record-keeping assistance, not legal advice.`,
            toUserId: admin.userId,
            relatedType: "TENANCY",
            relatedId: deadline.tenancyId ?? undefined,
          });
        }
        await recordEvidence({
          workspaceId,
          type: "REMINDER_SENT",
          actorType: "SYSTEM",
          scopeType: "TENANCY",
          scopeId: deadline.tenancyId ?? deadline.id,
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

/** Weekly digest email (T9.2). */
export async function sendWeeklyDigest(workspaceId: string): Promise<void> {
  const today = todayInDubai();
  const in7 = new Date(today.getTime() + 7 * 86_400_000);
  const [deadlines, flags, proofs] = await Promise.all([
    prisma.deadline.count({ where: { workspaceId, status: "OPEN", dueAt: { gte: today, lte: in7 } } }),
    prisma.riskFlag.count({ where: { workspaceId, status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    prisma.proofRequest.count({ where: { workspaceId, status: { notIn: ["APPROVED", "CLOSED"] } } }),
  ]);
  const admins = await prisma.membership.findMany({
    where: { workspaceId, revokedAt: null, role: { in: ["WORKSPACE_ADMIN", "FIDUCIARY"] } },
  });
  for (const admin of admins) {
    await notify({
      workspaceId,
      channel: "EMAIL",
      templateCode: "weekly_digest_v1",
      subject: `Seneschal weekly digest — ${formatDubaiDate(today)}`,
      body: `This week: ${deadlines} deadlines due in 7 days · ${flags} open risk flags · ${proofs} open proof requests.`,
      toUserId: admin.userId,
    });
  }
}
