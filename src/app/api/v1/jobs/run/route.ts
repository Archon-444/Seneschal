import { NextRequest, NextResponse } from "next/server";
import { dispatchPending } from "@/server/outbox";
import { handlers, runDailyJobs } from "@/server/outbox/runner";

// Cron-triggered job pass for serverless deployments (no resident worker):
// drains the outbox, then runs the daily jobs (late cheques, overdue proofs,
// risk re-evaluation, alert ladders). Vercel Cron calls this with
// "Authorization: Bearer ${CRON_SECRET}" when CRON_SECRET is set.

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dispatched = await dispatchPending(handlers, 100);
  await runDailyJobs();
  // second drain: daily jobs enqueue notifications of their own
  const dispatchedAfter = await dispatchPending(handlers, 100);

  return NextResponse.json({ ok: true, dispatched: dispatched + dispatchedAfter });
}
