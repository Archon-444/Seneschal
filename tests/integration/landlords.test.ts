import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as contacts from "@/server/services/contacts";
import * as landlords from "@/server/services/landlords";

// 1B #2 — Landlord verification. An operator verifies an OWNER contact, which sets
// denormalized state AND writes an append-only LANDLORD_VERIFIED event; revocation
// is a NEW event, never a delete. Only operators with landlords.verify may do it.

let W: TestActor;
let ownerId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Landlords WS");
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Yusuf Haddad" });
  ownerId = owner.id;
});

describe("verifyLandlord", () => {
  it("sets verified state and writes a LANDLORD_VERIFIED(verified:true) event", async () => {
    expect(await landlords.isLandlordVerified(W.workspaceId, ownerId)).toBe(false);

    const updated = await landlords.verifyLandlord(W.ctx, ownerId, "passport + title deed checked");
    expect(updated.verifiedAt).toBeTruthy();
    expect(updated.verifiedById).toBe(W.userId);
    expect(await landlords.isLandlordVerified(W.workspaceId, ownerId)).toBe(true);

    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "LANDLORD_VERIFIED" },
    });
    expect(ev).toBeTruthy();
    expect((ev!.payload as { verified?: boolean; contactId?: string }).verified).toBe(true);
    expect((ev!.payload as { contactId?: string }).contactId).toBe(ownerId);
  });

  it("revocation is a new event and clears the denormalized state", async () => {
    await landlords.verifyLandlord(W.ctx, ownerId);
    const updated = await landlords.revokeLandlordVerification(W.ctx, ownerId);
    expect(updated.verifiedAt).toBeNull();
    expect(await landlords.isLandlordVerified(W.workspaceId, ownerId)).toBe(false);

    const events = await prisma.evidenceEvent.findMany({
      where: { workspaceId: W.workspaceId, type: "LANDLORD_VERIFIED" },
      orderBy: { createdAt: "asc" },
    });
    expect(events.length).toBe(2); // insert-only: grant + revoke
    expect((events[1].payload as { verified?: boolean }).verified).toBe(false);
  });

  it("refuses to verify a non-OWNER contact", async () => {
    const tenant = await contacts.createContact(W.ctx, { kind: "TENANT", name: "A Tenant" });
    await expect(landlords.verifyLandlord(W.ctx, tenant.id)).rejects.toThrow(/OWNER/);
  });

  it("a non-operator role cannot verify", async () => {
    const agent = await addMember(W.workspaceId, "AGENT");
    await expect(landlords.verifyLandlord(agent.ctx, ownerId)).rejects.toThrow(/landlords\.verify/);
  });
});
