import { NextRequest, NextResponse } from "next/server";
import { requireCtx } from "@/server/auth/request";
import { exportClientCsv } from "@/server/services/reports";
import { AuthzError } from "@/server/authz";

// CSV export of the client's underlying tables (D14). Writes REPORT_EXPORTED.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const authzCtx = await requireCtx();
    const csv = await exportClientCsv(authzCtx, id);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="client-${id}.csv"`,
      },
    });
  } catch (err) {
    const status = err instanceof AuthzError ? err.status : 500;
    return NextResponse.json({ error: "Export failed" }, { status });
  }
}
