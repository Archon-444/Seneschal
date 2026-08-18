import { beforeAll, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as listings from "@/server/services/listings";

// 1B issue #1 — Listings scoping + readiness + evidence.
//
// Listings are quarantined from the product surface. The operator (FIDUCIARY) still
// holds listings.* so this suite can prove the archived module's logic intact.
// LANDLORD/TENANT no longer hold those caps (pilot role shrink).

let W: TestActor; // operator (FIDUCIARY)
let landlord: TestActor;
let tenant: TestActor;

let ownPropertyId: string;
let siblingPropertyId: string;
let ownListingId: string;
let siblingListingId: string;

beforeAll(async () => {
  await resetDb();
  W = await makeWorkspace("Listings WS");

  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const landlordContact = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Own Landlord" });
  const siblingLandlordContact = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Sibling Landlord" });
  const tenantContact = await contacts.createContact(W.ctx, { kind: "TENANT", name: "A Tenant" });

  const ownProperty = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: landlordContact.id,
    community: "Dubai Marina",
    building: "Tower A",
    unitNo: "101",
    bedrooms: 2,
    sizeSqft: 1180,
  });
  ownPropertyId = ownProperty.id;

  const siblingProperty = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: siblingLandlordContact.id,
    community: "JLT",
    building: "Tower B",
    unitNo: "202",
    bedrooms: 1,
  });
  siblingPropertyId = siblingProperty.id;

  const siblingListing = await listings.createListing(W.ctx, siblingProperty.id, {
    headline: "Sibling unit",
    askingRent: 70000,
  });
  siblingListingId = siblingListing.id;

  landlord = await addMember(W.workspaceId, "LANDLORD", undefined, landlordContact.id);
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tenantContact.id);
});

describe("create + scope", () => {
  it("operator creates a listing and gets a readiness score", async () => {
    const created = await listings.createListing(W.ctx, ownPropertyId, {
      headline: "Marina 2BR",
      askingRent: 95000,
    });
    ownListingId = created.id;
    expect(created.propertyId).toBe(ownPropertyId);
    expect(created.readinessScore).toBeGreaterThan(0);

    const evidence = await prisma.evidenceEvent.findFirst({
      where: { type: "LISTING_CREATED", scopeId: created.id },
    });
    expect(evidence).toBeTruthy();
  });

  it("LANDLORD has no listings write surface", async () => {
    await expect(
      listings.createListing(landlord.ctx, siblingPropertyId, { headline: "nope" }),
    ).rejects.toThrow(/listings\.write/);
  });

  it("LANDLORD has no listings read surface", async () => {
    await expect(listings.listListings(landlord.ctx)).rejects.toThrow(/listings\.read/);
    await expect(listings.getListing(landlord.ctx, ownListingId)).rejects.toThrow(/listings\.read/);
    await expect(listings.getListing(landlord.ctx, siblingListingId)).rejects.toThrow(/listings\.read/);
  });

  it("operator sees every listing in the workspace", async () => {
    const rows = await listings.listListings(W.ctx);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(ownListingId);
    expect(ids).toContain(siblingListingId);
  });

  it("TENANT has no listings surface (capability denied)", async () => {
    await expect(listings.listListings(tenant.ctx)).rejects.toThrow(/listings\.read/);
  });
});

describe("readiness gate governs publication", () => {
  it("refuses to publish a listing missing a required check (no permit)", async () => {
    await expect(listings.publishListing(W.ctx, ownListingId)).rejects.toThrow(/not ready/i);
  });

  it("publishes once required checks pass and score clears the threshold", async () => {
    await listings.updateListing(W.ctx, ownListingId, {
      permitRef: "RERA-7781234",
      availableFrom: new Date("2026-08-01"),
      furnished: true,
      description: "Bright corner two-bed with full Marina view and covered parking included.",
    });
    const published = await listings.publishListing(W.ctx, ownListingId);
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedAt).toBeTruthy();

    const evidence = await prisma.evidenceEvent.findFirst({
      where: { type: "LISTING_PUBLISHED", scopeId: ownListingId },
    });
    expect(evidence).toBeTruthy();
  });
});
