import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { authz, hasCapability } from "@/server/authz";
import { hashToken } from "@/server/crypto";
import {
  acceptInvite,
  grantBundle,
  inviteOrgAdmin,
  listMembers,
  removeMember,
  revokeBundle,
  revokeInvite,
} from "@/server/services/members";

// F-Admin Phase 3 — in-org member management. ⛔ tests 6, 8, 12.

let W: TestActor; // FIDUCIARY owner (data-only)
let admin: TestActor; // ORG_ADMIN (people-power)

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Members WS");
  admin = await addMember(W.workspaceId, "ORG_ADMIN");
});

describe("people-power, decorrelated", () => {
  it("ORG_ADMIN manages members; data-only FIDUCIARY cannot", async () => {
    await expect(inviteOrgAdmin(admin.ctx, "newadmin@x.example")).resolves.toBeTruthy();
    await expect(inviteOrgAdmin(W.ctx, "x@x.example")).rejects.toThrow(/lacks/);
    await expect(listMembers(W.ctx)).rejects.toThrow(/lacks/);
  });

  it("invite → accept seats an ORG_ADMIN whose context resolves with people-power, no data", async () => {
    const { token } = await inviteOrgAdmin(admin.ctx, "office@x.example");
    const { userId } = await acceptInvite(token, { name: "Office Manager" });

    const ctx = await authz(userId, W.workspaceId);
    expect(ctx.role).toBe("ORG_ADMIN");
    expect(hasCapability(ctx, "members.manage")).toBe(true);
    expect(hasCapability(ctx, "tenancies.read")).toBe(false);
  });

  it("the ORG_ADMIN overlay composes onto another base role without widening scope", async () => {
    const manager = await addMember(W.workspaceId, "MANAGER");
    const managerMembership = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: W.workspaceId, userId: manager.userId },
    });
    await grantBundle(admin.ctx, { membershipId: managerMembership.id, bundle: "ORG_ADMIN" });

    const ctx = await authz(manager.userId, W.workspaceId);
    expect(ctx.grantedBundles).toEqual(["ORG_ADMIN"]);
    expect(hasCapability(ctx, "members.manage")).toBe(true); // gained people-power
    expect(hasCapability(ctx, "tenancies.read")).toBe(true); // kept its own data caps
  });

  it("accepting an org-admin invite for an EXISTING member overlays the grant, not a masking membership", async () => {
    const existing = await addMember(W.workspaceId, "MANAGER");
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: existing.userId } })).email;

    const inv = await inviteOrgAdmin(admin.ctx, email);
    await acceptInvite(inv.token);

    // No second (masking) membership was minted…
    const roles = (
      await prisma.membership.findMany({ where: { workspaceId: W.workspaceId, userId: existing.userId, revokedAt: null } })
    ).map((m) => m.role);
    expect(roles).toEqual(["MANAGER"]);

    // …the people-power arrives as an overlay grant, so the manager KEEPS its data and gains people-power.
    const ctx = await authz(existing.userId, W.workspaceId);
    expect(ctx.role).toBe("MANAGER");
    expect(ctx.grantedBundles).toEqual(["ORG_ADMIN"]);
    expect(hasCapability(ctx, "tenancies.read")).toBe(true);
    expect(hasCapability(ctx, "members.manage")).toBe(true);
  });

  it("accepting an org-admin invite for a NEW email creates a fresh ORG_ADMIN membership", async () => {
    const inv = await inviteOrgAdmin(admin.ctx, "brand-new@x.example");
    const { userId } = await acceptInvite(inv.token);
    const ctx = await authz(userId, W.workspaceId);
    expect(ctx.role).toBe("ORG_ADMIN");
    expect(ctx.grantedBundles).toEqual([]);
  });
});

describe("separation of duties", () => {
  it("cannot grant a bundle to, or remove, your OWN membership", async () => {
    const adminMembership = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: W.workspaceId, userId: admin.userId },
    });
    await expect(grantBundle(admin.ctx, { membershipId: adminMembership.id, bundle: "ORG_ADMIN" })).rejects.toThrow(/your own/);
    await expect(removeMember(admin.ctx, adminMembership.id)).rejects.toThrow(/your own/);
  });

  it("cannot grant a data bundle (PRINCIPAL/DELEGATE/CLIENT_VIEWER) — those would be caps without scope", async () => {
    const member = await addMember(W.workspaceId, "AGENT");
    const m = await prisma.membership.findFirstOrThrow({ where: { workspaceId: W.workspaceId, userId: member.userId } });
    for (const bundle of ["PRINCIPAL", "DELEGATE", "CLIENT_VIEWER"] as const) {
      await expect(grantBundle(admin.ctx, { membershipId: m.id, bundle })).rejects.toThrow(/not grantable/);
    }
  });
});

describe("invite token discipline", () => {
  it("stores only the hash; the raw token verifies against it", async () => {
    const { inviteId, token } = await inviteOrgAdmin(admin.ctx, "h@x.example");
    const invite = await prisma.workspaceInvite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(invite.tokenHash).toBe(hashToken(token));
    expect(invite.tokenHash).not.toBe(token);
  });

  it("rejects expired, revoked, already-used, and email-mismatched accepts", async () => {
    // expired
    const exp = await inviteOrgAdmin(admin.ctx, "exp@x.example");
    await prisma.workspaceInvite.update({ where: { id: exp.inviteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(acceptInvite(exp.token)).rejects.toThrow(/expired/);

    // revoked
    const rev = await inviteOrgAdmin(admin.ctx, "rev@x.example");
    await revokeInvite(admin.ctx, rev.inviteId);
    await expect(acceptInvite(rev.token)).rejects.toThrow(/revoked/);

    // already used
    const used = await inviteOrgAdmin(admin.ctx, "used@x.example");
    await acceptInvite(used.token);
    await expect(acceptInvite(used.token)).rejects.toThrow(/already used/);

    // email mismatch
    const mm = await inviteOrgAdmin(admin.ctx, "right@x.example");
    await expect(acceptInvite(mm.token, { confirmEmail: "wrong@x.example" })).rejects.toThrow(/does not match/);
  });
});

describe("governance audit", () => {
  it("invite/accept/grant/revoke/remove each write an AuditEvent", async () => {
    const { token, inviteId } = await inviteOrgAdmin(admin.ctx, "audit@x.example");
    await acceptInvite(token);
    void inviteId;

    const member = await addMember(W.workspaceId, "MANAGER");
    const m = await prisma.membership.findFirstOrThrow({ where: { workspaceId: W.workspaceId, userId: member.userId } });
    await grantBundle(admin.ctx, { membershipId: m.id, bundle: "ORG_ADMIN" });
    await revokeBundle(admin.ctx, { membershipId: m.id, bundle: "ORG_ADMIN" });
    await removeMember(admin.ctx, m.id);

    const verbs = (await prisma.auditEvent.findMany({ where: { workspaceId: W.workspaceId } })).map((a) => a.verb);
    expect(verbs).toEqual(
      expect.arrayContaining(["invite.issue", "invite.accept", "grant.create", "grant.revoke", "membership.revoke"]),
    );
  });
});
