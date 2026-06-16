"use server";

import { revalidatePath } from "next/cache";
import type { DocumentKind } from "@prisma/client";
import { requireCtx } from "@/server/auth/request";
import * as passport from "@/server/services/tenantPassport";

// Tenant passport server actions (1C). Thin glue to the service; no Prisma here.

function s(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function opt(formData: FormData, key: string): string | undefined {
  return s(formData, key) || undefined;
}

export async function updatePassportAction(formData: FormData) {
  const ctx = await requireCtx();
  await passport.updateMyPassport(ctx, {
    employer: opt(formData, "employer") ?? null,
    jobTitle: opt(formData, "jobTitle") ?? null,
    monthlyIncome: s(formData, "monthlyIncome") ? Number(s(formData, "monthlyIncome")) : null,
    nationality: opt(formData, "nationality") ?? null,
    householdSize: s(formData, "householdSize") ? Number(s(formData, "householdSize")) : null,
    moveInBy: s(formData, "moveInBy") ? new Date(s(formData, "moveInBy")) : null,
    summary: opt(formData, "summary") ?? null,
    status: s(formData, "status") === "READY" ? "READY" : "DRAFT",
  });
  revalidatePath("/portal/passport");
}

export async function uploadPassportDocumentAction(formData: FormData) {
  const ctx = await requireCtx();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return;
  await passport.uploadPassportDocument(ctx, {
    fileName: file.name,
    mime: file.type || "application/octet-stream",
    data: Buffer.from(await file.arrayBuffer()),
    kind: (opt(formData, "kind") as DocumentKind | undefined) ?? undefined,
  });
  revalidatePath("/portal/passport");
}
