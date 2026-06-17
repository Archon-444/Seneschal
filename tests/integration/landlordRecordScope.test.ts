import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as payments from "@/server/services/payments";
import { resolveContactScopeIds } from "@/server/services/contactScope";

// Codex P1 regression: a LANDLORD who is landlord-of-record on ONE tenancy but does
// NOT own the property must see ONLY that tenancy — never the other (e.g. a new
// owner's) leases on the same unit. Ownership grants all leases; landlord-of-record
// grants only its own.

let W: TestActor;
let oldLandlord: TestActor;
let propertyId: string;
let ownTenancyId: string;
let newTenancyId: string;
let oldLandlordContactId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Landlord-of-record WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const newOwner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "New Owner" });
  const oldLl = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Old Landlord" });
  oldLandlordContactId = oldLl.id;

  // The unit is OWNED by newOwner. oldLandlord is only landlord-of-record on T1.
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id, ownerContactId: newOwner.id, community: "Marina", unitNo: "1",
  });
  propertyId = property.id;
  ownTenancyId = (await tenancies.createTenancy(W.ctx, {
    propertyId: property.id, landlordContactId: oldLl.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 90000, ejariNo: "OLD-1",
  })).id;
  newTenancyId = (await tenancies.createTenancy(W.ctx, {
    propertyId: property.id, landlordContactId: newOwner.id, startDate: new Date("2026-02-01"), endDate: new Date("2027-01-31"), annualRent: 120000, ejariNo: "NEW-1",
  })).id;
  await payments.setPaymentSchedule(W.ctx, newTenancyId, [{ seq: 1, dueDate: new Date("2026-02-15"), amount: 60000 }]);

  oldLandlord = await addMember(W.workspaceId, "LANDLORD", undefined, oldLl.id);
});

describe("landlord-of-record scope is not the whole property", () => {
  it("resolves only the landlord-of-record's own tenancy, not the new owner's", async () => {
    const ids = await resolveContactScopeIds(W.workspaceId, oldLandlordContactId, "LANDLORD");
    expect(ids.tenancyIds).toContain(ownTenancyId);
    expect(ids.tenancyIds).not.toContain(newTenancyId);
  });

  it("getTenancy: own resolves, the new owner's tenancy is denied", async () => {
    await expect(tenancies.getTenancy(oldLandlord.ctx, ownTenancyId)).resolves.toBeTruthy();
    await expect(tenancies.getTenancy(oldLandlord.ctx, newTenancyId)).rejects.toThrow();
  });

  it("listPayments excludes the new owner's tenancy", async () => {
    const items = await payments.listPayments(oldLandlord.ctx);
    expect(items.every((i) => i.tenancyId !== newTenancyId)).toBe(true);
  });
});
