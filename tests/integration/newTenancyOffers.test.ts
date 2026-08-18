import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as listings from "@/server/services/listings";
import * as offers from "@/server/services/offers";

// 2A #11 — New-tenancy offers reuse the generalized Offer spine (listingId, no
// tenancy). Operators negotiate on any listing in the workspace. LANDLORD no
// longer holds listings.read, so listing-scoped offers are operator-only.
// Versioning supersedes the open figure.

let W: TestActor;
let landlord: TestActor;
let ownListingId: string;
let siblingListingId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Offers WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const own = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Own Landlord" });
  const sib = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Sibling Landlord" });
  const ownProp = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id, ownerContactId: own.id, community: "Marina", unitNo: "1", bedrooms: 2, sizeSqft: 1100,
  });
  const sibProp = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id, ownerContactId: sib.id, community: "JLT", unitNo: "2",
  });
  landlord = await addMember(W.workspaceId, "LANDLORD", undefined, own.id);
  ownListingId = (await listings.createListing(W.ctx, ownProp.id, { askingRent: 100000 })).id;
  siblingListingId = (await listings.createListing(W.ctx, sibProp.id, { askingRent: 90000 })).id;
});

describe("new-tenancy offers", () => {
  it("proposes a versioned offer with OFFER_PROPOSED evidence", async () => {
    const o = await offers.proposeNewTenancyOffer(W.ctx, ownListingId, {
      party: "LANDLORD",
      annualRent: 105000,
      paymentSchedule: "2 cheques",
    });
    expect(o.version).toBe(1);
    expect(o.listingId).toBe(ownListingId);
    expect(o.tenancyId).toBeNull();
    expect(o.renewalCaseId).toBeNull();

    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "OFFER_PROPOSED", scopeId: o.id },
    });
    expect(ev).toBeTruthy();
  });

  it("supersedes the open figure on each new proposal", async () => {
    const a = await offers.proposeNewTenancyOffer(W.ctx, ownListingId, { party: "LANDLORD", annualRent: 105000, paymentSchedule: "2 cheques" });
    const b = await offers.proposeNewTenancyOffer(W.ctx, ownListingId, { party: "TENANT", annualRent: 98000, paymentSchedule: "1 cheque" });
    expect(b.version).toBe(2);
    const reloadedA = await prisma.offer.findUnique({ where: { id: a.id } });
    expect(reloadedA!.status).toBe("SUPERSEDED");
  });

  it("accepts an offer; others are superseded", async () => {
    const a = await offers.proposeNewTenancyOffer(W.ctx, ownListingId, { party: "LANDLORD", annualRent: 105000, paymentSchedule: "2 cheques" });
    const accepted = await offers.acceptNewTenancyOffer(W.ctx, a.id);
    expect(accepted.status).toBe("ACCEPTED");
    const ev = await prisma.evidenceEvent.findFirst({ where: { type: "OFFER_ACCEPTED", scopeId: a.id } });
    expect(ev).toBeTruthy();
  });

  it("LANDLORD cannot reach listing-scoped offers without listings.read", async () => {
    await expect(
      offers.proposeNewTenancyOffer(landlord.ctx, siblingListingId, { party: "LANDLORD", annualRent: 1, paymentSchedule: "x" }),
    ).rejects.toThrow(/listings\.read/);
    await expect(offers.listListingOffers(landlord.ctx, siblingListingId)).rejects.toThrow(/listings\.read/);
    await expect(offers.listListingOffers(landlord.ctx, ownListingId)).rejects.toThrow(/listings\.read/);
  });

  it("a tenant persona cannot make offers", async () => {
    const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "T" });
    const tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
    await expect(
      offers.proposeNewTenancyOffer(tenant.ctx, ownListingId, { party: "TENANT", annualRent: 90000, paymentSchedule: "1" }),
    ).rejects.toThrow(/offers\.write/);
  });
});
