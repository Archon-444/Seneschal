import { NextResponse } from "next/server";
import { requireCtx } from "@/server/auth/request";
import { markRead } from "@/server/services/notifications";
import { AuthzError } from "@/server/authz";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const authzCtx = await requireCtx();
    await markRead(authzCtx, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof AuthzError ? err.status : 500;
    return NextResponse.json({ error: "Not found" }, { status });
  }
}
