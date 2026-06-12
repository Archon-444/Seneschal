import { NextRequest, NextResponse } from "next/server";
import { runSeed } from "@/server/seed";

// One-time bootstrap for serverless deployments: runs the idempotent Farina
// seed inside the deployment, so no database credential ever leaves the
// project. Same CRON_SECRET guard as /api/v1/jobs/run. Safe to call again —
// every create is find-or-create.

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSeed();
  return NextResponse.json({
    ok: true,
    proofLinkUrl: result.proofLinkUrl, // null when a live link already exists
    signInAs: "farina@example.com",
  });
}
