"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/request";
import { markAllRead } from "@/server/services/notifications";

export async function markAllReadAction() {
  const ctx = await requireCtx();
  await markAllRead(ctx);
  revalidatePath("/notifications");
}
