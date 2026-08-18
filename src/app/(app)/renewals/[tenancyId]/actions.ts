"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/request";
import { requestOwnerApproval } from "@/server/services/approvals";

export type OwnerApprovalState = { ok: true; url: string } | { ok: false; error: string } | null;

export async function requestOwnerApprovalAction(
  _prev: OwnerApprovalState,
  formData: FormData,
): Promise<OwnerApprovalState> {
  const ctx = await requireCtx();
  const tenancyId = String(formData.get("tenancyId") ?? "");
  try {
    const result = await requestOwnerApproval(ctx, {
      offerId: String(formData.get("offerId") ?? ""),
      contactId: String(formData.get("contactId") ?? ""),
    });
    revalidatePath(`/renewals/${tenancyId}`);
    return { ok: true, url: result.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not request owner sign-off." };
  }
}
