import { NextRequest, NextResponse } from "next/server";
import { normalizeAdminEmail, runSeed } from "@/server/seed";

// One-time bootstrap for serverless deployments: runs the idempotent
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
  // the seed workspace so a real inbox can receive the sign-in OTP
  let adminEmail: string | undefined;
  try {
    const body = (await req.json()) as { adminEmail?: string };
    if (body.adminEmail !== undefined) {
      adminEmail = normalizeAdminEmail(String(body.adminEmail));
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("adminEmail")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // empty/non-JSON body is fine
  }
  const result = await runSeed({ adminEmail });
  return NextResponse.json({
    ok: true,
    proofLinkUrl: result.proofLinkUrl, // null when a live link already exists
    signInAs: adminEmail ?? "operator@example.com",
  });
}
