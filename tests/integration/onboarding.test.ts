import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { onboardTenancy } from "@/server/services/onboarding";
import * as contacts from "@/server/services/contacts";
import * as clients from "@/server/services/clients";

// Combined Ejari onboarding: one call creates landlord + tenant + asset +
// tenancy (+ cheque schedule), reusing existing records where given.

let W: TestActor;
let clientId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Onboarding WS");
  clientId = (await clients.createClient(W.ctx, { displayName: "Al Noor" })).id;
});

const contract = {
  ejariNo: "2025/JVT-8K14",
  startDate: new Date("2025-04-20"),
  endDate: new Date("2026-04-19"),
  annualRent: 200000,
  depositAmount: 10000,
  noticePeriodDays: 90,
  paymentTermsNote: "Six (6) cheques in advance",
  chequeCount: 6,
};

describe("onboardTenancy", () => {
  it("creates landlord + tenant + asset + tenancy + even cheque split in one pass", async () => {
    const result = await onboardTenancy(W.ctx, {
      newLandlord: { name: "Bassam Rizk", emiratesId: "784-1985-7053614-8", email: "b@example.com" },
      newTenant: { name: "Raymond Schmitt", emiratesId: "784-1982-2983642-8" },
      newProperty: {
        clientPrincipalId: clientId,
        community: "Al Barsha South Fifth",
        building: "JV-T08K2VS014",
        unitNo: "8K14",
        usage: "Residential",
        propertyType: "2 Bed Villa + Maid",
        dewaPremiseNo: "684-00541-7",
        sizeSqm: 657.54,
      },
      ...contract,
    });

    // landlord (OWNER) + tenant (TENANT) created with Ejari identity
    const landlord = await prisma.contact.findUnique({ where: { id: result.landlordContactId! } });
    expect(landlord!.kind).toBe("OWNER");
    expect(landlord!.emiratesId).toBe("784-1985-7053614-8");
    const tenant = await prisma.contact.findUnique({ where: { id: result.tenantContactId! } });
    expect(tenant!.kind).toBe("TENANT");

    // asset carries the Ejari identifiers
    const property = await prisma.property.findUnique({ where: { id: result.propertyId } });
    expect(property!.usage).toBe("Residential");
    expect(property!.dewaPremiseNo).toBe("684-00541-7");
    expect(Number(property!.sizeSqm)).toBeCloseTo(657.54);
    expect(property!.clientPrincipalId).toBe(clientId);

    // tenancy links both parties + the property
    const tenancy = await prisma.tenancy.findUnique({
      where: { id: result.tenancyId },
      include: { paymentItems: { orderBy: { seq: "asc" } }, deadlines: { where: { status: "OPEN" } } },
    });
    expect(tenancy!.landlordContactId).toBe(result.landlordContactId);
    expect(tenancy!.tenantContactId).toBe(result.tenantContactId);
    expect(tenancy!.ejariNo).toBe("2025/JVT-8K14");

    // 6 cheques, evenly summing to annual rent (no mismatch flag)
    expect(tenancy!.paymentItems).toHaveLength(6);
    const total = tenancy!.paymentItems.reduce((s, i) => s + Number(i.amount), 0);
    expect(total).toBe(200000);
    const mismatch = await prisma.riskFlag.findFirst({
      where: { code: "CHEQUE_TOTAL_MISMATCH", scopeId: result.tenancyId, status: "OPEN" },
    });
    expect(mismatch).toBeNull();

    // deadlines generated (notice gate, expiry, renewal, + cheques)
    expect(tenancy!.deadlines.length).toBeGreaterThanOrEqual(4);

    // onboarding is audited
    const audit = await prisma.auditEvent.findFirst({
      where: { verb: "tenancy.onboard", objectId: result.tenancyId },
    });
    expect(audit).toBeTruthy();
  });

  it("reuses an existing landlord contact instead of creating a duplicate", async () => {
    const existing = await contacts.createContact(W.ctx, {
      kind: "OWNER",
      name: "Existing Owner",
      emiratesId: "784-0000-0000000-0",
    });
    const result = await onboardTenancy(W.ctx, {
      landlordContactId: existing.id,
      newTenant: { name: "New Tenant" },
      newProperty: { clientPrincipalId: clientId, community: "JVC", unitNo: "1" },
      ...contract,
      chequeCount: 0,
    });
    expect(result.landlordContactId).toBe(existing.id);
    expect(await prisma.contact.count({ where: { workspaceId: W.workspaceId, kind: "OWNER" } })).toBe(1);
  });

  it("requires an existing property or new property details", async () => {
    await expect(
      onboardTenancy(W.ctx, { newTenant: { name: "T" }, ...contract }),
    ).rejects.toThrow();
  });
});
