"use server";

import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { AuthzError } from "@/server/authz";
import {
  getExtractionJob,
  rejectExtraction,
  reviewAndCommit,
  type ExtractionFields,
} from "@/server/services/extraction";
import { parsePaymentInstrument, type ImportPartyFields, type ImportRowData } from "@/server/services/imports";

export type ReviewCommitState = { error: string } | null;

function isNextRedirect(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

function str(formData: FormData, key: string): string | undefined {
  const v = String(formData.get(key) ?? "").trim();
  return v || undefined;
}

function num(formData: FormData, key: string): number | undefined {
  const v = str(formData, key);
  return v != null ? Number(v) : undefined;
}

function party(formData: FormData, prefix: string): ImportPartyFields | undefined {
  const name = str(formData, `${prefix}_name`);
  const fields: ImportPartyFields = {
    name,
    emiratesId: str(formData, `${prefix}_emiratesId`),
    email: str(formData, `${prefix}_email`),
    phone: str(formData, `${prefix}_phone`),
    nationality: str(formData, `${prefix}_nationality`),
    company: str(formData, `${prefix}_company`),
    licenseNo: str(formData, `${prefix}_licenseNo`),
    licensingAuthority: str(formData, `${prefix}_licensingAuthority`),
  };
  return Object.values(fields).some(Boolean) ? fields : undefined;
}

function paymentItems(formData: FormData): ImportRowData["paymentItems"] {
  const items: NonNullable<ImportRowData["paymentItems"]> = [];
  for (let i = 0; i < 24; i++) {
    const dueDate = str(formData, `pay_${i}_dueDate`);
    const amount = num(formData, `pay_${i}_amount`);
    if (!dueDate || amount == null || !Number.isFinite(amount)) continue;
    items.push({
      seq: num(formData, `pay_${i}_seq`) ?? i + 1,
      dueDate,
      amount,
      chequeNo: str(formData, `pay_${i}_chequeNo`),
      bank: str(formData, `pay_${i}_bank`),
      instrument: parsePaymentInstrument(formData.get(`pay_${i}_instrument`)),
    });
  }
  return items;
}

export async function commitReviewedExtractionAction(
  _prev: ReviewCommitState,
  formData: FormData,
): Promise<ReviewCommitState> {
  const ctx = await requireCtx();
  const jobId = String(formData.get("jobId"));
  const job = await getExtractionJob(ctx, jobId);
  const original = (job.rawOutput ?? {}) as unknown as ExtractionFields;

  const landlord = party(formData, "ll");
  const tenant = party(formData, "tn");

  const reviewed: ImportRowData = {
    community: str(formData, "community") ?? "",
    building: str(formData, "building"),
    unitNo: str(formData, "unitNo"),
    propertyType: str(formData, "propertyType"),
    bedrooms: num(formData, "bedrooms"),
    clientPrincipalId: str(formData, "clientPrincipalId"),
    propertyId: str(formData, "propertyId"),
    usage: str(formData, "usage"),
    plotNo: str(formData, "plotNo"),
    makaniNo: str(formData, "makaniNo"),
    dewaPremiseNo: str(formData, "dewaPremiseNo"),
    sizeSqm: num(formData, "sizeSqm"),
    ejariNo: str(formData, "ejariNo"),
    startDate: str(formData, "startDate") ?? "",
    endDate: str(formData, "endDate") ?? "",
    annualRent: num(formData, "annualRent") ?? 0,
    depositAmount: num(formData, "depositAmount"),
    noticePeriodDays: num(formData, "noticePeriodDays"),
    paymentTermsNote: str(formData, "paymentTermsNote"),
    landlordContactId: str(formData, "landlordContactId"),
    tenantContactId: str(formData, "tenantContactId"),
    landlordName: landlord?.name,
    tenantName: tenant?.name,
    landlord,
    tenant,
    chequeCount: num(formData, "chequeCount"),
    paymentItems: paymentItems(formData),
  };

  const scalarKeys: (keyof ImportRowData)[] = [
    "community",
    "building",
    "unitNo",
    "propertyType",
    "bedrooms",
    "usage",
    "ejariNo",
    "startDate",
    "endDate",
    "annualRent",
    "depositAmount",
    "noticePeriodDays",
    "landlordName",
    "tenantName",
  ];
  const corrections: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of scalarKeys) {
    const before = original[key]?.value ?? null;
    const after = reviewed[key] ?? null;
    if (String(before ?? "") !== String(after ?? "")) {
      corrections[key] = { from: before, to: after };
    }
  }

  try {
    const { propertyId } = await reviewAndCommit(ctx, jobId, reviewed, corrections);
    redirect(`/properties/${propertyId}`);
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    const message = e instanceof AuthzError || e instanceof Error ? e.message : "Could not commit this extraction.";
    return { error: message };
  }
}

export async function rejectExtractionFormAction(formData: FormData) {
  const ctx = await requireCtx();
  await rejectExtraction(ctx, String(formData.get("jobId")));
  redirect("/imports");
}
