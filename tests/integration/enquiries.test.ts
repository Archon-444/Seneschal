import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as listings from "@/server/services/listings";
import * as enquiries from "@/server/services/enquiries";

// 1C #8 — Enquiries captured from the public listing link notify the workspace and
// write ENQUIRY_RECEIVED; only operators can list/triage them; a draft listing
// never accepts enquiries.

let W: TestActor;
let landlord: TestActor;
let publishedId: string;
let draftId: string;

async function linkFor(id: string): Promise<Awaited<ReturnType<typeof prisma.secureLink.findUniqueOrThrow>>> {
  const { url } = await listings.createListingShareLink(landlord.ctx, id);
  const token = url.slice(url.lastIndexOf("/") + 1);
  // helper mirrors validateLinkToken but returns the row for the service call
  const { validateLinkToken } = await import("@/server/services/secureLinks");
  const v = await validateLinkToken(token);
  if (!v.ok) throw new Error("link invalid");
  return v.link;
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Enquiries WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: owner.id,
    community: "Dubai Marina",
    unitNo: "101",
    bedrooms: 2,
    sizeSqft: 1180,
  });
  landlord = await addMember(W.workspaceId, "LANDLORD", undefined, owner.id);

  const published = await listings.createListing(landlord.ctx, property.id, {
    askingRent: 95000,
    permitRef: "RERA-1",
    availableFrom: new Date("2026-08-01"),
    furnished: true,
    description: "Bright corner two-bed with full Marina view and covered parking included.",
  });
  await listings.publishListing(landlord.ctx, published.id);
  publishedId = published.id;

  const draft = await listings.createListing(landlord.ctx, property.id, { askingRent: 80000 });
  draftId = draft.id;
});

describe("enquiries", () => {
  it("creates an enquiry from a listing link, writes evidence, and notifies overseers", async () => {
    const link = await linkFor(publishedId);
    const enquiry = await enquiries.createEnquiryFromLink(link, {
      name: "Aisha",
      email: "aisha@example.com",
      message: "Is it still available?",
    });
    expect(enquiry.listingId).toBe(publishedId);
    expect(enquiry.status).toBe("NEW");

    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "ENQUIRY_RECEIVED" },
    });
    expect(ev).toBeTruthy();

    // The workspace overseer received an in-app notification.
    const notif = await prisma.notificationMessage.findFirst({
      where: { workspaceId: W.workspaceId, templateCode: "enquiry_v1" },
    });
    expect(notif).toBeTruthy();
  });

  it("a draft listing cannot even be shared, and an unpublished listing rejects enquiries", async () => {
    await expect(listings.createListingShareLink(landlord.ctx, draftId)).rejects.toThrow(/published/i);
    // A link minted while published must stop accepting enquiries once archived.
    const link = await linkFor(publishedId);
    await listings.archiveListing(landlord.ctx, publishedId);
    await expect(enquiries.createEnquiryFromLink(link, { name: "Too late" })).rejects.toThrow(/no longer/i);
  });

  it("operators list and triage; personas have no enquiry surface", async () => {
    const link = await linkFor(publishedId);
    await enquiries.createEnquiryFromLink(link, { name: "Bilal" });

    const rows = await enquiries.listEnquiries(W.ctx);
    expect(rows.length).toBe(1);
    const updated = await enquiries.setEnquiryStatus(W.ctx, rows[0].id, "CONTACTED");
    expect(updated.status).toBe("CONTACTED");

    await expect(enquiries.listEnquiries(landlord.ctx)).rejects.toThrow(/enquiries\.read/);
  });
});
