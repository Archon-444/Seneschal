import { NextRequest, NextResponse } from "next/server";
import { normalizeAdminEmail, runSeed } from "@/server/seed";

// One-time bootstrap for serverless deployments: runs the idempotent
// seed inside the deployment, so no database credential ever leaves the
// project. Same CRON_SECRET guard as /api/v1/jobs/run. Safe to call again —
// every create is find-or-create.

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // H9: default-deny. Requires BOTH the cron secret AND an explicit opt-in flag,
  // so an exposed CRON_SECRET alone can't bootstrap/overwrite a deployment's data.
  const secret = process.env.CRON_SECRET;
  const enabled = process.env.SEED_API_ENABLED === "true";
  if (!enabled || !secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
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
  // H9: never echo the sign-in identity in a production response — it points an
  // attacker who already breached the gate at a real account. Surface it only to
  // the server log in prod; dev keeps it in the response for convenience.
  const signInAs = adminEmail ?? "operator@example.com";
  if (process.env.NODE_ENV === "production") {
    console.log(`[seed] sign in as ${signInAs}`);
    return NextResponse.json({ ok: true, proofLinkUrl: result.proofLinkUrl });
  }
  return NextResponse.json({
    ok: true,
    proofLinkUrl: result.proofLinkUrl, // null when a live link already exists
    signInAs,
  });
}
