import { NextResponse } from "next/server";
import { requireCtx } from "@/server/auth/request";
import { markAllRead } from "@/server/services/notifications";
import { AuthzError } from "@/server/authz";

export async function POST() {
  try {
    const ctx = await requireCtx();
    return NextResponse.json({ marked: await markAllRead(ctx) });
  } catch (err) {
    const status = err instanceof AuthzError ? err.status : 500;
    return NextResponse.json({ error: "Could not mark read" }, { status });
  }
}
