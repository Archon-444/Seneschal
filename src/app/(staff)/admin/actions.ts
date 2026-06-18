"use server";

import { revalidatePath } from "next/cache";
import type { WorkspaceType } from "@prisma/client";
import { requirePlatformAdmin } from "@/server/auth/request";
import {
  archiveWorkspace,
  provisionWorkspace,
  suspendWorkspace,
  unsuspendWorkspace,
} from "@/server/admin/provisioning";

// Platform-plane server actions. Every handler re-gates with requirePlatformAdmin() (defense in
// depth over the layout gate) and runs under PlatformAdminContext — never a data service.

export type ProvisionState = { ok: true; inviteUrl: string } | { ok: false; error: string } | null;

export async function provisionAction(_prev: ProvisionState, formData: FormData): Promise<ProvisionState> {
  const ctx = await requirePlatformAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "FIDUCIARY") as WorkspaceType;
  const customerName = String(formData.get("customerName") ?? "").trim();
  const customerEmail = String(formData.get("customerEmail") ?? "").trim().toLowerCase();
  if (!name || !customerName || !customerEmail) {
    return { ok: false, error: "Organisation, principal name and email are all required." };
  }
  try {
    const result = await provisionWorkspace(ctx, { name, type, customerName, customerEmail });
    revalidatePath("/admin");
    return { ok: true, inviteUrl: result.inviteUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Provisioning failed." };
  }
}

export async function suspendAction(formData: FormData) {
  const ctx = await requirePlatformAdmin();
  await suspendWorkspace(ctx, String(formData.get("workspaceId")));
  revalidatePath("/admin");
}

export async function unsuspendAction(formData: FormData) {
  const ctx = await requirePlatformAdmin();
  await unsuspendWorkspace(ctx, String(formData.get("workspaceId")));
  revalidatePath("/admin");
}

export async function archiveAction(formData: FormData) {
  const ctx = await requirePlatformAdmin();
  await archiveWorkspace(ctx, String(formData.get("workspaceId")));
  revalidatePath("/admin");
}
