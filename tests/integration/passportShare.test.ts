import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, resetDb, type TestActor } from "../helpers";
import * as contacts from "@/server/services/contacts";
import * as passport from "@/server/services/tenantPassport";

// 1C #7 — Consent-gated passport share. TENANT no longer holds passport.share
// (pilot role shrink); the share path stays capability-gated.

let W: TestActor;
let tenant: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Passport share WS");
  const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Ricardo Fernandes" });
  tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
});

describe("sharePassport", () => {
  it("TENANT cannot share a passport", async () => {
    await expect(passport.sharePassport(tenant.ctx, { consent: false })).rejects.toThrow(/passport\.share/);
    await expect(passport.sharePassport(tenant.ctx, { consent: true, recipientName: "Agent X" })).rejects.toThrow(
      /passport\.share/,
    );
  });

  it("a non-tenant cannot share a passport", async () => {
    const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
    const landlord = await addMember(W.workspaceId, "LANDLORD", undefined, owner.id);
    await expect(passport.sharePassport(landlord.ctx, { consent: true })).rejects.toThrow(/passport\.share/);
  });
});
