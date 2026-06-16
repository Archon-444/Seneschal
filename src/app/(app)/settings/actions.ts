"use server";

import { revalidatePath } from "next/cache";
import type { Cadence, NotificationCategory } from "@prisma/client";
import { requireCtx } from "@/server/auth/request";
import { updateProfile } from "@/server/services/profile";
import { setNotificationPreference } from "@/server/services/notifications";

const CATEGORIES: NotificationCategory[] = ["DEADLINES", "PAYMENTS", "RENEWALS", "PROOFS", "RISK", "DIGEST"];
const CADENCES = new Set(["IMMEDIATE", "DAILY", "WEEKLY", "OFF"]);

export async function updateProfileAction(formData: FormData) {
  const ctx = await requireCtx();
  await updateProfile(ctx, {
    name: String(formData.get("name") ?? "").trim() || undefined,
    locale: String(formData.get("locale") ?? "").trim() || undefined,
  });
  revalidatePath("/settings");
}

export async function updateNotificationPrefsAction(formData: FormData) {
  const ctx = await requireCtx();
  for (const category of CATEGORIES) {
    const cadence = String(formData.get(`cadence_${category}`) ?? "");
    if (!CADENCES.has(cadence)) continue;
    const inAppEnabled = formData.get(`inapp_${category}`) === "on";
    await setNotificationPreference(ctx, category, cadence as Cadence, inAppEnabled);
  }
  revalidatePath("/settings");
}
