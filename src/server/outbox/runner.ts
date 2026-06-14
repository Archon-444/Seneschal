import { dispatchPending, type OutboxHandler } from "./index";
import { deliverNotification } from "../notify";
import { applyWhatsappEvents } from "../notify/whatsappEvents";
import { detectLatePayments } from "../services/payments";
import { sweepOverdueProofRequests } from "../services/proofs";
import { evaluateWorkspaceRisk } from "../services/risk";
import { runAlertLadders, sendWeeklyDigest } from "../services/alerts";
import { prisma } from "../db";

// In-process job runner (T0.3). Polls the outbox and runs daily jobs.
// Run with: pnpm worker

export const handlers: Record<string, OutboxHandler> = {
  "notification.send": deliverNotification,
  "risk.evaluate": async (payload) => {
    await evaluateWorkspaceRisk(payload.workspaceId as string);
  },
  "payments.late_check": async (payload) => {
    await detectLatePayments(payload.workspaceId as string | undefined);
  },
  "whatsapp.status": applyWhatsappEvents,
};

/** One daily pass: late cheques, overdue proofs, risk re-evaluation, ladders, digest. */
export async function runDailyJobs(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({ where: { archivedAt: null } });
  for (const ws of workspaces) {
    await detectLatePayments(ws.id);
    await sweepOverdueProofRequests(ws.id);
    await evaluateWorkspaceRisk(ws.id);
    await runAlertLadders(ws.id);
    await sendWeeklyDigest(ws.id); // self-throttles to once a week
  }
}

async function main() {
  console.log("[worker] outbox runner started");
  let lastDaily = 0;
  for (;;) {
    try {
      await dispatchPending(handlers);
      if (Date.now() - lastDaily > 60 * 60 * 1000) {
        await runDailyJobs();
        lastDaily = Date.now();
      }
    } catch (err) {
      console.error("[worker] loop error:", err);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

if (process.argv[1]?.endsWith("runner.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
