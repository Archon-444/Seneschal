"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/request";
import { assignClient, revokeClient } from "@/server/services/assignments";

export async function toggleAssignmentAction(formData: FormData) {
  const ctx = await requireCtx();
  const membershipId = String(formData.get("membershipId"));
  const clientPrincipalId = String(formData.get("clientPrincipalId"));
  if (formData.get("assigned") === "1") {
    await revokeClient(ctx, { membershipId, clientPrincipalId });
  } else {
    await assignClient(ctx, { membershipId, clientPrincipalId });
  }
  revalidatePath("/members/assignments");
}
