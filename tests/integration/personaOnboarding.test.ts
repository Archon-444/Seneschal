import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as contacts from "@/server/services/contacts";
import { staffCreateMembership } from "@/server/services/admin";
import { authz } from "@/server/authz";

// Codex P2 regression: the production membership helper must accept and persist
// subjectContactId, so a TENANT/LANDLORD persona can actually be onboarded through
// the service (otherwise authz() later throws "missing contact scope").

let W: TestActor;
let staff: { id: string; isPlatformAdmin: boolean };

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Onboarding WS");
  staff = await prisma.user.create({
    data: { email: `staff-${Date.now()}@test.example`, name: "Operator", isPlatformAdmin: true },
  });
});

describe("staffCreateMembership for personas", () => {
  it("persists subjectContactId and authz() resolves the persona context", async () => {
    const contact = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Onboarded Tenant" });
    const user = await prisma.user.create({ data: { email: `t-${Date.now()}@test.example`, name: "Tenant User" } });

    const membership = await staffCreateMembership(staff as never, {
      workspaceId: W.workspaceId, userId: user.id, role: "TENANT", subjectContactId: contact.id,
    });
    expect(membership.subjectContactId).toBe(contact.id);

    const ctx = await authz(user.id, W.workspaceId);
    expect(ctx.role).toBe("TENANT");
    expect(ctx.subjectContactId).toBe(contact.id);
  });

  it("refuses to create a persona membership without a contact scope", async () => {
    const user = await prisma.user.create({ data: { email: `l-${Date.now()}@test.example`, name: "LL User" } });
    await expect(
      staffCreateMembership(staff as never, { workspaceId: W.workspaceId, userId: user.id, role: "LANDLORD" }),
    ).rejects.toThrow(/subjectContactId/);
  });
});
