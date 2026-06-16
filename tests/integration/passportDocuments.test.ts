import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as contacts from "@/server/services/contacts";
import * as passport from "@/server/services/tenantPassport";
import * as documents from "@/server/services/documents";

// 1C #6 — Passport documents reuse the shared ingest/storage path and are scoped
// TENANT_PASSPORT, so the owning tenant reaches them through the normal document
// surfaces (list/get/url) while a sibling tenant cannot — the F0a boundary extended
// to a new scope type.

let W: TestActor;
let tenant: TestActor;
let sibling: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Passport docs WS");
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Own Tenant" });
  const sc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Sibling Tenant" });
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
  sibling = await addMember(W.workspaceId, "TENANT", undefined, sc.id);
});

describe("passport documents", () => {
  it("uploads, records DOCUMENT_UPLOADED, and is readable by the owner via the document surfaces", async () => {
    const doc = await passport.uploadPassportDocument(tenant.ctx, {
      fileName: "emirates-id.png",
      mime: "image/png",
      data: Buffer.from("id-bytes"),
      kind: "ID_DOCUMENT",
    });

    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "DOCUMENT_UPLOADED", scopeType: "TENANT_PASSPORT" },
    });
    expect(ev).toBeTruthy();
    expect((ev!.payload as { documentId: string }).documentId).toBe(doc.id);

    // Owner reaches it through the generic, contact-scoped document paths.
    const listed = await passport.listPassportDocuments(tenant.ctx);
    expect(listed.map((d) => d.id)).toContain(doc.id);
    await expect(documents.getDocument(tenant.ctx, doc.id)).resolves.toBeTruthy();
    const { url } = await documents.getDocumentUrl(tenant.ctx, doc.id);
    expect(url).toContain(doc.id);
  });

  it("a sibling tenant cannot read another tenant's passport document", async () => {
    const doc = await passport.uploadPassportDocument(tenant.ctx, {
      fileName: "salary.pdf",
      mime: "application/pdf",
      data: Buffer.from("salary"),
      kind: "BANK_CONFIRMATION",
    });
    await expect(documents.getDocument(sibling.ctx, doc.id)).rejects.toThrow();
    await expect(documents.getDocumentUrl(sibling.ctx, doc.id)).rejects.toThrow();
    const siblingDocs = await documents.listDocuments(sibling.ctx);
    expect(siblingDocs.map((d) => d.id)).not.toContain(doc.id);
  });

  it("a landlord persona cannot upload to a passport", async () => {
    const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
    const landlord = await addMember(W.workspaceId, "LANDLORD", undefined, owner.id);
    await expect(
      passport.uploadPassportDocument(landlord.ctx, {
        fileName: "x.png",
        mime: "image/png",
        data: Buffer.from("x"),
      }),
    ).rejects.toThrow(/passport\.write/);
  });
});
