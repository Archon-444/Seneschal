import { NextRequest, NextResponse } from "next/server";
import { requireCtx } from "@/server/auth/request";
import { evidencePackFilename, exportEvidencePack } from "@/server/services/evidencePack";
import { AuthzError } from "@/server/authz";

// Evidence pack PDF per tenancy. Writes EVIDENCE_PACK_EXPORTED + EXPORTED access logs.

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const authzCtx = await requireCtx();
    const pdf = await exportEvidencePack(authzCtx, id);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${evidencePackFilename(id)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const status = err instanceof AuthzError ? err.status : 500;
    return NextResponse.json({ error: "Export failed" }, { status });
  }
}
