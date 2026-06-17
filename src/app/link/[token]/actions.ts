"use server";

import { headers } from "next/headers";
import { validateLinkToken, consumeLinkUse } from "@/server/services/secureLinks";
import { consumeRateLimit } from "@/server/services/rateLimit";
import { isQuarantined } from "@/server/config/features";
import { submitProofViaLink } from "@/server/services/proofs";
import { respondToOfferViaLink } from "@/server/services/renewals";
import { createEnquiryFromLink } from "@/server/services/enquiries";
import { recordLinkMessagingOptIn } from "@/server/services/consent";
import { dispatchPending } from "@/server/outbox";
import { handlers } from "@/server/outbox/runner";

export type SubmitState =
  | { status: "idle" }
  | { status: "done" }
  | { status: "error"; message: string };

export type OfferResponseState =
  | { status: "idle" }
  | { status: "done"; action: "ACCEPT" | "COUNTER" | "ASK" }
  | { status: "error"; message: string };

export async function respondToOfferAction(
  _prev: OfferResponseState,
  formData: FormData,
): Promise<OfferResponseState> {
  const token = String(formData.get("token") ?? "");
  const validation = await validateLinkToken(token);
  if (!validation.ok) return { status: "error", message: "This link is no longer available." };

  const action = String(formData.get("action") ?? "") as "ACCEPT" | "COUNTER" | "ASK";
  if (!["ACCEPT", "COUNTER", "ASK"].includes(action)) {
    return { status: "error", message: "Choose accept, counter, or ask." };
  }
  const rent = String(formData.get("annualRent") ?? "").trim();
  try {
    await respondToOfferViaLink(validation.link, {
      action,
      annualRent: rent ? Number(rent) : undefined,
      paymentSchedule: String(formData.get("paymentSchedule") ?? "").trim() || undefined,
      paymentMethod: String(formData.get("paymentMethod") ?? "").trim() || undefined,
      note: String(formData.get("note") ?? "").trim() || undefined,
    });
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Could not record your response." };
  }
  if (String(formData.get("optIn") ?? "") === "on") {
    try {
      await recordLinkMessagingOptIn(validation.link);
    } catch {
      /* opt-in is best-effort; never fail the response on it */
    }
  }
  return { status: "done", action };
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;
// H5 upload caps. The total request body is already hard-capped by Next's
// serverActions.bodySizeLimit; these guard the count and the per-(link, IP)
// submission rate that the body limit doesn't.
const MAX_FILES_PER_REQUEST = 10;
const PROOF_RATE_LIMIT = 10; // submissions per window per (linkId, ip)
const PROOF_RATE_WINDOW_MS = 5 * 60_000;

export async function submitProofAction(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const token = String(formData.get("token") ?? "");
  const validation = await validateLinkToken(token);
  if (!validation.ok) {
    return { status: "error", message: "This link is no longer available." };
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { status: "error", message: "Choose at least one file." };
  if (files.length > MAX_FILES_PER_REQUEST) {
    return { status: "error", message: `Please upload at most ${MAX_FILES_PER_REQUEST} files at a time.` };
  }
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return { status: "error", message: `${f.name} is larger than 15 MB.` };
    }
  }

  const h = await headers();
  // H5: durable per-(link, IP) rate limit BEFORE consuming or ingesting — rejects
  // an abusive burst cheaply, and survives serverless cold starts (Postgres-backed).
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim() || "unknown";
  const rl = await consumeRateLimit(`proof:${validation.link.id}:${ip}`, PROOF_RATE_LIMIT, PROOF_RATE_WINDOW_MS);
  if (!rl.ok) {
    return { status: "error", message: "Too many attempts. Please wait a few minutes and try again." };
  }

  // H4: consume the use atomically BEFORE the side effect. Under concurrent
  // requests to a capped link exactly one consume wins; the loser short-circuits
  // here and never runs submitProofViaLink, so a maxUses=1 link can't
  // double-submit. Trade-off: a subsequent storage failure burns the use (the
  // tenant gets a re-issued link) — strictly safer than today's consume-after,
  // which let two concurrent uploads both land before either consumed.
  const { consumed } = await consumeLinkUse(validation.link.id);
  if (!consumed) return { status: "error", message: "This link is no longer available." };

  await submitProofViaLink(
    validation.link,
    await Promise.all(
      files.map(async (f) => ({
        fileName: f.name,
        mime: f.type || "application/octet-stream",
        data: Buffer.from(await f.arrayBuffer()),
      })),
    ),
    String(formData.get("note") ?? "") || undefined,
    {
      ip: h.get("x-forwarded-for") ?? undefined,
      device: h.get("user-agent") ?? undefined,
    },
  );
  return { status: "done" };
}

export async function submitEnquiryAction(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  // Enquiry is the public response to a LISTING_VIEW link — quarantined with
  // listings, and POST-able even though the listing page no longer renders.
  if (isQuarantined("listings")) return { status: "error", message: "This link is no longer available." };
  const token = String(formData.get("token") ?? "");
  const validation = await validateLinkToken(token);
  if (!validation.ok) return { status: "error", message: "This link is no longer available." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { status: "error", message: "Please enter your name." };
  try {
    await createEnquiryFromLink(validation.link, {
      name,
      email: String(formData.get("email") ?? "").trim() || undefined,
      phone: String(formData.get("phone") ?? "").trim() || undefined,
      message: String(formData.get("message") ?? "").trim() || undefined,
    });
    await dispatchPending(handlers);
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Could not send your enquiry." };
  }
  return { status: "done" };
}
