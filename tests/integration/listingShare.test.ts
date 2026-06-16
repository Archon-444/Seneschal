import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as listings from "@/server/services/listings";
import * as landlords from "@/server/services/landlords";
import { validateLinkToken } from "@/server/services/secureLinks";

// 1B #4 — Public listing link. A landlord mints a no-login LISTING_VIEW link for a
// PUBLISHED listing; the link/[token] dispatcher renders marketing fields only,
// records a LISTING_VIEWED event, and never exposes a draft/archived listing.

let W: TestActor;
let landlord: TestActor;
let ownerContactId: string;
let listingId: string;

function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Share WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  ownerContactId = owner.id;
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: owner.id,
    community: "Dubai Marina",
    building: "Tower A",
    unitNo: "101",
    bedrooms: 2,
    sizeSqft: 1180,
  });
  landlord = await addMember(W.workspaceId, "LANDLORD", undefined, owner.id);

  const listing = await listings.createListing(landlord.ctx, property.id, {
    headline: "Marina 2BR",
    askingRent: 95000,
    availableFrom: new Date("2026-08-01"),
    furnished: true,
    description: "Bright corner two-bed with full Marina view and covered parking included.",
    permitRef: "RERA-7781234",
  });
  listingId = listing.id;
});

describe("createListingShareLink", () => {
  it("refuses to share a draft listing", async () => {
    await expect(listings.createListingShareLink(landlord.ctx, listingId)).rejects.toThrow(/published/i);
  });

  it("a role without listings.publish cannot mint a link", async () => {
    const agent = await addMember(W.workspaceId, "AGENT");
    await expect(listings.createListingShareLink(agent.ctx, listingId)).rejects.toThrow(/listings\.publish/);
  });

  it("mints a link for a published listing; the public view records LISTING_VIEWED", async () => {
    await landlords.verifyLandlord(W.ctx, ownerContactId);
    await listings.publishListing(landlord.ctx, listingId);

    const { url } = await listings.createListingShareLink(landlord.ctx, listingId);
    expect(url).toContain("/link/");

    const validation = await validateLinkToken(tokenOf(url));
    expect(validation.ok).toBe(true);
    if (!validation.ok) throw new Error("link invalid");

    const view = await listings.getListingForLink(validation.link);
    expect(view).toBeTruthy();
    expect(view!.askingRent).toBe(95000);
    expect(view!.bedrooms).toBe(2);
    expect(view!.ownerVerified).toBe(true);
    // marketing fields only — no owner/tenant identity on the public model
    expect(Object.keys(view!)).not.toContain("ownerContactId");

    const viewed = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "LISTING_VIEWED", scopeId: listingId },
    });
    expect(viewed).toBeTruthy();

    const link = await prisma.secureLink.findUnique({ where: { id: validation.link.id } });
    expect(link!.useCount).toBe(1);
  });

  it("never exposes a listing once it is archived", async () => {
    await listings.publishListing(landlord.ctx, listingId);
    const { url } = await listings.createListingShareLink(landlord.ctx, listingId);
    await listings.archiveListing(landlord.ctx, listingId);

    const validation = await validateLinkToken(tokenOf(url));
    if (!validation.ok) throw new Error("link invalid");
    expect(await listings.getListingForLink(validation.link)).toBeNull();
  });
});
