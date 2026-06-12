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
  // optional body: { "adminEmail": "you@yourdomain" } — added as FIDUCIARY in
  // the Farina workspace so a real inbox can receive the sign-in OTP
  let adminEmail: string | undefined;
  try {
    const body = (await req.json()) as { adminEmail?: string };
    adminEmail = body.adminEmail;
  } catch {
    // empty body is fine
  }
  const result = await runSeed({ adminEmail });
  return NextResponse.json({
    ok: true,
    proofLinkUrl: result.proofLinkUrl, // null when a live link already exists
    signInAs: adminEmail ?? "farina@example.com",
  });
}
