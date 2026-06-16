import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as contacts from "@/server/services/contacts";
import * as passport from "@/server/services/tenantPassport";

// 1C #5 — Tenant passport: one per tenant Contact, owned and edited only by that
// TENANT persona; a sibling tenant's passport is never reachable.

let W: TestActor;
let tenant: TestActor;
let sibling: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Passport WS");
  const tenantContact = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Own Tenant" });
  const siblingContact = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Sibling Tenant" });
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tenantContact.id);
  sibling = await addMember(W.workspaceId, "TENANT", undefined, siblingContact.id);
});

describe("tenant passport", () => {
  it("creates the passport on first access and updates own fields", async () => {
    const created = await passport.getOrCreateMyPassport(tenant.ctx);
    expect(created.status).toBe("DRAFT");

    const updated = await passport.updateMyPassport(tenant.ctx, {
      employer: "Emirates Airlines",
      monthlyIncome: 32000,
      status: "READY",
    });
    expect(updated.id).toBe(created.id); // idempotent — one passport per contact
    expect(Number(updated.monthlyIncome)).toBe(32000);
    expect(updated.status).toBe("READY");
  });

  it("a tenant cannot read a sibling tenant's passport by id", async () => {
    const mine = await passport.getOrCreateMyPassport(tenant.ctx);
    const theirs = await passport.getOrCreateMyPassport(sibling.ctx);
    expect(mine.id).not.toBe(theirs.id);

    await expect(passport.getPassport(tenant.ctx, mine.id)).resolves.toBeTruthy();
    await expect(passport.getPassport(tenant.ctx, theirs.id)).rejects.toThrow();
  });

  it("a LANDLORD persona has no passport surface", async () => {
    const ownerContact = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
    const landlord = await addMember(W.workspaceId, "LANDLORD", undefined, ownerContact.id);
    await expect(passport.getOrCreateMyPassport(landlord.ctx)).rejects.toThrow(/passport\.read/);
  });

  it("an operator can read a tenant's passport by id (oversight)", async () => {
    const p = await passport.getOrCreateMyPassport(tenant.ctx);
    await expect(passport.getPassport(W.ctx, p.id)).resolves.toBeTruthy();
  });
});
