"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/request";
import { assignProperty, revokeProperty } from "@/server/services/assignments";

export async function toggleAssignmentAction(formData: FormData) {
  const ctx = await requireCtx();
  const membershipId = String(formData.get("membershipId"));
  const propertyId = String(formData.get("propertyId"));
  if (formData.get("assigned") === "1") {
    await revokeProperty(ctx, { membershipId, propertyId });
  } else {
    await assignProperty(ctx, { membershipId, propertyId });
  }
  revalidatePath("/members/assignments");
}
