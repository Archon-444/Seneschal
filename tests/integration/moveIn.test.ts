import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as moveIn from "@/server/services/moveIn";
import * as documents from "@/server/services/documents";

// 2A #14 — Move-in: dual acknowledgement (landlord + tenant) completes the handover;
// the photo vault is PROPERTY-scoped so both sides read it; a sibling tenant cannot.

let W: TestActor;
let landlord: TestActor;
let tenant: TestActor;
let sibling: TestActor;
let moveInId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("MoveIn WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Tenant" });
  const sc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Sibling" });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id, ownerContactId: owner.id, community: "Marina", unitNo: "1",
  });
  const tenancy = await tenancies.createTenancy(W.ctx, {
    propertyId: property.id, tenantContactId: tc.id, landlordContactId: owner.id,
    startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 90000, ejariNo: "E-1",
  });
  landlord = await addMember(W.workspaceId, "LANDLORD", undefined, owner.id);
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
  sibling = await addMember(W.workspaceId, "TENANT", undefined, sc.id);
  moveInId = (await moveIn.createMoveIn(W.ctx, tenancy.id, "Two scratches on the kitchen counter")).id;
});

describe("move-in", () => {
  it("completes only after BOTH sides acknowledge, with dual evidence", async () => {
    const afterTenant = await moveIn.acknowledgeMoveIn(tenant.ctx, moveInId);
    expect(afterTenant.status).toBe("PARTIALLY_ACKNOWLEDGED");
    expect(afterTenant.tenantAckAt).toBeTruthy();
    expect(afterTenant.landlordAckAt).toBeNull();

    const afterLandlord = await moveIn.acknowledgeMoveIn(landlord.ctx, moveInId);
    expect(afterLandlord.status).toBe("COMPLETED");

    expect(
      await prisma.evidenceEvent.count({ where: { workspaceId: W.workspaceId, type: "MOVEIN_ACKNOWLEDGED" } }),
    ).toBe(2); // dual
    expect(
      await prisma.evidenceEvent.count({ where: { workspaceId: W.workspaceId, type: "MOVEIN_COMPLETED" } }),
    ).toBe(1);
  });

  it("the same party cannot acknowledge twice", async () => {
    await moveIn.acknowledgeMoveIn(tenant.ctx, moveInId);
    await expect(moveIn.acknowledgeMoveIn(tenant.ctx, moveInId)).rejects.toThrow(/already acknowledged/i);
  });

  it("photo vault: TENANCY-scoped, readable by both sides, denied to a sibling tenant", async () => {
    const photo = await moveIn.addMoveInPhoto(W.ctx, moveInId, {
      fileName: "kitchen.jpg", mime: "image/jpeg", data: Buffer.from("img"),
    });
    const evidence = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "DOCUMENT_UPLOADED", scopeType: "TENANCY" },
    });
    expect((evidence!.payload as { moveInId: string }).moveInId).toBe(moveInId);

    await expect(documents.getDocument(tenant.ctx, photo.id)).resolves.toBeTruthy();
    await expect(documents.getDocument(landlord.ctx, photo.id)).resolves.toBeTruthy();
    await expect(documents.getDocument(sibling.ctx, photo.id)).rejects.toThrow();

    const listed = await moveIn.listMoveInPhotos(tenant.ctx, moveInId);
    expect(listed.map((d) => d.id)).toContain(photo.id);
  });

  it("a sibling tenant cannot see or acknowledge the move-in", async () => {
    await expect(moveIn.getMoveIn(sibling.ctx, moveInId)).rejects.toThrow();
    await expect(moveIn.acknowledgeMoveIn(sibling.ctx, moveInId)).rejects.toThrow();
    const mine = await moveIn.listMyMoveIns(sibling.ctx);
    expect(mine).toHaveLength(0);
  });
});
