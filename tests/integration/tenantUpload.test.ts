import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as documents from "@/server/services/documents";

// 2B #16 — authenticated tenant self-upload. A tenant attaches a document to their
// OWN tenancy (gated on tenancies.upload + getTenancy scope); it is TENANCY-scoped so
// only the tenancy's parties read it back. A sibling tenant cannot upload or read.

let W: TestActor;
let tenant: TestActor;
let sibling: TestActor;
let ownTenancyId: string;
let siblingTenancyId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Tenant upload WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Own Tenant" });
  const sc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Sibling Tenant" });
  const p1 = await properties.createProperty(W.ctx, { clientPrincipalId: client.id, ownerContactId: owner.id, community: "Marina", unitNo: "1" });
  const p2 = await properties.createProperty(W.ctx, { clientPrincipalId: client.id, ownerContactId: owner.id, community: "JLT", unitNo: "2" });
  ownTenancyId = (await tenancies.createTenancy(W.ctx, {
    propertyId: p1.id, tenantContactId: tc.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 90000, ejariNo: "E-1",
  })).id;
  siblingTenancyId = (await tenancies.createTenancy(W.ctx, {
    propertyId: p2.id, tenantContactId: sc.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 80000, ejariNo: "E-2",
  })).id;
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
  sibling = await addMember(W.workspaceId, "TENANT", undefined, sc.id);
});

describe("tenant self-upload", () => {
  it("uploads to own tenancy, records DOCUMENT_UPLOADED, readable by the owner", async () => {
    const doc = await tenancies.uploadTenancyDocument(tenant.ctx, ownTenancyId, {
      fileName: "passport-copy.pdf", mime: "application/pdf", data: Buffer.from("x"),
    });
    expect(doc.scopeType).toBe("TENANCY");
    const ev = await prisma.evidenceEvent.findFirst({ where: { workspaceId: W.workspaceId, type: "DOCUMENT_UPLOADED", scopeId: ownTenancyId } });
    expect((ev!.payload as { selfUpload?: boolean }).selfUpload).toBe(true);
    await expect(documents.getDocument(tenant.ctx, doc.id)).resolves.toBeTruthy();
  });

  it("cannot upload to a sibling tenant's tenancy", async () => {
    await expect(
      tenancies.uploadTenancyDocument(tenant.ctx, siblingTenancyId, { fileName: "x", mime: "text/plain", data: Buffer.from("x") }),
    ).rejects.toThrow();
  });

  it("a sibling cannot read the document", async () => {
    const doc = await tenancies.uploadTenancyDocument(tenant.ctx, ownTenancyId, { fileName: "x", mime: "text/plain", data: Buffer.from("x") });
    await expect(documents.getDocument(sibling.ctx, doc.id)).rejects.toThrow();
  });

  it("a landlord cannot self-upload (no tenancies.upload)", async () => {
    const ownerC = await contacts.createContact(W.ctx, { kind: "OWNER", name: "L" });
    const landlord = await addMember(W.workspaceId, "LANDLORD", undefined, ownerC.id);
    await expect(
      tenancies.uploadTenancyDocument(landlord.ctx, ownTenancyId, { fileName: "x", mime: "text/plain", data: Buffer.from("x") }),
    ).rejects.toThrow(/tenancies\.upload/);
  });
});
