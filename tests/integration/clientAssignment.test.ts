import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { authz } from "@/server/authz";
import { assignClient, listAssignmentGrid, revokeClient } from "@/server/services/assignments";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";

// F-Admin Phase 4 (D3) — the people×clients assignment grid IS the delegate's scope. ⛔.
// Every assertion reaches the result through the grid service + authz(), never by hand-setting
// scope, so it proves the ClientAssignment join (not a cached array) drives delegateClientIds.

let W: TestActor; // FIDUCIARY owner: creates clients/properties (data power)
let admin: TestActor; // ORG_ADMIN: wires assignments (people power), holds no data
let clientA = "";
let clientB = "";
let propA = "";
let propB = "";
let agentUserId = "";
let agentMembershipId = "";

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
});

describe("assignment grid drives delegate scope", () => {
  it("ORG_ADMIN (people-power) can assign; FIDUCIARY (data-only) cannot", async () => {
    await expect(
      assignClient(W.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA }),
    ).rejects.toThrow(/lacks/);
    await expect(
      assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA }),
    ).resolves.toBeTruthy();
  });

  it("assign A → delegate reads A, denied B", async () => {
    await assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    const agentCtx = await authz(agentUserId, W.workspaceId);
    const ids = (await properties.listProperties(agentCtx)).map((p) => p.id);
    expect(ids).toContain(propA);
    expect(ids).not.toContain(propB);
  });

  it("revoke → delegate loses A but keeps B (context still builds)", async () => {
    await assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    await assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientB });
    await revokeClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });

    const agentCtx = await authz(agentUserId, W.workspaceId);
    expect(agentCtx.delegateClientIds).toEqual([clientB]);
    const ids = (await properties.listProperties(agentCtx)).map((p) => p.id);
    expect(ids).not.toContain(propA);
    expect(ids).toContain(propB);
  });

  it("revoking the LAST assignment fails the delegate closed (no readable context)", async () => {
    await assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    await revokeClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    await expect(authz(agentUserId, W.workspaceId)).rejects.toThrow(/client scope/);
  });

  it("re-assigning a revoked client does not collide (partial unique allows it)", async () => {
    await assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    await revokeClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    await expect(
      assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA }),
    ).resolves.toBeTruthy();
    const agentCtx = await authz(agentUserId, W.workspaceId);
    expect(agentCtx.delegateClientIds).toEqual([clientA]);
  });

  it("cross-workspace: the service rejects a foreign client, and a forged row never widens scope", async () => {
    const W2 = await makeWorkspace("Other WS");
    const foreign = await clients.createClient(W2.ctx, { displayName: "Foreign" });

    // The grid service refuses to assign a client from another workspace.
    await expect(
      assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: foreign.id }),
    ).rejects.toThrow(/Not found/);

    // And a forged raw row tagged to another workspace is filtered out by the workspace-guarded load.
    await assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    await prisma.clientAssignment.create({
      data: { workspaceId: W2.workspaceId, membershipId: agentMembershipId, clientPrincipalId: foreign.id, assignedById: admin.userId },
    });
    const agentCtx = await authz(agentUserId, W.workspaceId);
    expect(agentCtx.delegateClientIds).toEqual([clientA]);
  });

  it("every toggle writes an AuditEvent", async () => {
    await assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    await revokeClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    const verbs = (
      await prisma.auditEvent.findMany({ where: { workspaceId: W.workspaceId, objectType: "ClientAssignment" } })
    ).map((a) => a.verb);
    expect(verbs).toContain("assignment.create");
    expect(verbs).toContain("assignment.revoke");
  });

  it("listAssignmentGrid reflects the live assignments", async () => {
    await assignClient(admin.ctx, { membershipId: agentMembershipId, clientPrincipalId: clientA });
    const grid = await listAssignmentGrid(admin.ctx);
    expect(grid.delegates.map((d) => d.membershipId)).toContain(agentMembershipId);
    expect(grid.clients.map((c) => c.id).sort()).toEqual([clientA, clientB].sort());
    expect(grid.assignedKeys).toContain(`${agentMembershipId}:${clientA}`);
  });
});
