import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, resetDb, type TestActor } from "../helpers";
import * as contacts from "@/server/services/contacts";
import * as passport from "@/server/services/tenantPassport";

// 1C #6 — Passport documents. TENANT no longer holds passport.write
// (pilot role shrink); upload stays capability-gated.

let W: TestActor;
let tenant: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Passport docs WS");
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Own Tenant" });
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
});

describe("passport documents", () => {
  it("TENANT cannot upload a passport document", async () => {
    await expect(
      passport.uploadPassportDocument(tenant.ctx, {
        fileName: "emirates-id.png",
        mime: "image/png",
        data: Buffer.from("id-bytes"),
        kind: "ID_DOCUMENT",
      }),
    ).rejects.toThrow(/passport\.write/);
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
