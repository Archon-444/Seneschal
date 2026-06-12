import { beforeAll, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as payments from "@/server/services/payments";
import * as documents from "@/server/services/documents";
import * as proofs from "@/server/services/proofs";
import * as secureLinks from "@/server/services/secureLinks";
import * as imports from "@/server/services/imports";
import * as evidenceQuery from "@/server/services/evidenceQuery";
import * as reports from "@/server/services/reports";
import * as deadlines from "@/server/services/deadlines";
import * as risk from "@/server/services/risk";

// T1.4 ⛔ Cross-workspace security suite — release blocking.
// Workspace B must not read or write ANY scoped resource of workspace A.

let A: TestActor;
let B: TestActor;
let a: {
  clientId: string;
  contactId: string;
  propertyId: string;
  tenancyId: string;
  paymentItemId: string;
  documentId: string;
  proofRequestId: string;
  linkId: string;
  batchId: string;
};

beforeAll(async () => {
  await resetDb();
  A = await makeWorkspace("Workspace A");
  B = await makeWorkspace("Workspace B");

  const client = await clients.createClient(A.ctx, { displayName: "A Client" });
  const contact = await contacts.createContact(A.ctx, {
    kind: "AGENT",
    name: "A Agent",
    email: "agent-a@test.example",
  });
  const property = await properties.createProperty(A.ctx, {
    clientPrincipalId: client.id,
    community: "Dubai Marina",
    building: "Tower A",
    unitNo: "101",
  });
  const tenancy = await tenancies.createTenancy(A.ctx, {
    propertyId: property.id,
    startDate: new Date("2025-09-16"),
    endDate: new Date("2026-09-15"),
    annualRent: 72000,
    ejariNo: "A-0001",
  });
  const schedule = await payments.setPaymentSchedule(A.ctx, tenancy.id, [
    { seq: 1, dueDate: new Date("2025-09-16"), amount: 72000 },
  ]);
  const doc = await documents.uploadDocument(A.ctx, {
    scopeType: "TENANCY",
    scopeId: tenancy.id,
    kind: "TENANCY_CONTRACT",
    fileName: "contract-a.txt",
    mime: "text/plain",
    data: Buffer.from("workspace A contract"),
  });
  const proofRequest = await proofs.createProofRequest(A.ctx, {
    scopeType: "TENANCY",
    scopeId: tenancy.id,
    title: "A proof",
    requiredEvidence: "anything",
    assignedContactId: contact.id,
  });
  const link = await secureLinks.createSecureLink(A.ctx, {
    purpose: "PROOF_UPLOAD",
    scopeType: "PROOF_REQUEST",
    scopeId: proofRequest.id,
  });
  const batch = await imports.createImportBatch(A.ctx, "EXCEL");

  a = {
    clientId: client.id,
    contactId: contact.id,
    propertyId: property.id,
    tenancyId: tenancy.id,
    paymentItemId: schedule[0].id,
    documentId: doc.id,
    proofRequestId: proofRequest.id,
    linkId: link.linkId,
    batchId: batch.id,
  };
});

describe("workspace B cannot READ workspace A resources", () => {
  it("clients", async () => {
    await expect(clients.getClient(B.ctx, a.clientId)).rejects.toThrow();
    expect(await clients.listClients(B.ctx)).toHaveLength(0);
  });
  it("contacts", async () => {
    await expect(contacts.getContact(B.ctx, a.contactId)).rejects.toThrow();
    expect(await contacts.listContacts(B.ctx)).toHaveLength(0);
  });
  it("properties", async () => {
    await expect(properties.getProperty(B.ctx, a.propertyId)).rejects.toThrow();
    expect(await properties.listProperties(B.ctx)).toHaveLength(0);
  });
  it("tenancies", async () => {
    await expect(tenancies.getTenancy(B.ctx, a.tenancyId)).rejects.toThrow();
  });
  it("payments", async () => {
    expect(await payments.listPayments(B.ctx)).toHaveLength(0);
  });
  it("documents", async () => {
    await expect(documents.getDocument(B.ctx, a.documentId)).rejects.toThrow();
    await expect(documents.getDocumentUrl(B.ctx, a.documentId)).rejects.toThrow();
    await expect(documents.getDocumentAccessLog(B.ctx, a.documentId)).rejects.toThrow();
    expect(await documents.listDocuments(B.ctx)).toHaveLength(0);
  });
  it("proof requests", async () => {
    await expect(proofs.getProofRequest(B.ctx, a.proofRequestId)).rejects.toThrow();
    expect(await proofs.listProofRequests(B.ctx)).toHaveLength(0);
  });
  it("import batches", async () => {
    await expect(imports.getImportBatch(B.ctx, a.batchId)).rejects.toThrow();
    expect(await imports.listImportBatches(B.ctx)).toHaveLength(0);
  });
  it("evidence", async () => {
    expect(await evidenceQuery.listEvidence(B.ctx)).toHaveLength(0);
  });
  it("deadlines", async () => {
    expect(await deadlines.listDeadlines(B.ctx)).toHaveLength(0);
  });
  it("risk flags", async () => {
    expect(await risk.listRiskFlags(B.ctx)).toHaveLength(0);
  });
  it("reports", async () => {
    await expect(reports.buildClientReport(B.ctx, a.clientId)).rejects.toThrow();
  });
});

describe("workspace B cannot WRITE workspace A resources", () => {
  it("client update/archive", async () => {
    await expect(clients.updateClient(B.ctx, a.clientId, { displayName: "pwn" })).rejects.toThrow();
    await expect(clients.archiveClient(B.ctx, a.clientId)).rejects.toThrow();
  });
  it("property update/archive", async () => {
    await expect(properties.updateProperty(B.ctx, a.propertyId, { notes: "pwn" })).rejects.toThrow();
    await expect(properties.archiveProperty(B.ctx, a.propertyId)).rejects.toThrow();
  });
  it("tenancy create on A property, update, archive", async () => {
    await expect(
      tenancies.createTenancy(B.ctx, {
        propertyId: a.propertyId,
        startDate: new Date("2027-01-01"),
        endDate: new Date("2027-12-31"),
        annualRent: 1,
      }),
    ).rejects.toThrow();
    await expect(tenancies.updateTenancy(B.ctx, a.tenancyId, { annualRent: 1 })).rejects.toThrow();
    await expect(tenancies.archiveTenancy(B.ctx, a.tenancyId)).rejects.toThrow();
  });
  it("payment schedule + transition", async () => {
    await expect(
      payments.setPaymentSchedule(B.ctx, a.tenancyId, [
        { seq: 1, dueDate: new Date("2027-01-01"), amount: 1 },
      ]),
    ).rejects.toThrow();
    await expect(payments.transitionPayment(B.ctx, a.paymentItemId, "RECEIVED")).rejects.toThrow();
  });
  it("proof decision + secure link revoke", async () => {
    await expect(proofs.decideProofRequest(B.ctx, a.proofRequestId, "APPROVED")).rejects.toThrow();
    await expect(secureLinks.revokeSecureLink(B.ctx, a.linkId)).rejects.toThrow();
  });
  it("import rows/commit/rollback", async () => {
    await expect(
      imports.addImportRows(B.ctx, a.batchId, [
        {
          raw: {},
          mapped: { community: "X", startDate: "2027-01-01", endDate: "2027-12-31", annualRent: 1 },
        },
      ]),
    ).rejects.toThrow();
    await expect(imports.commitImportBatch(B.ctx, a.batchId)).rejects.toThrow();
    await expect(imports.rollbackImportBatch(B.ctx, a.batchId)).rejects.toThrow();
  });
  it("document archive", async () => {
    await expect(documents.archiveDocument(B.ctx, a.documentId)).rejects.toThrow();
  });
});

describe("CLIENT_VIEWER scoping", () => {
  it("cannot see sibling clients of the same workspace", async () => {
    const sibling = await clients.createClient(A.ctx, { displayName: "Sibling Client" });
    const viewer = await addMember(A.workspaceId, "CLIENT_VIEWER", a.clientId);

    const visible = await clients.listClients(viewer.ctx);
    expect(visible.map((c) => c.id)).toEqual([a.clientId]);
    await expect(clients.getClient(viewer.ctx, sibling.id)).rejects.toThrow();

    // sibling-scoped property invisible
    const siblingProperty = await properties.createProperty(A.ctx, {
      clientPrincipalId: sibling.id,
      community: "JVC",
      unitNo: "9",
    });
    const list = await properties.listProperties(viewer.ctx);
    expect(list.map((p) => p.id)).toEqual([a.propertyId]);
    await expect(properties.getProperty(viewer.ctx, siblingProperty.id)).rejects.toThrow();
  });

  it("cannot write anything", async () => {
    const viewer = await addMember(A.workspaceId, "CLIENT_VIEWER", a.clientId);
    await expect(clients.createClient(viewer.ctx, { displayName: "no" })).rejects.toThrow();
    await expect(
      properties.createProperty(viewer.ctx, { clientPrincipalId: a.clientId, community: "no" }),
    ).rejects.toThrow();
    await expect(payments.transitionPayment(viewer.ctx, a.paymentItemId, "RECEIVED")).rejects.toThrow();
  });

  it("client-viewer membership without client scope is rejected", async () => {
    await expect(addMember(A.workspaceId, "CLIENT_VIEWER")).rejects.toThrow();
  });
});

describe("defense in depth", () => {
  it("evidence and audit rows are workspace-tagged", async () => {
    const aEvidence = await prisma.evidenceEvent.findMany({ where: { workspaceId: A.workspaceId } });
    expect(aEvidence.length).toBeGreaterThan(0);
    const bEvidence = await prisma.evidenceEvent.findMany({ where: { workspaceId: B.workspaceId } });
    expect(bEvidence).toHaveLength(0);
  });
});
