import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as imports from "@/server/services/imports";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";

// Review of PR #100 found three ways the import commit decided things BEHIND the
// reviewer: which contact a party resolved to, who owned the property, and which
// client the asset belonged to. Each is a scope decision (contactScope.ts derives
// persona and client-viewer visibility from tenancy parties and property owner),
// so a wrong one is a cross-client read. These pin the fixes.

let W: TestActor;

const row = (over: Partial<imports.ImportRowData> = {}): imports.ImportRowData => ({
  community: "Dubai Marina",
  building: "Tower T",
  unitNo: "1204",
  startDate: "2025-09-16",
  endDate: "2026-09-15",
  annualRent: 72000,
  ...over,
});

async function commit(data: imports.ImportRowData) {
  const batch = await imports.createImportBatch(W.ctx, "EXCEL");
  await imports.addImportRows(W.ctx, batch.id, [{ raw: {}, mapped: data }]);
  return imports.commitImportBatch(W.ctx, batch.id);
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Import Scoping");
});

describe("HIGH-1: the reviewer's create-new choice is honoured", () => {
  it("does NOT merge into a same-name contact when create-new is explicit", async () => {
    const existing = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Mohammed Ali" });

    await commit(row({ tenantName: "Mohammed Ali", tenantContactId: imports.CREATE_NEW_CONTACT }));

    const all = await prisma.contact.findMany({ where: { kind: "TENANT", name: "Mohammed Ali" } });
    expect(all).toHaveLength(2);
    const tenancy = await prisma.tenancy.findFirstOrThrow({});
    expect(tenancy.tenantContactId).not.toBe(existing.id);
  });

  it("still auto-matches on the header-less path (no explicit choice)", async () => {
    const existing = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Mohammed Ali" });

    await commit(row({ tenantName: "Mohammed Ali" }));

    const tenancy = await prisma.tenancy.findFirstOrThrow({});
    expect(tenancy.tenantContactId).toBe(existing.id);
  });

  it("audits an implicit reuse so a merge is never silent", async () => {
    const existing = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Al Noor Properties" });

    await commit(row({ landlordName: "Al Noor Properties" }));

    const audit = await prisma.auditEvent.findFirst({
      where: { objectType: "Contact", objectId: existing.id, verb: "contact.reuse" },
    });
    expect(audit).toBeTruthy();
  });

  it("refuses a contact bound as the wrong kind", async () => {
    const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Not A Tenant" });
    await expect(commit(row({ tenantContactId: owner.id }))).rejects.toMatchObject({ status: 422 });
  });
});

describe("HIGH-2: importing a lease never assigns property ownership", () => {
  it("leaves an existing property's ownerContactId untouched", async () => {
    const client = await clients.createClient(W.ctx, { displayName: "Al Noor Family Office" });
    const property = await properties.createProperty(W.ctx, {
      clientPrincipalId: client.id,
      community: "Dubai Marina",
      building: "Tower T",
      unitNo: "1204",
    });
    expect(property.ownerContactId).toBeNull();

    await commit(row({ landlordName: "Some Landlord" }));

    const after = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
    expect(after.ownerContactId).toBeNull();
  });
});

describe("MEDIUM-3 / F6: clientPrincipalId is validated at commit", () => {
  it("rejects a clientPrincipalId that is not in this workspace", async () => {
    const other = await makeWorkspace("Other Workspace");
    const foreign = await clients.createClient(other.ctx, { displayName: "Foreign Co" });

    await expect(commit(row({ clientPrincipalId: foreign.id }))).rejects.toMatchObject({ status: 404 });

    expect(await prisma.property.count({ where: { clientPrincipalId: foreign.id } })).toBe(0);
  });

  it("accepts a client from this workspace", async () => {
    const client = await clients.createClient(W.ctx, { displayName: "Al Noor Family Office" });
    await commit(row({ clientPrincipalId: client.id }));

    const property = await prisma.property.findFirstOrThrow({ where: { unitNo: "1204" } });
    expect(property.clientPrincipalId).toBe(client.id);
  });
});
