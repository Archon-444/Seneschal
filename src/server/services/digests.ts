import type { NotificationMessage } from "@prisma/client";
import { prisma } from "../db";
import { notify } from "../notify";
import { workspaceOverseers } from "../notify/recipients";
import { loadPreferenceMap, type PreferenceMap } from "../notify/preferences";
import { todayInDubai, formatDubaiDate } from "../calculators/dates";

// Per-user email digest (PR5). The in-app feed is the live surface; email is a
// batched backstop. A user's undigested feed items are rolled into ONE email on
// their cadence. `digestedAt` is set ONLY here (single meaning: "included in a
// digest"), so immediate/urgent items whose email permanently FAILED can still be
// swept into the next digest rather than silently dropped.

const DAILY_WINDOW_MS = 20 * 3_600_000; // self-throttle: one daily digest / 20h
const WEEKLY_WINDOW_MS = 6 * 86_400_000; // one weekly digest / 6 days

type Run = "daily" | "weekly";

export async function sendUserDailyDigests(workspaceId: string): Promise<number> {
  return runDigests(workspaceId, "daily");
}

export async function sendUserWeeklyDigests(workspaceId: string): Promise<number> {
  return runDigests(workspaceId, "weekly");
}

async function runDigests(workspaceId: string, run: Run): Promise<number> {
  // Recipients: anyone with pending feed items, plus (weekly only) every overseer
  // so the portfolio summary still lands on a quiet week.
  const pending = await prisma.notificationMessage.findMany({
    where: { workspaceId, channel: "INAPP", digestedAt: null, toUserId: { not: null } },
    select: { toUserId: true },
    distinct: ["toUserId"],
  });
  let recipients = pending.map((r) => r.toUserId!).filter(Boolean);
  if (run === "weekly") {
    recipients = [...new Set([...recipients, ...(await workspaceOverseers(workspaceId))])];
  }
  if (recipients.length === 0) return 0;

  const prefs = await loadPreferenceMap(workspaceId, recipients);
  let sent = 0;
  for (const userId of recipients) {
    if (await flushDigest(workspaceId, userId, run, prefs)) sent++;
  }
  return sent;
}

async function flushDigest(
  workspaceId: string,
  userId: string,
  run: Run,
  prefs: PreferenceMap,
): Promise<boolean> {
  const isDaily = run === "daily";
  const templateCode = isDaily ? "daily_digest_v1" : "weekly_digest_v1";
  const windowMs = isDaily ? DAILY_WINDOW_MS : WEEKLY_WINDOW_MS;

  // Self-throttle (the single time-gate): one digest of this kind per window.
  const recent = await prisma.notificationMessage.findFirst({
    where: { workspaceId, toUserId: userId, templateCode, createdAt: { gte: new Date(Date.now() - windowMs) } },
  });
  if (recent) return false;

  const items = await prisma.notificationMessage.findMany({
    where: { workspaceId, toUserId: userId, channel: "INAPP", digestedAt: null },
    orderBy: { createdAt: "asc" },
  });

  // Failed-send fallback (daily run only, for faster recovery): immediate/urgent
  // items whose linked email reached terminal FAILED get swept in here.
  let failedEmailIds = new Set<string>();
  if (isDaily) {
    const emailIds = items.map((i) => i.emailMessageId).filter((x): x is string => x != null);
    if (emailIds.length) {
      const failed = await prisma.notificationMessage.findMany({
        where: { id: { in: emailIds }, status: "FAILED" },
        select: { id: true },
      });
      failedEmailIds = new Set(failed.map((f) => f.id));
    }
  }

  const targetCadence = isDaily ? "DAILY" : "WEEKLY";
  const selected = items.filter((it) => {
    const cadence = prefs.cadence(userId, it.category ?? "DEADLINES");
    const matchesRun = !it.urgent && cadence === targetCadence;
    const fallback = isDaily && it.emailMessageId != null && failedEmailIds.has(it.emailMessageId);
    return matchesRun || fallback;
  });

  // Weekly run also carries the portfolio summary, independent of item count,
  // unless the user has muted the DIGEST category.
  const summary = !isDaily && prefs.cadence(userId, "DIGEST") !== "OFF" ? await portfolioSummary(workspaceId) : "";

  if (selected.length === 0 && !summary) return false;

  const today = todayInDubai();
  await notify({
    workspaceId,
    channel: "EMAIL",
    templateCode,
    subject: `Seneschal ${isDaily ? "daily" : "weekly"} digest — ${formatDubaiDate(today)}`,
    body: composeBody(selected, summary),
    toUserId: userId,
  });

  if (selected.length) {
    await prisma.notificationMessage.updateMany({
      where: { id: { in: selected.map((s) => s.id) } },
      data: { digestedAt: new Date() },
    });
  }
  return true;
}

const CATEGORY_LABEL: Record<string, string> = {
  DEADLINES: "Deadlines",
  PAYMENTS: "Payments",
  RENEWALS: "Renewals",
  PROOFS: "Proof requests",
  RISK: "Risk flags",
  ENQUIRIES: "Enquiries",
  DIGEST: "Summary",
};

function composeBody(items: NotificationMessage[], summary: string): string {
  const sections: string[] = [];
  if (summary) sections.push(summary);
  const byCategory = new Map<string, NotificationMessage[]>();
  for (const it of items) {
    const key = it.category ?? "DEADLINES";
    const arr = byCategory.get(key) ?? [];
    arr.push(it);
    byCategory.set(key, arr);
  }
  for (const [cat, rows] of byCategory) {
    const lines = rows.map((r) => `  • ${r.subject ?? r.templateCode ?? "Notification"}`).join("\n");
    sections.push(`${CATEGORY_LABEL[cat] ?? cat}\n${lines}`);
  }
  return sections.join("\n\n");
}

async function portfolioSummary(workspaceId: string): Promise<string> {
  // scope-audit: workspace-batch digest cron (no ctx); intentionally a whole-workspace
  // roll-up for the operator digest, never served to a client-scoped or delegate context.
  const today = todayInDubai();
  const in7 = new Date(today.getTime() + 7 * 86_400_000);
  const [deadlines, flags, proofs] = await Promise.all([
    prisma.deadline.count({ where: { workspaceId, status: "OPEN", dueAt: { gte: today, lte: in7 } } }),
    prisma.riskFlag.count({ where: { workspaceId, status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    prisma.proofRequest.count({ where: { workspaceId, status: { notIn: ["APPROVED", "CLOSED"] } } }),
  ]);
  return `This week: ${deadlines} deadlines due in 7 days · ${flags} open risk flags · ${proofs} open proof requests.`;
}
