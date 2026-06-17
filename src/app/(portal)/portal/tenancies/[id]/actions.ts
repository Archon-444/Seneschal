"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { uploadTenancyDocument } from "@/server/services/tenancies";
import { respondToOfferAsTenant } from "@/server/services/renewals";
import { viewPaymentReceipt } from "@/server/services/payments";

function s(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// Authenticated tenant self-upload to their own tenancy (2B #16). The service gates
// on tenancies.upload + the tenancy's contact scope, so a tenant can only ever
// upload to a tenancy they hold.
export async function uploadTenancyDocumentAction(formData: FormData) {
  const ctx = await requireCtx();
  const tenancyId = String(formData.get("tenancyId") ?? "");
  const file = formData.get("file") as File | null;
  if (file && file.size > 0) {
    await uploadTenancyDocument(ctx, tenancyId, {
      fileName: file.name,
      mime: file.type || "application/octet-stream",
      data: Buffer.from(await file.arrayBuffer()),
    });
  }
  revalidatePath(`/portal/tenancies/${tenancyId}`);
}

// View a cheque/deposit receipt (2B #18): records DEPOSIT_RECEIPT_VIEWED, then
// redirects to the short-lived signed URL. The service gates on the payment item's
// contact scope, so a tenant only ever views receipts on their own payments.
export async function viewReceiptAction(formData: FormData) {
  const ctx = await requireCtx();
  const { url } = await viewPaymentReceipt(ctx, String(formData.get("documentId") ?? ""));
  redirect(url);
}

// Authenticated counter-offer (2B #17): the tenant accepts / counters / asks about a
// renewal offer on their own tenancy, in-app. respondToOfferAsTenant gates on the
// contact scope, so a tenant can only respond to an offer on a tenancy they hold.
export async function respondToOfferAction(formData: FormData) {
  const ctx = await requireCtx();
  const tenancyId = s(formData, "tenancyId");
  const action = s(formData, "action") as "ACCEPT" | "COUNTER" | "ASK";
  await respondToOfferAsTenant(ctx, s(formData, "offerId"), {
    action,
    annualRent: s(formData, "annualRent") ? Number(s(formData, "annualRent")) : undefined,
    paymentSchedule: s(formData, "paymentSchedule") || undefined,
    note: s(formData, "note") || undefined,
  });
  revalidatePath(`/portal/tenancies/${tenancyId}`);
}
