"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import * as listings from "@/server/services/listings";
import type { ListingInput } from "@/server/services/listings";

// Portal server actions (1B) — thin glue from the landlord forms to the listings
// service. The service enforces capability + owned-property scope; no Prisma here.

function s(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function opt(formData: FormData, key: string): string | undefined {
  return s(formData, key) || undefined;
}
function date(formData: FormData, key: string): Date | null | undefined {
  const v = s(formData, key);
  if (v === "") return undefined; // field absent → leave unchanged
  return new Date(v);
}
/** Tri-state furnishing: "true"/"false" → boolean, anything else → null (unspecified). */
function furnished(formData: FormData): boolean | null {
  const v = s(formData, "furnished");
  return v === "true" ? true : v === "false" ? false : null;
}

function fields(formData: FormData): ListingInput {
  return {
    headline: opt(formData, "headline") ?? null,
    askingRent: s(formData, "askingRent") ? Number(s(formData, "askingRent")) : null,
    availableFrom: date(formData, "availableFrom"),
    furnished: furnished(formData),
    description: opt(formData, "description") ?? null,
    permitRef: opt(formData, "permitRef") ?? null,
    permitExpiry: date(formData, "permitExpiry"),
  };
}

export async function createListingAction(formData: FormData) {
  const ctx = await requireCtx();
  const propertyId = s(formData, "propertyId");
  const listing = await listings.createListing(ctx, propertyId, fields(formData));
  redirect(`/portal/listings/${listing.id}`);
}

export async function updateListingAction(formData: FormData) {
  const ctx = await requireCtx();
  const id = s(formData, "id");
  await listings.updateListing(ctx, id, fields(formData));
  revalidatePath(`/portal/listings/${id}`);
}

export async function publishListingAction(formData: FormData) {
  const ctx = await requireCtx();
  const id = s(formData, "id");
  await listings.publishListing(ctx, id);
  revalidatePath(`/portal/listings/${id}`);
}

export async function archiveListingAction(formData: FormData) {
  const ctx = await requireCtx();
  await listings.archiveListing(ctx, s(formData, "id"));
  redirect("/portal/listings");
}
