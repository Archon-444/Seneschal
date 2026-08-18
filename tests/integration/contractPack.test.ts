import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as listings from "@/server/services/listings";
import * as offers from "@/server/services/offers";
import * as contractPack from "@/server/services/contractPack";
import * as documents from "@/server/services/documents";

let tenant: TestActor;

// 2A #12 — Contract pack: a PDF of the agreed terms from an ACCEPTED offer, stored
// PROPERTY-scoped so owner + operator can read it, with CONTRACT_PACK_GENERATED.
// LANDLORD no longer holds contracts.* (pilot role shrink); the operator exercises the pack.

let W: TestActor;
let listingId: string;
let offerId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Contract WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Yusuf Haddad" });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id, ownerContactId: owner.id, community: "Marina", unitNo: "1", bedrooms: 2, sizeSqft: 1100,
  });
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "A Tenant" });
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
  listingId = (await listings.createListing(W.ctx, property.id, { askingRent: 100000 })).id;
  const offer = await offers.proposeNewTenancyOffer(W.ctx, listingId, {
    party: "LANDLORD", annualRent: 105000, paymentSchedule: "2 cheques",
  });
  offerId = offer.id;
});

describe("contract pack", () => {
  it("refuses to pack an offer that is not accepted", async () => {
    await expect(contractPack.generateContractPack(W.ctx, offerId)).rejects.toThrow(/accepted/i);
  });

  it("generates a readable PDF document with CONTRACT_PACK_GENERATED evidence", async () => {
    await offers.acceptNewTenancyOffer(W.ctx, offerId);
    const pack = await contractPack.generateContractPack(W.ctx, offerId);
    expect(pack.status).toBe("GENERATED");

    const doc = await prisma.document.findUnique({ where: { id: pack.documentId } });
    expect(doc!.mime).toBe("application/pdf");
    expect(doc!.sizeBytes).toBeGreaterThan(0);

    const { url } = await contractPack.getContractPackUrl(W.ctx, pack.id);
    expect(url).toContain(pack.documentId);
    // Operators read OFFER-scoped docs by workspace match; tenants lack contracts.read.
    await expect(documents.getDocument(W.ctx, pack.documentId)).resolves.toBeTruthy();
    await expect(contractPack.getContractPackUrl(tenant.ctx, pack.id)).rejects.toThrow(/contracts\.read/);

    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "CONTRACT_PACK_GENERATED", scopeId: offerId },
    });
    expect(ev).toBeTruthy();

    const listed = await contractPack.listContractPacks(W.ctx, listingId);
    expect(listed.map((p) => p.id)).toContain(pack.id);
  });

  it("tracks the e-sign reference and signature lifecycle (2A #13)", async () => {
    await offers.acceptNewTenancyOffer(W.ctx, offerId);
    const pack = await contractPack.generateContractPack(W.ctx, offerId);

    const sent = await contractPack.markContractPackSent(W.ctx, pack.id, "DOCUSIGN-ABC123");
    expect(sent.status).toBe("SENT_FOR_SIGNATURE");
    expect(sent.eSignRef).toBe("DOCUSIGN-ABC123");
    expect(sent.sentAt).toBeTruthy();
    expect(
      await prisma.evidenceEvent.count({ where: { workspaceId: W.workspaceId, type: "CONTRACT_PACK_SENT" } }),
    ).toBe(1);

    const signed = await contractPack.markContractPackSigned(W.ctx, pack.id);
    expect(signed.status).toBe("SIGNED");
    expect(signed.eSignRef).toBe("DOCUSIGN-ABC123"); // preserved when not re-supplied
    expect(signed.signedAt).toBeTruthy();
    expect(
      await prisma.evidenceEvent.count({ where: { workspaceId: W.workspaceId, type: "CONTRACT_PACK_SIGNED" } }),
    ).toBe(1);

    // A signed pack cannot be re-sent.
    await expect(contractPack.markContractPackSent(W.ctx, pack.id)).rejects.toThrow(/already signed/i);
  });
});
