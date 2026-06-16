import { NextResponse } from "next/server";
import { requireCtx } from "@/server/auth/request";
import { unreadCount } from "@/server/services/notifications";
import { AuthzError } from "@/server/authz";

export async function GET() {
  try {
    const ctx = await requireCtx();
    return NextResponse.json({ count: await unreadCount(ctx) });
  } catch (err) {
    const status = err instanceof AuthzError ? err.status : 500;
    return NextResponse.json({ error: "Could not load count" }, { status });
  }
}
