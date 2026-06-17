import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as payments from "@/server/services/payments";
import * as documents from "@/server/services/documents";

// 2B #18 — read-only cheque/deposit receipt vault. Receipts are PAYMENT_ITEM-scoped;
// a tenant views only their own and each view records DEPOSIT_RECEIPT_VIEWED. A
// sibling tenant is denied, and the view path refuses a non-receipt document.

let W: TestActor;
let tenant: TestActor;
let sibling: TestActor;
let ownTenancyId: string;
let receiptId: string;
let ownTenancyDocId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Receipts WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Own Tenant" });
  const sc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Sibling Tenant" });
  const p1 = await properties.createProperty(W.ctx, { clientPrincipalId: client.id, ownerContactId: owner.id, community: "Marina", unitNo: "1" });
  const p2 = await properties.createProperty(W.ctx, { clientPrincipalId: client.id, ownerContactId: owner.id, community: "JLT", unitNo: "2" });
  const t1 = await tenancies.createTenancy(W.ctx, { propertyId: p1.id, tenantContactId: tc.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 90000, ejariNo: "E-1" });
  await tenancies.createTenancy(W.ctx, { propertyId: p2.id, tenantContactId: sc.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 80000, ejariNo: "E-2" });
  ownTenancyId = t1.id;
  const schedule = await payments.setPaymentSchedule(W.ctx, t1.id, [{ seq: 1, dueDate: new Date("2026-01-15"), amount: 45000 }]);
  // Operator attaches a PAYMENT_ITEM-scoped receipt to the cheque.
  const receipt = await documents.uploadDocument(W.ctx, {
    scopeType: "PAYMENT_ITEM", scopeId: schedule[0].id, kind: "RECEIPT",
    fileName: "deposit-slip.jpg", mime: "image/jpeg", data: Buffer.from("slip"),
  });
  receiptId = receipt.id;
  // A non-receipt (tenancy-scoped) doc on the same tenancy, to prove the view path is receipt-only.
  ownTenancyDocId = (await documents.uploadDocument(W.ctx, {
    scopeType: "TENANCY", scopeId: t1.id, kind: "OTHER", fileName: "x.txt", mime: "text/plain", data: Buffer.from("x"),
  })).id;
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
  sibling = await addMember(W.workspaceId, "TENANT", undefined, sc.id);
});

describe("receipt vault", () => {
  it("lists a tenancy's receipts and the tenant views one, recording DEPOSIT_RECEIPT_VIEWED", async () => {
    const list = await payments.listTenancyReceipts(tenant.ctx, ownTenancyId);
    expect(list.map((d) => d.id)).toContain(receiptId);

    const { url } = await payments.viewPaymentReceipt(tenant.ctx, receiptId);
    expect(url).toContain(receiptId);
    const ev = await prisma.evidenceEvent.findFirst({ where: { workspaceId: W.workspaceId, type: "DEPOSIT_RECEIPT_VIEWED", payload: { path: ["documentId"], equals: receiptId } } });
    expect(ev).toBeTruthy();
  });

  it("a sibling tenant cannot view another tenant's receipt", async () => {
    await expect(payments.viewPaymentReceipt(sibling.ctx, receiptId)).rejects.toThrow();
    await expect(payments.listTenancyReceipts(sibling.ctx, ownTenancyId)).rejects.toThrow();
  });

  it("the receipt-view path refuses a non-receipt (non-PAYMENT_ITEM) document", async () => {
    await expect(payments.viewPaymentReceipt(tenant.ctx, ownTenancyDocId)).rejects.toThrow(/receipt/i);
  });
});
