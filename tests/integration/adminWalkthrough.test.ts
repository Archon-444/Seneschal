import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers";
import { authz, hasCapability, type PlatformAdminContext } from "@/server/authz";
import { provisionWorkspace } from "@/server/admin/provisioning";
import { acceptInvite, inviteOrgAdmin } from "@/server/services/members";
import { assignClient } from "@/server/services/assignments";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";

// F-Admin acceptance walkthrough — the capstone. Drives the whole admin lifecycle through the
// real service entrypoints and asserts the scope outcomes + audit chain, not the screens.

describe("admin acceptance walkthrough", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("provision → accept → onboard org-admin → wire a delegate, all scoped and audited", async () => {
    // 1. Platform operator seats the customer's principal (seat-zero). Sets no credential.
    const operator = await prisma.user.create({
      data: { email: "op@seneschal.example", name: "Operator", isPlatformAdmin: true },
    });
    const opCtx: PlatformAdminContext = { kind: "platform", userId: operator.id };
    const { workspaceId, inviteToken } = await provisionWorkspace(opCtx, {
      name: "Crescent Fiduciary",
      type: "FIDUCIARY",
      customerEmail: "principal@crescent.example",
      customerName: "Principal",
    });
    // The operator holds no membership here and cannot build a readable context.
    await expect(authz(operator.id, workspaceId)).rejects.toThrow(/No access/);

    // 2. The principal accepts and now has a readable context — PRINCIPAL (see-all-do-all).
    const { userId: principalId } = await acceptInvite(inviteToken, { confirmEmail: "principal@crescent.example" });
    const principalCtx = await authz(principalId, workspaceId);
    expect(principalCtx.role).toBe("WORKSPACE_ADMIN");
    expect(hasCapability(principalCtx, "tenancies.read")).toBe(true);
    expect(hasCapability(principalCtx, "members.manage")).toBe(true);

    // 3. The principal onboards an office manager (ORG_ADMIN) — people-power, zero data.
    const orgInvite = await inviteOrgAdmin(principalCtx, "office@crescent.example");
    const { userId: officeId } = await acceptInvite(orgInvite.token);
    const officeCtx = await authz(officeId, workspaceId);
    expect(officeCtx.role).toBe("ORG_ADMIN");
    expect(hasCapability(officeCtx, "tenancies.read")).toBe(false);
    expect(hasCapability(officeCtx, "clients.assign")).toBe(true);

    // 4. The principal sets up a client + property + a delegate membership…
    const client = await clients.createClient(principalCtx, { displayName: "Private Client A" });
    const owner = await contacts.createContact(principalCtx, { kind: "OWNER", name: "Owner" });
    const property = await properties.createProperty(principalCtx, {
      clientPrincipalId: client.id,
      ownerContactId: owner.id,
      community: "Marina",
      building: "Tower 1",
      unitNo: "101",
    });
    const agentUser = await prisma.user.create({ data: { email: "agent@crescent.example", name: "Agent" } });
    const agentMembership = await prisma.membership.create({
      data: { workspaceId, userId: agentUser.id, role: "MANAGING_AGENT" },
    });

    // …and the OFFICE MANAGER (no data caps) wires the delegate to the client via the grid.
    await assignClient(officeCtx, { membershipId: agentMembership.id, clientPrincipalId: client.id });

    // 5. The delegate's scope now resolves to exactly that client — proven through the read path.
    const agentCtx = await authz(agentUser.id, workspaceId);
    expect(agentCtx.delegateClientIds).toEqual([client.id]);
    expect((await properties.listProperties(agentCtx)).map((p) => p.id)).toEqual([property.id]);

    // 6. The whole governance chain is in the audit trail.
    const verbs = (await prisma.auditEvent.findMany({ where: { workspaceId } })).map((a) => a.verb);
    expect(verbs).toEqual(
      expect.arrayContaining(["workspace.provision", "invite.issue", "invite.accept", "assignment.create"]),
    );
  });
});
