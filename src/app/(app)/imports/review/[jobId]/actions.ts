"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import {
  getExtractionJob,
  rejectExtraction,
  reviewAndCommit,
  type ExtractionFields,
} from "@/server/services/extraction";
import type { ImportRowData } from "@/server/services/imports";

export async function commitReviewedExtractionAction(formData: FormData) {
  const ctx = await requireCtx();
  const jobId = String(formData.get("jobId"));
  const job = await getExtractionJob(ctx, jobId);
  const original = (job.rawOutput ?? {}) as unknown as ExtractionFields;

  const str = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v || undefined;
  };
  const num = (key: string) => {
    const v = str(key);
    return v != null ? Number(v) : undefined;
  };

  const reviewed: ImportRowData = {
    community: str("community") ?? "",
    building: str("building"),
    unitNo: str("unitNo"),
    propertyType: str("propertyType"),
    bedrooms: num("bedrooms"),
    ejariNo: str("ejariNo"),
    startDate: str("startDate") ?? "",
    endDate: str("endDate") ?? "",
    annualRent: num("annualRent") ?? 0,
    depositAmount: num("depositAmount"),
    noticePeriodDays: num("noticePeriodDays"),
    paymentItems: formData.get("paymentItems")
      ? JSON.parse(String(formData.get("paymentItems")))
      : [],
  };

  // every reviewer change becomes a FIELD_CORRECTED evidence event
  const corrections: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of Object.entries(reviewed)) {
    if (key === "paymentItems") continue;
    const before = original[key]?.value ?? null;
    const after = value ?? null;
    if (String(before ?? "") !== String(after ?? "")) {
      corrections[key] = { from: before, to: after };
    }
  }

  await reviewAndCommit(ctx, jobId, reviewed, corrections);
  redirect("/imports");
}

export async function rejectExtractionFormAction(formData: FormData) {
  const ctx = await requireCtx();
  await rejectExtraction(ctx, String(formData.get("jobId")));
  redirect("/imports");
}
