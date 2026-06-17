import { beforeAll, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { scope, assertSameWorkspace, authz } from "@/server/authz";
import { assertReadable } from "@/server/services/contactScope";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as payments from "@/server/services/payments";
import * as deadlines from "@/server/services/deadlines";
import * as documents from "@/server/services/documents";
import * as proofs from "@/server/services/proofs";

// F0a ⛔ Persona scoping suite — release blocking (the adversarial enumeration).
//
// Two NEW personas (TENANT, LANDLORD) are each scoped to ONE Contact. The
// security model widens from "is this row in my workspace?" to "is this row in
// my Contact's id-set?". Unlike cross-WORKSPACE scoping, the sibling here lives
// in the SAME workspace, so workspace filtering passes — the contact boundary is
// the only thing standing between one tenant and another tenant's cheque
// schedule. This suite asserts, for every operator read path a persona's
// capability set can reach, that a sibling's data is DENIED while own data is
// served, plus the structural fail-closed invariants.

let W: TestActor; // operator (FIDUCIARY) who sets up the workspace
let tenant: TestActor; // scoped to Tcontact
let landlord: TestActor; // scoped to Lcontact

let own: {
  tenancyId: string;
  propertyId: string;
  vacantPropertyId: string;
  paymentItemId: string;
  documentId: string;
  proofRequestId: string;
};
let sibling: {
  tenancyId: string;
  propertyId: string;
  documentId: string;
  proofRequestId: string;
};

beforeAll(async () => {
  await resetDb();
  W = await makeWorkspace("Persona WS");

  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const tenantContact = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Own Tenant" });
  const landlordContact = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Own Landlord" });
  const siblingTenantContact = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Sibling Tenant" });
  const siblingLandlordContact = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Sibling Landlord" });
  const assignee = await contacts.createContact(W.ctx, {
    kind: "AGENT",
    name: "Proof Assignee",
    email: "assignee@test.example",
  });

  // ── Own records (reachable from tenantContact / landlordContact) ────────────
  const ownProperty = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: landlordContact.id,
    community: "Dubai Marina",
    building: "Tower A",
    unitNo: "101",
  });
  // A vacant unit the landlord owns but has no tenancy — must still be visible.
  const vacantProperty = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: landlordContact.id,
    community: "Dubai Marina",
    building: "Tower A",
    unitNo: "VACANT",
  });
  const ownTenancy = await tenancies.createTenancy(W.ctx, {
    propertyId: ownProperty.id,
    tenantContactId: tenantContact.id,
    landlordContactId: landlordContact.id,
    startDate: new Date("2025-09-16"),
    endDate: new Date("2026-09-15"),
    annualRent: 72000,
    ejariNo: "OWN-0001",
  });
  const ownSchedule = await payments.setPaymentSchedule(W.ctx, ownTenancy.id, [
    { seq: 1, dueDate: new Date("2025-09-16"), amount: 72000 },
  ]);
  const ownDoc = await documents.uploadDocument(W.ctx, {
    scopeType: "TENANCY",
    scopeId: ownTenancy.id,
    kind: "TENANCY_CONTRACT",
    fileName: "own-contract.txt",
    mime: "text/plain",
    data: Buffer.from("own contract"),
  });
  const ownProof = await proofs.createProofRequest(W.ctx, {
    scopeType: "TENANCY",
    scopeId: ownTenancy.id,
    title: "Own proof",
    requiredEvidence: "anything",
    assignedContactId: assignee.id,
  });

  // ── Sibling records (same workspace, different Contact) ─────────────────────
  const siblingProperty = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: siblingLandlordContact.id,
    community: "JLT",
    building: "Tower B",
    unitNo: "202",
  });
  const siblingTenancy = await tenancies.createTenancy(W.ctx, {
    propertyId: siblingProperty.id,
    tenantContactId: siblingTenantContact.id,
    landlordContactId: siblingLandlordContact.id,
    startDate: new Date("2025-10-01"),
    endDate: new Date("2026-09-30"),
    annualRent: 90000,
    ejariNo: "SIB-0001",
  });
  await payments.setPaymentSchedule(W.ctx, siblingTenancy.id, [
    { seq: 1, dueDate: new Date("2025-10-01"), amount: 90000 },
  ]);
  const siblingDoc = await documents.uploadDocument(W.ctx, {
    scopeType: "TENANCY",
    scopeId: siblingTenancy.id,
    kind: "TENANCY_CONTRACT",
    fileName: "sibling-contract.txt",
    mime: "text/plain",
    data: Buffer.from("sibling contract"),
  });
  const siblingProof = await proofs.createProofRequest(W.ctx, {
    scopeType: "TENANCY",
    scopeId: siblingTenancy.id,
    title: "Sibling proof",
    requiredEvidence: "anything",
    assignedContactId: assignee.id,
  });

  tenant = await addMember(W.workspaceId, "TENANT", undefined, tenantContact.id);
  landlord = await addMember(W.workspaceId, "LANDLORD", undefined, landlordContact.id);

  own = {
    tenancyId: ownTenancy.id,
    propertyId: ownProperty.id,
    vacantPropertyId: vacantProperty.id,
    paymentItemId: ownSchedule[0].id,
    documentId: ownDoc.id,
    proofRequestId: ownProof.id,
  };
  sibling = {
    tenancyId: siblingTenancy.id,
    propertyId: siblingProperty.id,
    documentId: siblingDoc.id,
    proofRequestId: siblingProof.id,
  };
});

describe("membership guard", () => {
  it("rejects a TENANT membership with no subjectContactId", async () => {
    await expect(addMember(W.workspaceId, "TENANT")).rejects.toThrow(/contact scope/);
  });
  it("rejects a LANDLORD membership with no subjectContactId", async () => {
    await expect(addMember(W.workspaceId, "LANDLORD")).rejects.toThrow(/contact scope/);
  });
});

describe("fail-closed: unadapted primitives throw for a persona context", () => {
  it("scope() throws (the list-family choke point)", () => {
    expect(() => scope(tenant.ctx)).toThrow();
    expect(() => scope(landlord.ctx)).toThrow();
  });
  it("assertSameWorkspace() throws even on a same-workspace row (the by-id choke point)", () => {
    expect(() => assertSameWorkspace(tenant.ctx, { workspaceId: W.workspaceId })).toThrow();
  });
});

describe("TENANT sees only their own Contact's records", () => {
  it("getTenancy: own resolves, sibling denied", async () => {
    await expect(tenancies.getTenancy(tenant.ctx, own.tenancyId)).resolves.toBeTruthy();
    await expect(tenancies.getTenancy(tenant.ctx, sibling.tenancyId)).rejects.toThrow();
  });

  it("listPayments: own only", async () => {
    const items = await payments.listPayments(tenant.ctx);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.tenancyId === own.tenancyId)).toBe(true);
  });

  it("listDeadlines: own only", async () => {
    const rows = await deadlines.listDeadlines(tenant.ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((d) => d.tenancyId === own.tenancyId || d.propertyId === own.propertyId)).toBe(true);
  });

  it("listDocuments / getDocument / getDocumentAccessLog: own only, sibling denied", async () => {
    const docs = await documents.listDocuments(tenant.ctx);
    expect(docs.map((d) => d.id)).toEqual([own.documentId]);
    await expect(documents.getDocument(tenant.ctx, own.documentId)).resolves.toBeTruthy();
    await expect(documents.getDocument(tenant.ctx, sibling.documentId)).rejects.toThrow();
    await expect(documents.getDocumentAccessLog(tenant.ctx, sibling.documentId)).rejects.toThrow();
  });

  it("listProofRequests / getProofRequest: own only, sibling denied", async () => {
    const reqs = await proofs.listProofRequests(tenant.ctx);
    expect(reqs.map((r) => r.id)).toEqual([own.proofRequestId]);
    await expect(proofs.getProofRequest(tenant.ctx, own.proofRequestId)).resolves.toBeTruthy();
    await expect(proofs.getProofRequest(tenant.ctx, sibling.proofRequestId)).rejects.toThrow();
  });

  it("cannot reach properties at all (no properties.read capability)", async () => {
    await expect(properties.getProperty(tenant.ctx, own.propertyId)).rejects.toThrow(/properties\.read/);
  });
});

describe("signed URL is a second boundary (positive + negative)", () => {
  it("sibling document URL is denied at the authz check", async () => {
    await expect(documents.getDocumentUrl(tenant.ctx, sibling.documentId)).rejects.toThrow();
  });

  it("own document URL succeeds with the same short TTL as the operator path", async () => {
    const operatorUrl = await documents.getDocumentUrl(W.ctx, own.documentId);
    const tenantUrl = await documents.getDocumentUrl(tenant.ctx, own.documentId);
    // Same object path — the persona does not get a different/broader URL shape.
    expect(tenantUrl.url.startsWith(`/api/v1/files/${own.documentId}?`)).toBe(true);
    expect(operatorUrl.url.startsWith(`/api/v1/files/${own.documentId}?`)).toBe(true);
    // Bearer token: assert the TTL is the same short window, not a longer one.
    const exp = Number(new URLSearchParams(tenantUrl.url.split("?")[1]).get("expires"));
    const now = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThan(now);
    expect(exp).toBeLessThanOrEqual(now + 300 + 5);
  });
});

describe("LANDLORD scope (owned properties incl. vacant)", () => {
  it("listProperties: includes owned + vacant, excludes sibling", async () => {
    const props = await properties.listProperties(landlord.ctx);
    const ids = props.map((p) => p.id);
    expect(ids).toContain(own.propertyId);
    expect(ids).toContain(own.vacantPropertyId); // Decision 4: vacant unit visible
    expect(ids).not.toContain(sibling.propertyId);
  });

  it("getProperty: own + vacant resolve, sibling denied", async () => {
    await expect(properties.getProperty(landlord.ctx, own.propertyId)).resolves.toBeTruthy();
    await expect(properties.getProperty(landlord.ctx, own.vacantPropertyId)).resolves.toBeTruthy();
    await expect(properties.getProperty(landlord.ctx, sibling.propertyId)).rejects.toThrow();
  });

  it("getTenancy (landlord of record): own resolves, sibling denied", async () => {
    await expect(tenancies.getTenancy(landlord.ctx, own.tenancyId)).resolves.toBeTruthy();
    await expect(tenancies.getTenancy(landlord.ctx, sibling.tenancyId)).rejects.toThrow();
  });
});

describe("assertReadable discriminates WITHIN the workspace (the real proof)", () => {
  it("own tenancy passes, in-workspace sibling tenancy throws", async () => {
    const ownRow = await prisma.tenancy.findUnique({ where: { id: own.tenancyId }, include: { property: true } });
    const sibRow = await prisma.tenancy.findUnique({ where: { id: sibling.tenancyId }, include: { property: true } });
    await expect(assertReadable(tenant.ctx, { kind: "tenancy", row: ownRow })).resolves.toBeUndefined();
    await expect(assertReadable(tenant.ctx, { kind: "tenancy", row: sibRow })).rejects.toThrow();
  });

  it("own document passes, sibling document throws", async () => {
    const ownDoc = await prisma.document.findUnique({ where: { id: own.documentId } });
    const sibDoc = await prisma.document.findUnique({ where: { id: sibling.documentId } });
    await expect(assertReadable(tenant.ctx, { kind: "document", row: ownDoc })).resolves.toBeUndefined();
    await expect(assertReadable(tenant.ctx, { kind: "document", row: sibDoc })).rejects.toThrow();
  });
});

describe("multi-role resolution is deterministic (operator wins — F0b)", () => {
  it("authz() resolves a user holding TENANT + FIDUCIARY in one workspace to the operator role", async () => {
    const dual = await prisma.user.create({
      data: { email: `dual-${Date.now()}@test.example`, name: "Dual Role" },
    });
    const dualContact = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Dual Tenant" });
    // Persona membership created FIRST (older row): a createdAt-only resolver would
    // pick TENANT and run every request under contact scope. Precedence must override.
    await prisma.membership.create({
      data: { workspaceId: W.workspaceId, userId: dual.id, role: "TENANT", subjectContactId: dualContact.id },
    });
    await prisma.membership.create({
      data: { workspaceId: W.workspaceId, userId: dual.id, role: "FIDUCIARY" },
    });
    const ctx = await authz(dual.id, W.workspaceId);
    expect(ctx.role).toBe("FIDUCIARY");
    expect(ctx.subjectContactId).toBeNull();
  });
});
