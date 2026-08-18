import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as contacts from "@/server/services/contacts";
import * as passport from "@/server/services/tenantPassport";

// 1C #5 — Tenant passport is quarantined. TENANT no longer holds passport.*
// (pilot role shrink). Operator oversight still reads by id.

let W: TestActor;
let tenant: TestActor;
let tenantContactId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Passport WS");
  const tenantContact = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Own Tenant" });
  tenantContactId = tenantContact.id;
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tenantContact.id);
});

describe("tenant passport", () => {
  it("TENANT has no passport surface", async () => {
    await expect(passport.getOrCreateMyPassport(tenant.ctx)).rejects.toThrow(/passport\.read/);
    await expect(passport.updateMyPassport(tenant.ctx, { employer: "Emirates" })).rejects.toThrow(/passport\.write/);
  });

  it("a LANDLORD persona has no passport surface", async () => {
    const ownerContact = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
    const landlord = await addMember(W.workspaceId, "LANDLORD", undefined, ownerContact.id);
    await expect(passport.getOrCreateMyPassport(landlord.ctx)).rejects.toThrow(/passport\.read/);
  });

  it("an operator can read a tenant's passport by id (oversight)", async () => {
    const p = await prisma.tenantPassport.create({
      data: { workspaceId: W.workspaceId, contactId: tenantContactId },
    });
    await expect(passport.getPassport(W.ctx, p.id)).resolves.toBeTruthy();
  });
});
