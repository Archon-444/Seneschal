import { NextRequest, NextResponse } from "next/server";
import type { Cadence, NotificationCategory } from "@prisma/client";
import { requireCtx } from "@/server/auth/request";
import { getMyNotificationPreferences, setNotificationPreference } from "@/server/services/notifications";
import { AuthzError } from "@/server/authz";

const CATEGORIES = ["DEADLINES", "PAYMENTS", "RENEWALS", "PROOFS", "RISK", "DIGEST"];
const CADENCES = ["IMMEDIATE", "DAILY", "WEEKLY", "OFF"];

export async function GET() {
  try {
    const ctx = await requireCtx();
    return NextResponse.json({ preferences: await getMyNotificationPreferences(ctx) });
  } catch (err) {
    const status = err instanceof AuthzError ? err.status : 500;
    return NextResponse.json({ error: "Could not load preferences" }, { status });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireCtx();
    const body = (await req.json()) as { category?: string; cadence?: string; inAppEnabled?: boolean };
    if (!body.category || !CATEGORIES.includes(body.category) || !body.cadence || !CADENCES.includes(body.cadence)) {
      return NextResponse.json({ error: "Invalid preference" }, { status: 422 });
    }
    await setNotificationPreference(
      ctx,
      body.category as NotificationCategory,
      body.cadence as Cadence,
      body.inAppEnabled ?? true,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof AuthzError ? err.status : 500;
    return NextResponse.json({ error: "Could not save preference" }, { status });
  }
}
