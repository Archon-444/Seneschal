"use server";

import { redirect } from "next/navigation";
import { acceptInvite } from "@/server/services/members";

export type AcceptState = { error: string } | null;

export async function acceptInviteAction(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get("token"));
  const name = String(formData.get("name") ?? "").trim();
  const confirmEmail = String(formData.get("confirmEmail") ?? "").trim();
  try {
    await acceptInvite(token, { name: name || undefined, confirmEmail: confirmEmail || undefined });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not accept this invitation." };
  }
  // The invitee now sets their own sign-in (email OTP) — the operator never set a credential.
  redirect("/login?invited=1");
}
