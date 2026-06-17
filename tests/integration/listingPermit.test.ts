import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as listings from "@/server/services/listings";
import { listDeadlines } from "@/server/services/deadlines";
import { runAlertLadders } from "@/server/services/alerts";
import { todayInDubai } from "@/server/calculators/dates";

// 1B #3 — A listing's RERA permit expiry becomes a tracked PERMIT_EXPIRY deadline
// (property-scoped, no tenancy), visible to the landlord and fed into the alert
// ladder. Clearing the date or archiving the listing cancels it.

let W: TestActor;
let landlord: TestActor;
let propertyId: string;

function daysFromToday(days: number): Date {
  return new Date(todayInDubai().getTime() + days * 86_400_000);
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Permit WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const ownerContact = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: ownerContact.id,
    community: "Palm Jumeirah",
    building: "Palm Vista",
    unitNo: "12",
    bedrooms: 3,
    sizeSqft: 3200,
  });
  propertyId = property.id;
  landlord = await addMember(W.workspaceId, "LANDLORD", undefined, ownerContact.id);
});

async function openPermitDeadlines(listingId: string) {
  return prisma.deadline.findMany({
    where: {
      workspaceId: W.workspaceId,
      kind: "PERMIT_EXPIRY",
      status: "OPEN",
      computedFrom: { path: ["discriminator"], equals: listingId },
    },
  });
}

describe("permit-expiry deadline sync", () => {
  it("creates a property-scoped PERMIT_EXPIRY deadline the landlord can see", async () => {
    const listing = await listings.createListing(landlord.ctx, propertyId, {
      permitRef: "RERA-7781234",
      permitExpiry: daysFromToday(45),
    });
    const open = await openPermitDeadlines(listing.id);
    expect(open).toHaveLength(1);
    expect(open[0].propertyId).toBe(propertyId);
    expect(open[0].tenancyId).toBeNull();

    const seen = await listDeadlines(landlord.ctx, { kind: "PERMIT_EXPIRY" });
    expect(seen.map((d) => d.id)).toContain(open[0].id);
  });

  it("cancels the deadline when the expiry is cleared", async () => {
    const listing = await listings.createListing(landlord.ctx, propertyId, {
      permitRef: "RERA-1",
      permitExpiry: daysFromToday(45),
    });
    await listings.updateListing(landlord.ctx, listing.id, { permitExpiry: null });
    expect(await openPermitDeadlines(listing.id)).toHaveLength(0);
  });

  it("cancels the deadline when the listing is archived", async () => {
    const listing = await listings.createListing(landlord.ctx, propertyId, {
      permitRef: "RERA-1",
      permitExpiry: daysFromToday(45),
    });
    await listings.archiveListing(landlord.ctx, listing.id);
    expect(await openPermitDeadlines(listing.id)).toHaveLength(0);
  });

  it("does not create a deadline when there is no expiry date", async () => {
    const listing = await listings.createListing(landlord.ctx, propertyId, { permitRef: "RERA-1" });
    expect(await openPermitDeadlines(listing.id)).toHaveLength(0);
  });
});

describe("permit-expiry alert ladder", () => {
  it("fires the T-30 rung once with property-scoped REMINDER_SENT evidence", async () => {
    await listings.createListing(landlord.ctx, propertyId, {
      permitRef: "RERA-7781234",
      permitExpiry: daysFromToday(30), // exactly T-30
    });

    const sent = await runAlertLadders(W.workspaceId);
    expect(sent).toBe(1);

    const ev = await prisma.evidenceEvent.findMany({
      where: { workspaceId: W.workspaceId, type: "REMINDER_SENT" },
    });
    expect(ev).toHaveLength(1);
    expect(ev[0].scopeType).toBe("PROPERTY");
    expect(ev[0].scopeId).toBe(propertyId);
    expect((ev[0].payload as { rung: string; template: string }).rung).toBe("T-30");
    expect((ev[0].payload as { template: string }).template).toBe("listing_permit_v1");

    // Idempotent across daily reruns.
    expect(await runAlertLadders(W.workspaceId)).toBe(0);
  });
});
