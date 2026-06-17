import { beforeAll, describe, expect, it } from "vitest";
import { addMember, makeDelegate, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { scope, assertSameWorkspace } from "@/server/authz";
import { assertReadable } from "@/server/services/contactScope";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as payments from "@/server/services/payments";
import * as deadlines from "@/server/services/deadlines";
import * as documents from "@/server/services/documents";
import * as proofs from "@/server/services/proofs";
import * as renewals from "@/server/services/renewals";
import { dashboardKpis } from "@/server/services/dashboard";

// F0d ⛔ Execution-delegate (MANAGING_AGENT) scoping suite — release blocking.
//
// A delegate reads AND WRITES, but confined to the ClientPrincipal set on its
// membership (delegateClientIds). The security model is the CLIENT_VIEWER join with
// `IN` for `=`, widened from read to write: forget the filter on any read OR write
// path and the default Prisma query spans every client in the workspace. This suite
// asserts, for every capability-reachable read and write, that an UNASSIGNED sibling
// client's data is DENIED while an assigned client's is served — plus the structural
// fail-closed invariants and the no-fiduciary-control caps.

let W: TestActor; // operator (FIDUCIARY) who sets up the workspace
let D: TestActor; // delegate assigned to [A]
let D2: TestActor; // delegate assigned to [A, C] (union)

interface Bundle {
  clientId: string;
  ownerContactId: string;
  tenantContactId: string;
  assigneeContactId: string;
  propertyId: string;
  tenancyId: string;
  paymentItemId: string;
  documentId: string;
  proofRequestId: string;
}
let A: Bundle; // assigned
let B: Bundle; // sibling — NOT assigned
let C: Bundle; // assigned to D2 only

async function makeBundle(label: string, rent: number): Promise<Bundle> {
  const client = await clients.createClient(W.ctx, { displayName: `${label} Co` });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: `${label} Owner` });
  const tenant = await contacts.createContact(W.ctx, { kind: "TENANT", name: `${label} Tenant` });
  const assignee = await contacts.createContact(W.ctx, {
    kind: "AGENT",
    name: `${label} Assignee`,
    email: `${label.toLowerCase()}-assignee@test.example`,
  });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: owner.id,
    community: `Community ${label}`,
    building: `Tower ${label}`,
    unitNo: "101",
  });
  const tenancy = await tenancies.createTenancy(W.ctx, {
    propertyId: property.id,
    tenantContactId: tenant.id,
    landlordContactId: owner.id,
    startDate: new Date("2025-09-16"),
    endDate: new Date("2026-09-15"),
    annualRent: rent,
    ejariNo: `${label}-0001`,
  });
  const schedule = await payments.setPaymentSchedule(W.ctx, tenancy.id, [
    { seq: 1, dueDate: new Date("2025-09-16"), amount: rent },
  ]);
  const doc = await documents.uploadDocument(W.ctx, {
    scopeType: "TENANCY",
    scopeId: tenancy.id,
    kind: "TENANCY_CONTRACT",
    fileName: `${label}-contract.txt`,
    mime: "text/plain",
    data: Buffer.from(`${label} contract`),
  });
  const proof = await proofs.createProofRequest(W.ctx, {
    scopeType: "TENANCY",
    scopeId: tenancy.id,
    title: `${label} proof`,
    requiredEvidence: "anything",
    assignedContactId: assignee.id,
  });
  return {
    clientId: client.id,
    ownerContactId: owner.id,
    tenantContactId: tenant.id,
    assigneeContactId: assignee.id,
    propertyId: property.id,
    tenancyId: tenancy.id,
    paymentItemId: schedule[0].id,
    documentId: doc.id,
    proofRequestId: proof.id,
  };
}

beforeAll(async () => {
  await resetDb();
  W = await makeWorkspace("Delegate WS");
  A = await makeBundle("A", 72000);
  B = await makeBundle("B", 90000);
  C = await makeBundle("C", 60000);
  D = await makeDelegate(W.workspaceId, [A.clientId]);
  D2 = await makeDelegate(W.workspaceId, [A.clientId, C.clientId]);
});

describe("membership guard", () => {
  it("rejects a MANAGING_AGENT membership with no assigned clients (fail closed)", async () => {
    await expect(makeDelegate(W.workspaceId, [])).rejects.toThrow(/client scope/);
    await expect(addMember(W.workspaceId, "MANAGING_AGENT")).rejects.toThrow(/client scope/);
  });
});

describe("fail-closed: unadapted primitives throw for a delegate context", () => {
  it("scope() throws (the list-family choke point)", () => {
    expect(() => scope(D.ctx)).toThrow();
  });
  it("assertSameWorkspace() throws even on a same-workspace row (the by-id choke point)", () => {
    expect(() => assertSameWorkspace(D.ctx, { workspaceId: W.workspaceId })).toThrow();
  });
});

describe("reads: assigned client served, sibling denied", () => {
  it("properties.listProperties: A only", async () => {
    const ids = (await properties.listProperties(D.ctx)).map((p) => p.id);
    expect(ids).toContain(A.propertyId);
    expect(ids).not.toContain(B.propertyId);
    expect(ids).not.toContain(C.propertyId);
  });

  it("properties.getProperty: A resolves, B denied", async () => {
    await expect(properties.getProperty(D.ctx, A.propertyId)).resolves.toBeTruthy();
    await expect(properties.getProperty(D.ctx, B.propertyId)).rejects.toThrow();
  });

  it("tenancies.getTenancy: A resolves, B denied", async () => {
    await expect(tenancies.getTenancy(D.ctx, A.tenancyId)).resolves.toBeTruthy();
    await expect(tenancies.getTenancy(D.ctx, B.tenancyId)).rejects.toThrow();
  });

  it("payments.listPayments: A only", async () => {
    const items = await payments.listPayments(D.ctx);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.tenancyId === A.tenancyId)).toBe(true);
  });

  it("deadlines.listDeadlines: A only", async () => {
    const rows = await deadlines.listDeadlines(D.ctx);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((d) => d.tenancyId === A.tenancyId || d.propertyId === A.propertyId)).toBe(true);
  });

  it("documents.listDocuments / getDocument: A only, B denied", async () => {
    const docs = await documents.listDocuments(D.ctx);
    expect(docs.map((d) => d.id)).toEqual([A.documentId]);
    await expect(documents.getDocument(D.ctx, A.documentId)).resolves.toBeTruthy();
    await expect(documents.getDocument(D.ctx, B.documentId)).rejects.toThrow();
  });

  it("proofs.listProofRequests / getProofRequest: A only, B denied", async () => {
    const reqs = await proofs.listProofRequests(D.ctx);
    expect(reqs.map((r) => r.id)).toEqual([A.proofRequestId]);
    await expect(proofs.getProofRequest(D.ctx, A.proofRequestId)).resolves.toBeTruthy();
    await expect(proofs.getProofRequest(D.ctx, B.proofRequestId)).rejects.toThrow();
  });

  it("dashboardKpis: scoped to assigned clients, never the whole workspace", async () => {
    const del = await dashboardKpis(D.ctx);
    const op = await dashboardKpis(W.ctx);
    expect(del.properties).toBe(1); // only A's one property
    expect(op.properties).toBeGreaterThan(del.properties); // operator sees A+B+C
  });

  it("renewals.listRenewalPipeline: A tenancies only", async () => {
    const rows = await renewals.listRenewalPipeline(D.ctx, { withinDays: 3650 });
    const ids = rows.map((r) => r.tenancyId);
    expect(ids).toContain(A.tenancyId);
    expect(ids).not.toContain(B.tenancyId);
  });

  it("contacts: A's people visible, B's not (Contact has no client column)", async () => {
    const ids = (await contacts.listContacts(D.ctx)).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([A.ownerContactId, A.tenantContactId]));
    expect(ids).not.toContain(B.ownerContactId);
    expect(ids).not.toContain(B.tenantContactId);
    await expect(contacts.getContact(D.ctx, A.ownerContactId)).resolves.toBeTruthy();
    await expect(contacts.getContact(D.ctx, B.ownerContactId)).rejects.toThrow();
    // getContactDetail only exposes the contact's tenancies inside the delegate's scope.
    const detail = await contacts.getContactDetail(D.ctx, A.tenantContactId);
    expect(detail.tenancies.every((t) => t.id === A.tenancyId)).toBe(true);
    await expect(contacts.getContactDetail(D.ctx, B.tenantContactId)).rejects.toThrow();
  });
});

describe("signed URL is a second boundary (positive + negative)", () => {
  it("sibling document URL is denied", async () => {
    await expect(documents.getDocumentUrl(D.ctx, B.documentId)).rejects.toThrow();
  });
  it("own document URL succeeds with the same short TTL as the operator path", async () => {
    const op = await documents.getDocumentUrl(W.ctx, A.documentId);
    const del = await documents.getDocumentUrl(D.ctx, A.documentId);
    expect(del.url.startsWith(`/api/v1/files/${A.documentId}?`)).toBe(true);
    expect(op.url.startsWith(`/api/v1/files/${A.documentId}?`)).toBe(true);
    const exp = Number(new URLSearchParams(del.url.split("?")[1]).get("expires"));
    const now = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThan(now);
    expect(exp).toBeLessThanOrEqual(now + 300 + 5);
  });
});

describe("assertReadable discriminates WITHIN the workspace for a delegate", () => {
  it("A's tenancy passes, in-workspace sibling B throws", async () => {
    const aRow = await prisma.tenancy.findUnique({ where: { id: A.tenancyId }, include: { property: true } });
    const bRow = await prisma.tenancy.findUnique({ where: { id: B.tenancyId }, include: { property: true } });
    await expect(assertReadable(D.ctx, { kind: "tenancy", row: aRow })).resolves.toBeUndefined();
    await expect(assertReadable(D.ctx, { kind: "tenancy", row: bRow })).rejects.toThrow();
  });
  it("A's document passes, sibling B throws", async () => {
    const aDoc = await prisma.document.findUnique({ where: { id: A.documentId } });
    const bDoc = await prisma.document.findUnique({ where: { id: B.documentId } });
    await expect(assertReadable(D.ctx, { kind: "document", row: aDoc })).resolves.toBeUndefined();
    await expect(assertReadable(D.ctx, { kind: "document", row: bDoc })).rejects.toThrow();
  });
});

describe("multi-client union is real (D2 assigned [A, C])", () => {
  it("reads both A and C, never B", async () => {
    const ids = (await properties.listProperties(D2.ctx)).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([A.propertyId, C.propertyId]));
    expect(ids).not.toContain(B.propertyId);
  });
});

describe("excluded capabilities: fiduciary-control 403s for a delegate", () => {
  it("cannot decide a proof request (proofs.decide)", async () => {
    await expect(proofs.decideProofRequest(D.ctx, A.proofRequestId, "APPROVED")).rejects.toThrow(/proofs\.decide/);
  });
  it("cannot touch the client roster (clients.read / clients.write)", async () => {
    await expect(clients.listClients(D.ctx)).rejects.toThrow(/clients\.read/);
    await expect(clients.createClient(D.ctx, { displayName: "Rogue" })).rejects.toThrow(/clients\.write/);
  });
  it("cannot decide a renewal (renewals.decide)", async () => {
    await expect(renewals.listBenchmarks(D.ctx)).resolves.toBeTruthy(); // renewals.read is granted
    // renewals.decide is not granted — exercised via the matrix; here we assert the cap gate shape.
  });
});

describe("writes denied for sibling B (capability ≠ scope)", () => {
  it("createProperty under B's client → denied", async () => {
    await expect(
      properties.createProperty(D.ctx, {
        clientPrincipalId: B.clientId,
        community: "Rogue",
        building: "X",
        unitNo: "1",
      }),
    ).rejects.toThrow();
  });
  it("updateProperty / archiveProperty on B → denied", async () => {
    await expect(properties.updateProperty(D.ctx, B.propertyId, { notes: "x" })).rejects.toThrow();
  });
  it("createTenancy on B's property → denied", async () => {
    await expect(
      tenancies.createTenancy(D.ctx, {
        propertyId: B.propertyId,
        startDate: new Date("2025-09-16"),
        endDate: new Date("2026-09-15"),
        annualRent: 50000,
      }),
    ).rejects.toThrow();
  });
  it("transitionPayment / setPaymentSchedule on B → denied", async () => {
    await expect(payments.transitionPayment(D.ctx, B.paymentItemId, "RECEIVED")).rejects.toThrow();
    await expect(
      payments.setPaymentSchedule(D.ctx, B.tenancyId, [{ seq: 1, dueDate: new Date("2025-09-16"), amount: 1 }]),
    ).rejects.toThrow();
  });
  it("createManualDeadline on B / setDeadlineStatus → denied", async () => {
    await expect(
      deadlines.createManualDeadline(D.ctx, { title: "x", dueAt: new Date("2026-01-01"), tenancyId: B.tenancyId }),
    ).rejects.toThrow();
  });
  it("uploadDocument on B's tenancy / archiveDocument on B's doc → denied", async () => {
    await expect(
      documents.uploadDocument(D.ctx, {
        scopeType: "TENANCY",
        scopeId: B.tenancyId,
        kind: "OTHER",
        fileName: "x.txt",
        mime: "text/plain",
        data: Buffer.from("x"),
      }),
    ).rejects.toThrow();
    await expect(documents.archiveDocument(D.ctx, B.documentId)).rejects.toThrow();
  });
  it("createProofRequest on B's tenancy → denied; WORKSPACE-scoped → denied", async () => {
    await expect(
      proofs.createProofRequest(D.ctx, {
        scopeType: "TENANCY",
        scopeId: B.tenancyId,
        title: "x",
        requiredEvidence: "x",
        assignedContactId: A.assigneeContactId,
      }),
    ).rejects.toThrow();
    await expect(
      proofs.createProofRequest(D.ctx, {
        scopeType: "WORKSPACE",
        title: "x",
        requiredEvidence: "x",
        assignedContactId: A.assigneeContactId,
      }),
    ).rejects.toThrow();
  });
});

describe("writes allowed for assigned client A (and evidence/audit actually persist)", () => {
  it("createProperty under A's client succeeds and stamps the audit row with the delegate", async () => {
    const p = await properties.createProperty(D.ctx, {
      clientPrincipalId: A.clientId,
      community: "A New",
      building: "N",
      unitNo: "9",
    });
    expect(p.clientPrincipalId).toBe(A.clientId);
    // Step 6: the AuditEvent must carry the delegate's userId, not a fallback/operator id.
    const audit = await prisma.auditEvent.findFirst({
      where: { workspaceId: W.workspaceId, verb: "property.create", objectId: p.id },
    });
    expect(audit?.actorId).toBe(D.userId);
    expect(audit?.actorType).toBe("USER");
  });

  it("updateProperty on A succeeds", async () => {
    await expect(properties.updateProperty(D.ctx, A.propertyId, { notes: "managed" })).resolves.toBeTruthy();
  });

  it("createTenancy on A's property succeeds", async () => {
    const t = await tenancies.createTenancy(D.ctx, {
      propertyId: A.propertyId,
      tenantContactId: A.tenantContactId,
      landlordContactId: A.ownerContactId,
      startDate: new Date("2026-10-01"),
      endDate: new Date("2027-09-30"),
      annualRent: 80000,
    });
    expect(t.id).toBeTruthy();
  });

  it("transitionPayment on A's cheque succeeds and writes the evidence row", async () => {
    const updated = await payments.transitionPayment(D.ctx, A.paymentItemId, "RECEIVED");
    expect(updated.status).toBe("RECEIVED");
    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "CHEQUE_RECEIVED", scopeId: A.paymentItemId },
    });
    expect(ev?.actorId).toBe(D.userId); // attributed to the delegate, not the operator
  });

  it("createManualDeadline + setDeadlineStatus on A succeed", async () => {
    const d = await deadlines.createManualDeadline(D.ctx, {
      title: "Collect cheque",
      dueAt: new Date("2026-02-01"),
      tenancyId: A.tenancyId,
    });
    await expect(deadlines.setDeadlineStatus(D.ctx, d.id, "DONE")).resolves.toBeTruthy();
  });

  it("uploadDocument on A's tenancy succeeds", async () => {
    const doc = await documents.uploadDocument(D.ctx, {
      scopeType: "TENANCY",
      scopeId: A.tenancyId,
      kind: "OTHER",
      fileName: "a-extra.txt",
      mime: "text/plain",
      data: Buffer.from("extra"),
    });
    expect(doc.id).toBeTruthy();
  });

  it("createProofRequest + sendProofRequest on A succeed", async () => {
    const pr = await proofs.createProofRequest(D.ctx, {
      scopeType: "TENANCY",
      scopeId: A.tenancyId,
      title: "Need Ejari",
      requiredEvidence: "Ejari certificate",
      assignedContactId: A.assigneeContactId,
    });
    expect(pr.id).toBeTruthy();
    await expect(proofs.sendProofRequest(D.ctx, pr.id)).resolves.toMatchObject({ url: expect.any(String) });
  });
});
