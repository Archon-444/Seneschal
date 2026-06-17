"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import * as listings from "@/server/services/listings";
import * as offers from "@/server/services/offers";
import * as contractPack from "@/server/services/contractPack";
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

export async function proposeOfferAction(formData: FormData) {
  const ctx = await requireCtx();
  const listingId = s(formData, "listingId");
  await offers.proposeNewTenancyOffer(ctx, listingId, {
    party: s(formData, "party") === "TENANT" ? "TENANT" : "LANDLORD",
    annualRent: Number(s(formData, "annualRent")),
    paymentSchedule: s(formData, "paymentSchedule") || "1 cheque",
    note: opt(formData, "note"),
  });
  revalidatePath(`/portal/listings/${listingId}`);
}

export async function acceptOfferAction(formData: FormData) {
  const ctx = await requireCtx();
  await offers.acceptNewTenancyOffer(ctx, s(formData, "offerId"));
  revalidatePath(`/portal/listings/${s(formData, "listingId")}`);
}

export async function generateContractPackAction(formData: FormData) {
  const ctx = await requireCtx();
  await contractPack.generateContractPack(ctx, s(formData, "offerId"));
  revalidatePath(`/portal/listings/${s(formData, "listingId")}`);
}

export async function sendContractPackAction(formData: FormData) {
  const ctx = await requireCtx();
  await contractPack.markContractPackSent(ctx, s(formData, "packId"), opt(formData, "eSignRef"));
  revalidatePath(`/portal/listings/${s(formData, "listingId")}`);
}

export async function signContractPackAction(formData: FormData) {
  const ctx = await requireCtx();
  await contractPack.markContractPackSigned(ctx, s(formData, "packId"), opt(formData, "eSignRef"));
  revalidatePath(`/portal/listings/${s(formData, "listingId")}`);
}

/** useActionState handler: mint a public share link and return its one-time URL
 *  for display (the raw token is shown once, never logged or persisted in cleartext). */
export async function createListingShareLinkAction(
  _prev: { url?: string; error?: string },
  formData: FormData,
): Promise<{ url?: string; error?: string }> {
  const ctx = await requireCtx();
  try {
    const { url } = await listings.createListingShareLink(ctx, s(formData, "id"));
    return { url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create link" };
  }
}
