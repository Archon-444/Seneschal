import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as contacts from "@/server/services/contacts";
import * as passport from "@/server/services/tenantPassport";
import { validateLinkToken } from "@/server/services/secureLinks";

// 1C #7 — Consent-gated passport share. Sharing without consent is refused; with
// consent it writes a ConsentRecord BEFORE the link, records PASSPORT_SHARED, and
// the public view records PASSPORT_VIEWED. Documents are summarised by type only.

let W: TestActor;
let tenant: TestActor;
let contactId: string;

function tokenOf(url: string): string {
  return url.slice(url.lastIndexOf("/") + 1);
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Passport share WS");
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Ricardo Fernandes" });
  contactId = tc.id;
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
  await passport.updateMyPassport(tenant.ctx, { employer: "Emirates", monthlyIncome: 32000, status: "READY" });
  await passport.uploadPassportDocument(tenant.ctx, {
    fileName: "id.png",
    mime: "image/png",
    data: Buffer.from("id"),
    kind: "ID_DOCUMENT",
  });
});

describe("sharePassport", () => {
  it("refuses to share without consent", async () => {
    await expect(passport.sharePassport(tenant.ctx, { consent: false })).rejects.toThrow(/consent/i);
    const consents = await prisma.consentRecord.count({ where: { workspaceId: W.workspaceId } });
    expect(consents).toBe(0);
  });

  it("records consent then PASSPORT_SHARED, and the public view records PASSPORT_VIEWED", async () => {
    const { url } = await passport.sharePassport(tenant.ctx, { consent: true, recipientName: "Agent X" });
    expect(url).toContain("/link/");

    const consent = await prisma.consentRecord.findFirst({
      where: { workspaceId: W.workspaceId, contactId, purpose: "PASSPORT_SHARING", revokedAt: null },
    });
    expect(consent).toBeTruthy();
    const shared = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "PASSPORT_SHARED" },
    });
    expect(shared).toBeTruthy();

    const validation = await validateLinkToken(tokenOf(url));
    if (!validation.ok) throw new Error("link invalid");
    const view = await passport.getPassportForLink(validation.link);
    expect(view).toBeTruthy();
    expect(view!.tenantName).toBe("Ricardo Fernandes");
    expect(view!.employer).toBe("Emirates");
    expect(view!.documentKinds).toContain("ID_DOCUMENT");

    const viewed = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "PASSPORT_VIEWED" },
    });
    expect(viewed).toBeTruthy();
    const link = await prisma.secureLink.findUnique({ where: { id: validation.link.id } });
    expect(link!.useCount).toBe(1);
  });

  it("a non-tenant cannot share a passport", async () => {
    const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
    const landlord = await addMember(W.workspaceId, "LANDLORD", undefined, owner.id);
    await expect(passport.sharePassport(landlord.ctx, { consent: true })).rejects.toThrow(/passport\.share/);
  });
});
