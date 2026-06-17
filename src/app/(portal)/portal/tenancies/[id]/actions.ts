"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/request";
import { uploadTenancyDocument } from "@/server/services/tenancies";

// Authenticated tenant self-upload to their own tenancy (2B #16). The service gates
// on tenancies.upload + the tenancy's contact scope, so a tenant can only ever
// upload to a tenancy they hold.
export async function uploadTenancyDocumentAction(formData: FormData) {
  const ctx = await requireCtx();
  const tenancyId = String(formData.get("tenancyId") ?? "");
  const file = formData.get("file") as File | null;
  if (file && file.size > 0) {
    await uploadTenancyDocument(ctx, tenancyId, {
      fileName: file.name,
      mime: file.type || "application/octet-stream",
      data: Buffer.from(await file.arrayBuffer()),
    });
  }
  revalidatePath(`/portal/tenancies/${tenancyId}`);
}
