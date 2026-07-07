import { beforeAll, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import { globalSearch } from "@/server/services/search";

// F1 (audit) — a CLIENT_VIEWER is scoped to a single ClientPrincipal, but the
// contact directory reads (listContacts/getContact/getContactDetail) previously
// fell through to a workspace-only check, leaking every other client's
// counterparty PII (names, emails, phones, Emirates IDs), amplified by the ⌘K
// globalSearch. This suite asserts a CLIENT_VIEWER on client A sees only A's
// contacts and gets a 404 (no existence leak) on client B's, and that the
// delegate contact scope is unchanged after the shared-derivation refactor.

let W: TestActor; // FIDUCIARY who sets up the workspace
let CV: TestActor; // CLIENT_VIEWER scoped to A

interface Bundle {
  clientId: string;
  ownerContactId: string;
  tenantContactId: string;
}
let A: Bundle;
let B: Bundle;

async function makeBundle(label: string): Promise<Bundle> {
  const client = await clients.createClient(W.ctx, { displayName: `${label} Co` });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: `${label} Owner` });
  const tenant = await contacts.createContact(W.ctx, {
    kind: "TENANT",
    name: `${label} Tenant`,
    email: `${label.toLowerCase()}-tenant@test.example`,
  });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: owner.id,
    community: `Community ${label}`,
    unitNo: "101",
  });
  await tenancies.createTenancy(W.ctx, {
    propertyId: property.id,
    tenantContactId: tenant.id,
    landlordContactId: owner.id,
    startDate: new Date("2025-09-16"),
    endDate: new Date("2026-09-15"),
    annualRent: 72000,
    ejariNo: `${label}-0001`,
  });
  return { clientId: client.id, ownerContactId: owner.id, tenantContactId: tenant.id };
}

beforeAll(async () => {
  await resetDb();
  W = await makeWorkspace("CV Contact Scope WS");
  A = await makeBundle("Aardvark");
  B = await makeBundle("Beluga");
  CV = await addMember(W.workspaceId, "CLIENT_VIEWER", A.clientId);
});

describe("CLIENT_VIEWER contact scope (F1)", () => {
  it("listContacts returns only the viewer's own client's contacts", async () => {
    const list = await contacts.listContacts(CV.ctx);
    const ids = list.map((c) => c.id);
    expect(ids).toContain(A.ownerContactId);
    expect(ids).toContain(A.tenantContactId);
    expect(ids).not.toContain(B.ownerContactId);
    expect(ids).not.toContain(B.tenantContactId);
  });

  it("getContact on the own client's contact succeeds", async () => {
    const c = await contacts.getContact(CV.ctx, A.ownerContactId);
    expect(c?.id).toBe(A.ownerContactId);
  });

  it("getContact on a sibling client's contact 404s (no existence leak)", async () => {
    await expect(contacts.getContact(CV.ctx, B.ownerContactId)).rejects.toMatchObject({ status: 404 });
  });

  it("getContactDetail on a sibling client's contact 404s", async () => {
    await expect(contacts.getContactDetail(CV.ctx, B.tenantContactId)).rejects.toMatchObject({ status: 404 });
  });

  it("globalSearch (⌘K) surfaces no sibling-client contacts", async () => {
    const hits = await globalSearch(CV.ctx, "Owner");
    const contactHits = hits.filter((h) => h.type === "contact").map((h) => h.id);
    expect(contactHits).toContain(A.ownerContactId);
    expect(contactHits).not.toContain(B.ownerContactId);
  });

  it("an operator (FIDUCIARY) still sees the whole workspace directory", async () => {
    const list = await contacts.listContacts(W.ctx);
    const ids = list.map((c) => c.id);
    expect(ids).toContain(A.ownerContactId);
    expect(ids).toContain(B.ownerContactId);
  });
});

describe("delegate contact scope unchanged after refactor (F1 regression)", () => {
  it("a delegate assigned to A sees A's contacts, not B's", async () => {
    const { makeDelegate } = await import("../helpers");
    const D = await makeDelegate(W.workspaceId, [A.clientId]);
    const list = await contacts.listContacts(D.ctx);
    const ids = list.map((c) => c.id);
    expect(ids).toContain(A.ownerContactId);
    expect(ids).not.toContain(B.ownerContactId);
    await expect(contacts.getContact(D.ctx, B.ownerContactId)).rejects.toMatchObject({ status: 404 });
  });
});
