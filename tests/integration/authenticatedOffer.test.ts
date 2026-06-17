import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as renewals from "@/server/services/renewals";

// 2B #17 — authenticated counter-offer. A TENANT persona responds to a renewal offer
// on their own tenancy in-app (the login counterpart to respondToOfferViaLink), gated
// by getTenancy's contact scope. A sibling tenant cannot respond.

let W: TestActor;
let tenant: TestActor;
let sibling: TestActor;
let ownTenancyId: string;
let siblingTenancyId: string;

async function landlordOfferOn(tenancyId: string) {
  const rc = await renewals.openRenewalCase(W.ctx, tenancyId);
  return renewals.proposeOffer(W.ctx, {
    renewalCaseId: rc.id, party: "LANDLORD", annualRent: 99000, paymentSchedule: "2 cheques",
  });
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Auth offer WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Own Tenant" });
  const sc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Sibling Tenant" });
  const p1 = await properties.createProperty(W.ctx, { clientPrincipalId: client.id, ownerContactId: owner.id, community: "Marina", unitNo: "1" });
  const p2 = await properties.createProperty(W.ctx, { clientPrincipalId: client.id, ownerContactId: owner.id, community: "JLT", unitNo: "2" });
  ownTenancyId = (await tenancies.createTenancy(W.ctx, { propertyId: p1.id, tenantContactId: tc.id, landlordContactId: owner.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 90000, ejariNo: "E-1" })).id;
  siblingTenancyId = (await tenancies.createTenancy(W.ctx, { propertyId: p2.id, tenantContactId: sc.id, landlordContactId: owner.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 80000, ejariNo: "E-2" })).id;
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
  sibling = await addMember(W.workspaceId, "TENANT", undefined, sc.id);
});

describe("authenticated tenant offer response", () => {
  it("lists only own-tenancy offers; a sibling tenancy is denied", async () => {
    const offer = await landlordOfferOn(ownTenancyId);
    const mine = await renewals.listOffersForTenant(tenant.ctx, ownTenancyId);
    expect(mine.map((o) => o.id)).toContain(offer.id);
    await expect(renewals.listOffersForTenant(tenant.ctx, siblingTenancyId)).rejects.toThrow();
  });

  it("counters in-app: creates a TENANT offer (party USER actor, not via link)", async () => {
    const offer = await landlordOfferOn(ownTenancyId);
    await renewals.respondToOfferAsTenant(tenant.ctx, offer.id, {
      action: "COUNTER", annualRent: 93000, paymentSchedule: "4 cheques",
    });
    const offers = await renewals.listOffersForTenant(tenant.ctx, ownTenancyId);
    const counter = offers.find((o) => o.party === "TENANT" && o.status === "COUNTERED");
    expect(counter).toBeTruthy();
    expect(counter!.viaSecureLinkId).toBeNull(); // authenticated, not via link
    const ev = await prisma.evidenceEvent.findFirst({ where: { type: "OFFER_COUNTERED", scopeId: counter!.id } });
    expect(ev!.actorType).toBe("USER");
    expect(ev!.actorId).toBe(tenant.userId);
  });

  it("accepts in-app and moves the case toward AGREED", async () => {
    const offer = await landlordOfferOn(ownTenancyId);
    await renewals.respondToOfferAsTenant(tenant.ctx, offer.id, { action: "ACCEPT" });
    const reloaded = await prisma.offer.findUnique({ where: { id: offer.id } });
    expect(reloaded!.status).toBe("ACCEPTED");
  });

  it("a sibling tenant cannot respond to another tenant's offer", async () => {
    const offer = await landlordOfferOn(ownTenancyId);
    await expect(
      renewals.respondToOfferAsTenant(sibling.ctx, offer.id, { action: "ACCEPT" }),
    ).rejects.toThrow();
  });

  it("a landlord persona cannot use the tenant response path (no offers.respond)", async () => {
    const offer = await landlordOfferOn(ownTenancyId);
    const ownerC = await contacts.createContact(W.ctx, { kind: "OWNER", name: "L2" });
    const landlord = await addMember(W.workspaceId, "LANDLORD", undefined, ownerC.id);
    await expect(
      renewals.respondToOfferAsTenant(landlord.ctx, offer.id, { action: "ACCEPT" }),
    ).rejects.toThrow(/offers\.respond/);
  });
});
