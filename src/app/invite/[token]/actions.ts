"use server";

import { headers } from "next/headers";
import { acceptInvite } from "@/server/services/members";
import { createSession } from "@/server/auth";
import { establishSessionCookie, landSignedIn } from "@/server/auth/request";

export type AcceptState = { error: string } | { awaitingAssignment: true } | null;

export async function acceptInviteAction(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get("token"));
  const name = String(formData.get("name") ?? "").trim();
  const confirmEmail = String(formData.get("confirmEmail") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) return { error: "Passwords do not match." };
  try {
    const { userId, isPlatformAdmin, intendedRole } = await acceptInvite(token, {
      name: name || undefined,
      confirmEmail: confirmEmail || undefined,
      password,
    });
    // Unassigned agents cannot build a readable context yet (empty book). Do not
    // mint a session — they sign in after the office assigns them.
    if (intendedRole === "MANAGING_AGENT") {
      return { awaitingAssignment: true };
    }
    const h = await headers();
    const sessionToken = await createSession(userId, isPlatformAdmin, {
      ip: h.get("x-forwarded-for") ?? undefined,
      device: h.get("user-agent") ?? undefined,
    });
    await establishSessionCookie(sessionToken);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not accept this invitation." };
  }
  return landSignedIn();
}
