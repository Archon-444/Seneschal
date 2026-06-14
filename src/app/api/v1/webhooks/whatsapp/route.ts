import crypto from "node:crypto";
import { enqueue } from "@/server/outbox";

// Meta WhatsApp webhook. Inert unless WHATSAPP_PROVIDER=meta. GET is the
// verify-token handshake; POST verifies a raw-body HMAC then defers all side
// effects to the Outbox (§7) and returns 200 fast.

export async function GET(req: Request): Promise<Response> {
  if (process.env.WHATSAPP_PROVIDER !== "meta") return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function POST(req: Request): Promise<Response> {
  if (process.env.WHATSAPP_PROVIDER !== "meta") return new Response("Not found", { status: 404 });
  // Read the raw body BEFORE any JSON parse — the HMAC is computed over it.
  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET ?? "").update(raw).digest("hex");
  if (!safeEqual(sig, expected)) return new Response("Unauthorized", { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* malformed — still 200 so Meta doesn't retry forever */
  }
  await enqueue("whatsapp.status", body);
  return new Response("ok", { status: 200 });
}
