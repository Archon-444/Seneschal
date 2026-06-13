"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ContactKind, DocumentKind, PaymentStatus, ScopeType } from "@prisma/client";
import { requireCtx } from "@/server/auth/request";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as payments from "@/server/services/payments";
import * as documents from "@/server/services/documents";
import * as proofs from "@/server/services/proofs";
import * as secureLinks from "@/server/services/secureLinks";
import * as imports from "@/server/services/imports";
import * as extraction from "@/server/services/extraction";
import * as risk from "@/server/services/risk";
import * as reports from "@/server/services/reports";
import { onboardTenancy, type PartyInput } from "@/server/services/onboarding";
import { dispatchPending } from "@/server/outbox";
import { handlers } from "@/server/outbox/runner";

// Server actions: thin glue from forms to the service layer. No Prisma here.

function s(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function opt(formData: FormData, key: string): string | undefined {
  const v = s(formData, key);
  return v || undefined;
}
function num(formData: FormData, key: string): number | undefined {
  const v = s(formData, key);
  return v ? Number(v) : undefined;
}

export async function createClientAction(formData: FormData) {
  const ctx = await requireCtx();
  await clients.createClient(ctx, { displayName: s(formData, "displayName"), notes: opt(formData, "notes") });
  revalidatePath("/clients");
}

export async function archiveClientAction(formData: FormData) {
  const ctx = await requireCtx();
  await clients.archiveClient(ctx, s(formData, "id"));
  revalidatePath("/clients");
}

export async function createContactAction(formData: FormData) {
  const ctx = await requireCtx();
  await contacts.createContact(ctx, {
    kind: s(formData, "kind") as ContactKind,
    name: s(formData, "name"),
    email: opt(formData, "email"),
    phone: opt(formData, "phone"),
    company: opt(formData, "company"),
  });
  revalidatePath("/contacts");
}

export async function createPropertyAction(formData: FormData) {
  const ctx = await requireCtx();
  const property = await properties.createProperty(ctx, {
    clientPrincipalId: opt(formData, "clientPrincipalId") ?? null,
    community: s(formData, "community"),
    building: opt(formData, "building"),
    unitNo: opt(formData, "unitNo"),
    propertyType: opt(formData, "propertyType"),
    bedrooms: num(formData, "bedrooms"),
    sizeSqft: num(formData, "sizeSqft"),
  });
  redirect(`/properties/${property.id}`);
}

export async function archivePropertyAction(formData: FormData) {
  const ctx = await requireCtx();
  await properties.archiveProperty(ctx, s(formData, "id"));
  redirect("/properties");
}

/** Combined Ejari onboarding: landlord + tenant + asset + tenancy in one submit. */
export async function onboardTenancyAction(formData: FormData) {
  const ctx = await requireCtx();

  const party = (prefix: string): PartyInput | undefined => {
    const name = opt(formData, `${prefix}_name`);
    if (!name) return undefined;
    return {
      name,
      emiratesId: opt(formData, `${prefix}_emiratesId`),
      email: opt(formData, `${prefix}_email`),
      phone: opt(formData, `${prefix}_phone`),
      nationality: opt(formData, `${prefix}_nationality`),
      company: opt(formData, `${prefix}_company`),
      licenseNo: opt(formData, `${prefix}_licenseNo`),
      licensingAuthority: opt(formData, `${prefix}_licensingAuthority`),
    };
  };

  const propertyId = opt(formData, "propertyId");
  const newProperty = propertyId
    ? undefined
    : {
        clientPrincipalId: opt(formData, "pr_clientPrincipalId"),
        community: s(formData, "pr_community"),
        building: opt(formData, "pr_building"),
        unitNo: opt(formData, "pr_unitNo"),
        propertyType: opt(formData, "pr_propertyType"),
        bedrooms: num(formData, "pr_bedrooms"),
        usage: opt(formData, "pr_usage"),
        plotNo: opt(formData, "pr_plotNo"),
        makaniNo: opt(formData, "pr_makaniNo"),
        dewaPremiseNo: opt(formData, "pr_dewaPremiseNo"),
        sizeSqm: num(formData, "pr_sizeSqm"),
      };

  const result = await onboardTenancy(ctx, {
    landlordContactId: opt(formData, "landlordContactId"),
    newLandlord: party("ll"),
    tenantContactId: opt(formData, "tenantContactId"),
    newTenant: party("tn"),
    propertyId,
    newProperty,
    ejariNo: opt(formData, "ejariNo"),
    startDate: new Date(s(formData, "startDate")),
    endDate: new Date(s(formData, "endDate")),
    annualRent: num(formData, "annualRent") ?? 0,
    depositAmount: num(formData, "depositAmount"),
    noticePeriodDays: num(formData, "noticePeriodDays"),
    paymentTermsNote: opt(formData, "paymentTermsNote"),
    chequeCount: num(formData, "chequeCount"),
  });
  redirect(`/properties/${result.propertyId}`);
}

export async function createTenancyAction(formData: FormData) {
  const ctx = await requireCtx();
  const propertyId = s(formData, "propertyId");
  await tenancies.createTenancy(ctx, {
    propertyId,
    tenantContactId: opt(formData, "tenantContactId"),
    landlordContactId: opt(formData, "landlordContactId"),
    ejariNo: opt(formData, "ejariNo"),
    startDate: new Date(s(formData, "startDate")),
    endDate: new Date(s(formData, "endDate")),
    annualRent: num(formData, "annualRent") ?? 0,
    depositAmount: num(formData, "depositAmount"),
    noticePeriodDays: num(formData, "noticePeriodDays"),
  });
  redirect(`/properties/${propertyId}`);
}

export async function setScheduleAction(formData: FormData) {
  const ctx = await requireCtx();
  const tenancyId = s(formData, "tenancyId");
  const propertyId = s(formData, "propertyId");
  const items = JSON.parse(s(formData, "items")) as {
    seq: number; dueDate: string; amount: number; chequeNo?: string; bank?: string;
  }[];
  await payments.setPaymentSchedule(
    ctx,
    tenancyId,
    items.map((i) => ({ ...i, dueDate: new Date(i.dueDate) })),
  );
  revalidatePath(`/properties/${propertyId}`);
}

export async function transitionPaymentAction(formData: FormData) {
  const ctx = await requireCtx();
  await payments.transitionPayment(ctx, s(formData, "paymentItemId"), s(formData, "to") as PaymentStatus);
  revalidatePath(`/properties/${s(formData, "propertyId")}`);
  revalidatePath("/payments");
}

export async function uploadDocumentAction(formData: FormData) {
  const ctx = await requireCtx();
  const file = formData.get("file") as File;
  const doc = await documents.uploadDocument(ctx, {
    scopeType: s(formData, "scopeType") as ScopeType,
    scopeId: opt(formData, "scopeId"),
    kind: s(formData, "kind") as DocumentKind,
    fileName: file.name,
    mime: file.type || "application/octet-stream",
    data: Buffer.from(await file.arrayBuffer()),
  });
  const back = opt(formData, "back");
  if (s(formData, "extract") === "yes") {
    const job = await extraction.createExtractionJob(ctx, doc.id);
    await extraction.runExtraction(job.id);
    redirect(`/imports/review/${job.id}`);
  }
  revalidatePath(back ?? "/vault");
}

export async function archiveDocumentAction(formData: FormData) {
  const ctx = await requireCtx();
  await documents.archiveDocument(ctx, s(formData, "id"));
  revalidatePath("/vault");
}

export async function createProofRequestAction(formData: FormData) {
  const ctx = await requireCtx();
  // the form posts a combined "TYPE:id" scope; explicit fields win if present
  const combined = opt(formData, "scope");
  const [scopeTypeFromCombined, scopeIdFromCombined] = combined?.split(":") ?? [];
  const scopeType =
    (opt(formData, "scopeType") as ScopeType | undefined) ??
    (scopeTypeFromCombined as ScopeType | undefined);
  const scopeId = opt(formData, "scopeId") ?? scopeIdFromCombined;
  if (!scopeType || !scopeId) {
    throw new Error("Proof requests must be related to a client, property or tenancy");
  }
  const request = await proofs.createProofRequest(ctx, {
    scopeType,
    scopeId,
    title: s(formData, "title"),
    requiredEvidence: s(formData, "requiredEvidence"),
    assignedContactId: s(formData, "assignedContactId"),
    dueAt: opt(formData, "dueAt") ? new Date(s(formData, "dueAt")) : undefined,
  });
  await proofs.sendProofRequest(ctx, request.id);
  // serverless: flush so the secure-link email leaves now; cron is the backstop
  await dispatchPending(handlers);
  redirect(`/proofs/${request.id}`);
}

export async function decideProofAction(formData: FormData) {
  const ctx = await requireCtx();
  const id = s(formData, "id");
  await proofs.decideProofRequest(
    ctx,
    id,
    s(formData, "decision") as "APPROVED" | "REJECTED",
    opt(formData, "note"),
  );
  revalidatePath(`/proofs/${id}`);
}

export async function resendProofAction(formData: FormData) {
  const ctx = await requireCtx();
  const id = s(formData, "id");
  await proofs.sendProofRequest(ctx, id);
  await dispatchPending(handlers);
  revalidatePath(`/proofs/${id}`);
}

export async function revokeLinkAction(formData: FormData) {
  const ctx = await requireCtx();
  await secureLinks.revokeSecureLink(ctx, s(formData, "linkId"));
  revalidatePath(`/proofs/${s(formData, "proofId")}`);
}

export async function importCsvAction(formData: FormData) {
  const ctx = await requireCtx();
  const file = formData.get("file") as File;
  const csv = Buffer.from(await file.arrayBuffer()).toString("utf8");
  const parsed = imports.parseCsvRows(csv);
  const batch = await imports.createImportBatch(ctx, "EXCEL");
  await imports.addImportRows(
    ctx,
    batch.id,
    parsed.filter((r) => r.mapped).map((r) => ({ raw: r.raw, mapped: r.mapped! })),
  );
  redirect(`/imports/${batch.id}`);
}

export async function commitBatchAction(formData: FormData) {
  const ctx = await requireCtx();
  const id = s(formData, "id");
  await imports.commitImportBatch(ctx, id);
  revalidatePath(`/imports/${id}`);
}

export async function rollbackBatchAction(formData: FormData) {
  const ctx = await requireCtx();
  const id = s(formData, "id");
  await imports.rollbackImportBatch(ctx, id);
  revalidatePath(`/imports/${id}`);
}

export async function commitExtractionAction(formData: FormData) {
  const ctx = await requireCtx();
  const jobId = s(formData, "jobId");
  const reviewed = JSON.parse(s(formData, "reviewed"));
  const corrections = JSON.parse(s(formData, "corrections") || "{}");
  await extraction.reviewAndCommit(ctx, jobId, reviewed, corrections);
  redirect("/imports");
}

export async function rejectExtractionAction(formData: FormData) {
  const ctx = await requireCtx();
  await extraction.rejectExtraction(ctx, s(formData, "jobId"));
  redirect("/imports");
}

export async function ackFlagAction(formData: FormData) {
  const ctx = await requireCtx();
  await risk.acknowledgeFlag(ctx, s(formData, "id"));
  revalidatePath("/risk");
}

export async function generateReportAction(formData: FormData) {
  const ctx = await requireCtx();
  const clientId = s(formData, "clientPrincipalId");
  const { report } = await reports.generateClientReport(ctx, clientId);
  redirect(`/reports/${report.id}`);
}
