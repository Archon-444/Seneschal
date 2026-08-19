import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as renewals from "@/server/services/renewals";

// F2 (audit) — the anonymous tenant-link ACCEPT must not resurrect a superseded
// offer. respondToOfferViaLink is pinned to the offer version the link was minted
// for; after counters supersede it, re-using the same link (maxUses 5) to ACCEPT
// must 409, not flip the dead offer to ACCEPTED and force the case to AGREED on a
// stale rent figure. Mirrors acceptOffer's guarded-claim hardening.

let W: TestActor;
let tenancyId: string;

async function openCaseAndSend() {
  const rc = await renewals.openRenewalCase(W.ctx, tenancyId);
  const v1 = await renewals.proposeOffer(W.ctx, {
    renewalCaseId: rc.id,
    party: "LANDLORD",
    annualRent: 99000,
    paymentSchedule: "2 cheques",
  });
  await renewals.sendOfferToTenant(W.ctx, v1.id);
  // The stored SecureLink row (respondToOfferViaLink consumes this, not the raw token).
  const link = await prisma.secureLink.findFirstOrThrow({
    where: { scopeId: v1.id, purpose: "TENANT_OFFER" },
  });
  return { renewalCaseId: rc.id, v1, link };
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Tenant link accept WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Tenant" });
  const p = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: owner.id,
    community: "Marina",
    unitNo: "1",
  });
  tenancyId = (
    await tenancies.createTenancy(W.ctx, {
      propertyId: p.id,
      tenantContactId: tc.id,
      landlordContactId: owner.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      annualRent: 90000,
      ejariNo: "E-1",
    })
  ).id;
});

describe("anonymous tenant-link ACCEPT hardening (F2)", () => {
  it("accepts a live SENT offer via link (happy path, no regression)", async () => {
    const { renewalCaseId, v1, link } = await openCaseAndSend();
    await renewals.respondToOfferViaLink(link, { action: "ACCEPT" });
    const reloaded = await prisma.offer.findUnique({ where: { id: v1.id } });
    expect(reloaded!.status).toBe("ACCEPTED");
    const rc = await prisma.renewalCase.findUnique({ where: { id: renewalCaseId } });
    expect(rc!.status).toBe("AGREED");
    expect(rc!.decidedOfferId).toBe(v1.id);
  });

  it("rejects ACCEPT on a superseded offer via a stale link (409, no state change)", async () => {
    const { renewalCaseId, v1, link } = await openCaseAndSend();

    // Tenant counters via the link: v1 is superseded, v2 (COUNTERED) becomes current.
    await renewals.respondToOfferViaLink(link, {
      action: "COUNTER",
      annualRent: 93000,
      paymentSchedule: "4 cheques",
    });
    const supersededV1 = await prisma.offer.findUnique({ where: { id: v1.id } });
    expect(supersededV1!.status).toBe("SUPERSEDED");
    expect(await renewals.getOfferForLink(link)).toBeNull();

    // Re-use the SAME link (still pinned to v1) to ACCEPT. Must be denied.
    await expect(renewals.respondToOfferViaLink(link, { action: "ACCEPT" })).rejects.toMatchObject({
      status: 409,
    });

    // v1 stays superseded; the case never flipped to AGREED; no acceptance evidence.
    const v1After = await prisma.offer.findUnique({ where: { id: v1.id } });
    expect(v1After!.status).toBe("SUPERSEDED");
    const rc = await prisma.renewalCase.findUnique({ where: { id: renewalCaseId } });
    expect(rc!.status).not.toBe("AGREED");
    expect(rc!.decidedOfferId).toBeNull();
    const accepted = await prisma.evidenceEvent.findFirst({
      where: { type: "OFFER_ACCEPTED", scopeId: v1.id },
    });
    expect(accepted).toBeNull();
    const tenancy = await prisma.tenancy.findUnique({ where: { id: tenancyId } });
    expect(tenancy!.status).not.toBe("RENEWED");
  });

  it("rejects a second ACCEPT on an already-accepted offer (409, single AGREED)", async () => {
    const { renewalCaseId, v1, link } = await openCaseAndSend();
    await renewals.respondToOfferViaLink(link, { action: "ACCEPT" });
    // A stale re-use of the link (still has uses left) cannot double-accept.
    await expect(renewals.respondToOfferViaLink(link, { action: "ACCEPT" })).rejects.toMatchObject({
      status: 409,
    });
    const accepted = await prisma.offer.count({ where: { renewalCaseId, status: "ACCEPTED" } });
    expect(accepted).toBe(1);
  });
});
