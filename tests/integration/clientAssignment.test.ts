import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { authz } from "@/server/authz";
import { assignProperty, listAssignmentGrid, revokeProperty } from "@/server/services/assignments";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";

// Agent book — the people×properties grid IS the delegate's scope. ⛔
// Every assertion reaches the result through the grid service + authz(), never by hand-setting
// scope, so it proves the PropertyAssignment join drives delegatePropertyIds.

let W: TestActor;
let admin: TestActor;
let clientA = "";
let clientB = "";
let propA = "";
let propB = "";
let agentUserId = "";
let agentMembershipId = "";
let agent2UserId = "";
let agent2MembershipId = "";

async function clientWithProperty(label: string): Promise<{ clientId: string; propertyId: string }> {
  const client = await clients.createClient(W.ctx, { displayName: `${label} Co` });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: `${label} Owner` });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: owner.id,
    community: `Community ${label}`,
    building: `Tower ${label}`,
    unitNo: "101",
  });
  return { clientId: client.id, propertyId: property.id };
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Assignment WS");
  admin = await addMember(W.workspaceId, "ORG_ADMIN");
  ({ clientId: clientA, propertyId: propA } = await clientWithProperty("A"));
  ({ clientId: clientB, propertyId: propB } = await clientWithProperty("B"));
  const agent = await prisma.user.create({ data: { email: `${randomUUID()}@t.test`, name: "Agent" } });
  agentUserId = agent.id;
  const m = await prisma.membership.create({
    data: { workspaceId: W.workspaceId, userId: agent.id, role: "MANAGING_AGENT" },
  });
  agentMembershipId = m.id;
  const agent2 = await prisma.user.create({ data: { email: `${randomUUID()}@t.test`, name: "Agent Two" } });
  agent2UserId = agent2.id;
  const m2 = await prisma.membership.create({
    data: { workspaceId: W.workspaceId, userId: agent2.id, role: "MANAGING_AGENT" },
  });
  agent2MembershipId = m2.id;
});

describe("assignment grid drives delegate scope", () => {
  it("ORG_ADMIN (people-power) can assign; FIDUCIARY (data-only) cannot", async () => {
    await expect(assignProperty(W.ctx, { membershipId: agentMembershipId, propertyId: propA })).rejects.toThrow(/lacks/);
    await expect(
      assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA }),
    ).resolves.toBeTruthy();
  });

  it("assign A → delegate reads A, denied B", async () => {
    await assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    const agentCtx = await authz(agentUserId, W.workspaceId);
    const ids = (await properties.listProperties(agentCtx)).map((p) => p.id);
    expect(ids).toContain(propA);
    expect(ids).not.toContain(propB);
  });

  it("revoke → delegate loses A but keeps B (empty is not a logout)", async () => {
    await assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    await assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propB });
    await revokeProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });

    const agentCtx = await authz(agentUserId, W.workspaceId);
    expect(agentCtx.delegatePropertyIds).toEqual([propB]);
    const ids = (await properties.listProperties(agentCtx)).map((p) => p.id);
    expect(ids).not.toContain(propA);
    expect(ids).toContain(propB);
  });

  it("revoking the LAST assignment leaves an empty book (login OK, lists empty)", async () => {
    await assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    await revokeProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    const agentCtx = await authz(agentUserId, W.workspaceId);
    expect(agentCtx.delegatePropertyIds).toEqual([]);
    expect(await properties.listProperties(agentCtx)).toEqual([]);
  });

  it("one responsible member per property — a second agent is refused", async () => {
    await assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    await expect(
      assignProperty(admin.ctx, { membershipId: agent2MembershipId, propertyId: propA }),
    ).rejects.toThrow(/already has a responsible agent/);
    const ctx2 = await authz(agent2UserId, W.workspaceId);
    expect(ctx2.delegatePropertyIds).toEqual([]);
  });

  it("re-assigning a revoked property does not collide (partial unique allows it)", async () => {
    await assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    await revokeProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    await expect(
      assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA }),
    ).resolves.toBeTruthy();
    const agentCtx = await authz(agentUserId, W.workspaceId);
    expect(agentCtx.delegatePropertyIds).toEqual([propA]);
  });

  it("cross-workspace: the service rejects a foreign property, and a forged row never widens scope", async () => {
    const W2 = await makeWorkspace("Other WS");
    const client = await clients.createClient(W2.ctx, { displayName: "Foreign" });
    const owner = await contacts.createContact(W2.ctx, { kind: "OWNER", name: "Foreign Owner" });
    const foreign = await properties.createProperty(W2.ctx, {
      clientPrincipalId: client.id,
      ownerContactId: owner.id,
      community: "Foreign",
      building: "X",
      unitNo: "1",
    });

    await expect(
      assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: foreign.id }),
    ).rejects.toThrow(/Not found/);

    await assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    await prisma.propertyAssignment.create({
      data: {
        workspaceId: W2.workspaceId,
        membershipId: agentMembershipId,
        propertyId: foreign.id,
        assignedById: admin.userId,
      },
    });
    const agentCtx = await authz(agentUserId, W.workspaceId);
    expect(agentCtx.delegatePropertyIds).toEqual([propA]);
  });

  it("every toggle writes an AuditEvent", async () => {
    await assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    await revokeProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    const verbs = (
      await prisma.auditEvent.findMany({ where: { workspaceId: W.workspaceId, objectType: "PropertyAssignment" } })
    ).map((a) => a.verb);
    expect(verbs).toContain("assignment.create");
    expect(verbs).toContain("assignment.revoke");
  });

  it("listAssignmentGrid reflects the live assignments", async () => {
    await assignProperty(admin.ctx, { membershipId: agentMembershipId, propertyId: propA });
    const grid = await listAssignmentGrid(admin.ctx);
    expect(grid.delegates.map((d) => d.membershipId)).toContain(agentMembershipId);
    expect(grid.properties.map((p) => p.id).sort()).toEqual([propA, propB].sort());
    expect(grid.assignedKeys).toContain(`${agentMembershipId}:${propA}`);
  });
});
