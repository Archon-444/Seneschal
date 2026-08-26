"use server";

import { headers } from "next/headers";
import { acceptInvite } from "@/server/services/members";
import { createSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { establishSessionCookie, landSignedIn } from "@/server/auth/request";

export type AcceptState = { error: string } | null;

export async function acceptInviteAction(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get("token"));
  const name = String(formData.get("name") ?? "").trim();
  const confirmEmail = String(formData.get("confirmEmail") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) return { error: "Passwords do not match." };
  try {
    const { userId } = await acceptInvite(token, {
      name: name || undefined,
      confirmEmail: confirmEmail || undefined,
      password,
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const h = await headers();
    const sessionToken = await createSession(user.id, user.isPlatformAdmin, {
      ip: h.get("x-forwarded-for") ?? undefined,
      device: h.get("user-agent") ?? undefined,
    });
    await establishSessionCookie(sessionToken);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not accept this invitation." };
  }
  await landSignedIn();
}
