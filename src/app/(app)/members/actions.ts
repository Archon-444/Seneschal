"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/request";
import {
  grantBundle,
  inviteOrgAdmin,
  removeMember,
  revokeBundle,
  revokeInvite,
} from "@/server/services/members";

export type InviteState = { ok: true; url: string } | { ok: false; error: string } | null;

export async function inviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const ctx = await requireCtx();
  try {
    const result = await inviteOrgAdmin(ctx, String(formData.get("email") ?? ""));
    revalidatePath("/members");
    return { ok: true, url: result.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invite failed." };
  }
}

export async function grantOrgAdminAction(formData: FormData) {
  const ctx = await requireCtx();
  await grantBundle(ctx, { membershipId: String(formData.get("membershipId")), bundle: "ORG_ADMIN" });
  revalidatePath("/members");
}

export async function revokeOrgAdminAction(formData: FormData) {
  const ctx = await requireCtx();
  await revokeBundle(ctx, { membershipId: String(formData.get("membershipId")), bundle: "ORG_ADMIN" });
  revalidatePath("/members");
}

export async function removeMemberAction(formData: FormData) {
  const ctx = await requireCtx();
  await removeMember(ctx, String(formData.get("membershipId")));
  revalidatePath("/members");
}

export async function revokeInviteAction(formData: FormData) {
  const ctx = await requireCtx();
  await revokeInvite(ctx, String(formData.get("inviteId")));
  revalidatePath("/members");
}
