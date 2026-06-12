import { NextRequest, NextResponse } from "next/server";
import { verifyFileUrl } from "@/server/storage";
import { logDocumentAccess, readDocumentBytes } from "@/server/services/documents";
import { currentUser } from "@/server/auth/request";

// Signed expiring download endpoint (T5.1). The HMAC signature is the
// authorization; every successful download is logged (T5.2).

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const expires = req.nextUrl.searchParams.get("expires") ?? "";
  const sig = req.nextUrl.searchParams.get("sig") ?? "";

  if (!verifyFileUrl(id, expires, sig)) {
    return NextResponse.json({ error: "Link expired or invalid" }, { status: 403 });
  }
  const stored = await readDocumentBytes(id);
  if (!stored) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const user = await currentUser();
  await logDocumentAccess({
    workspaceId: stored.doc.workspaceId,
    documentId: id,
    action: "DOWNLOADED",
    actorUserId: user?.id,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    device: req.headers.get("user-agent") ?? undefined,
  });

  return new NextResponse(new Uint8Array(stored.data), {
    headers: {
      "Content-Type": stored.doc.mime,
      "Content-Disposition": `attachment; filename="${stored.doc.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
