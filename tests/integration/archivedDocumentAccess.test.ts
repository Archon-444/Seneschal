import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as proofs from "@/server/services/proofs";
import * as contacts from "@/server/services/contacts";
import * as documents from "@/server/services/documents";
import * as secureLinks from "@/server/services/secureLinks";
import { signedFileUrl } from "@/server/storage";

// Issue #55 — archiving a document has to revoke access that was already
// handed out, not just hide the row from future lists. The signed download URL
// is bearer-style: once minted it is valid until it expires, so the only thing
// standing between an archived document and a download is readDocumentBytes
// returning null. This drives the real route handler with a genuinely valid
// signature so nothing but the archive state can be doing the refusing.

vi.mock("next/headers", () => ({
  headers: async () => new Map(),
  cookies: async () => ({ get: () => undefined }),
}));

const { GET } = await import("@/app/api/v1/files/[id]/route");

let W: TestActor;
let contactId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Fiduciary");
  const c = await contacts.createContact(W.ctx, {
    kind: "AGENT",
    name: "Samir Khan",
    email: "samir@test.example",
  });
  contactId = c.id;
});

/** A document that arrived through the public proof link, as a tenant's upload does. */
async function uploadedViaPublicLink() {
  const request = await proofs.createProofRequest(W.ctx, {
    scopeType: "WORKSPACE",
    title: "Upload cheque proof",
    requiredEvidence: "Deposit slip photo",
    assignedContactId: contactId,
  });
  const { url } = await proofs.sendProofRequest(W.ctx, request.id);
  const validation = await secureLinks.validateLinkToken(url.split("/link/")[1]);
  if (!validation.ok) throw new Error("link should validate");
  const [doc] = await proofs.submitProofViaLink(
    validation.link,
    [{ fileName: "slip.jpg", mime: "image/jpeg", data: Buffer.from("fake-image-bytes") }],
    undefined,
    { ip: "1.2.3.4", device: "iPhone" },
  );
  return { request, doc };
}

function fetchSigned(docId: string): Promise<Response> {
  const path = signedFileUrl(docId);
  const req = new NextRequest(new URL(path, "https://seneschal.test"));
  return GET(req, { params: Promise.resolve({ id: docId }) });
}

describe("archived document access (#55)", () => {
  it("a signed URL minted before the archive stops resolving after it", async () => {
    const { doc } = await uploadedViaPublicLink();

    // baseline: the same signature works while the document is live
    expect((await fetchSigned(doc.id)).status).toBe(200);

    await documents.archiveDocument(W.ctx, doc.id);

    const res = await fetchSigned(doc.id);
    expect(res.status).toBe(404);
    // no bytes, and the refusal is not recorded as a download
    const downloads = await prisma.documentAccessLog.count({
      where: { documentId: doc.id, action: "DOWNLOADED" },
    });
    expect(downloads).toBe(1); // only the pre-archive baseline fetch
  });

  it("archiving is itself access-logged and the row is kept, never deleted", async () => {
    const { doc } = await uploadedViaPublicLink();
    await documents.archiveDocument(W.ctx, doc.id);

    const stored = await prisma.document.findUnique({ where: { id: doc.id } });
    expect(stored).toBeTruthy();
    expect(stored!.archivedAt).toBeTruthy();
    expect(
      await prisma.documentAccessLog.count({ where: { documentId: doc.id, action: "DELETED" } }),
    ).toBe(1);
  });

  it("the service read path refuses an archived document unless it explicitly opts in", async () => {
    const { doc } = await uploadedViaPublicLink();
    await documents.archiveDocument(W.ctx, doc.id);

    await expect(documents.getDocument(W.ctx, doc.id)).rejects.toBeInstanceOf(
      documents.ArchivedDocumentError,
    );
    // the evidence-pack path may still cite it, so the opt-in remains available
    await expect(
      documents.getDocument(W.ctx, doc.id, { includeArchived: true }),
    ).resolves.toMatchObject({ id: doc.id });
    expect(await documents.readDocumentBytes(doc.id)).toBeNull();
  });
});
