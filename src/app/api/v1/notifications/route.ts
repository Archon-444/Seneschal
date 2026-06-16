import { NextRequest, NextResponse } from "next/server";
import { requireCtx } from "@/server/auth/request";
import { listMyNotifications } from "@/server/services/notifications";
import { AuthzError } from "@/server/authz";

// The caller's own in-app feed (self-scoped). Backs the notification bell.

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireCtx();
    const { searchParams } = req.nextUrl;
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;
    const result = await listMyNotifications(ctx, {
      cursor: searchParams.get("cursor") ?? undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      unreadOnly: searchParams.get("unreadOnly") === "1",
    });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof AuthzError ? err.status : 500;
    return NextResponse.json({ error: "Could not load notifications" }, { status });
  }
}
