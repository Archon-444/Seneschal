"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/request";
import { acknowledgeMoveIn } from "@/server/services/moveIn";

// Persona acknowledges their own side of a move-in; the service infers the party
// from the role, so a tenant can never acknowledge on the landlord's behalf.
export async function acknowledgeMoveInAction(formData: FormData) {
  const ctx = await requireCtx();
  await acknowledgeMoveIn(ctx, String(formData.get("id") ?? ""));
  revalidatePath("/portal/movein");
}
