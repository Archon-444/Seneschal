import { NextRequest, NextResponse } from "next/server";
import { processInboundProofEmail } from "@/server/services/emailIntake";

// Email intake (T7.4): the email provider's inbound webhook posts parsed
// messages here. The reply-to address carries the secure-link token
// (proof+<token>@intake domain), so attachments land on the right request
// through the same pipeline as link uploads. No business logic inline —
// the service validates and records everything.

export async function POST(req: NextRequest) {
  let body: {
    to?: string;
    from?: string;
    subject?: string;
    text?: string;
    attachments?: { filename: string; contentType?: string; content: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await processInboundProofEmail({
    to: body.to ?? "",
    from: body.from ?? "",
    subject: body.subject,
    text: body.text,
    attachments: (body.attachments ?? []).map((a) => ({
      fileName: a.filename,
      mime: a.contentType ?? "application/octet-stream",
      data: Buffer.from(a.content, "base64"),
    })),
  });

  // Always 200 to the provider; outcome detail stays internal.
  return NextResponse.json({ accepted: result.accepted });
}
