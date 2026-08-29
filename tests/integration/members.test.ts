import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { authz, hasCapability } from "@/server/authz";
import { hashToken } from "@/server/crypto";
import { loginWithPassword } from "@/server/auth";
import {
  acceptInvite,
  grantBundle,
  inviteMember,
  inviteOrgAdmin,
  listMembers,
  peekInvite,
  removeMember,
  revokeBundle,
  revokeInvite,
} from "@/server/services/members";
import * as contacts from "@/server/services/contacts";
import { homePathFor } from "@/server/auth/request";

// F-Admin Phase 3 — in-org member management. ⛔ tests 6, 8, 12.

const ACCEPT_PASSWORD = "test-passphrase";

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

  it("a data-only member (MANAGER, AGENT) wields no people-power — invite and grant both fail closed", async () => {
    // The first test pins this for FIDUCIARY; generalise to the delegate/agent data roles and to
    // grantBundle (members.manage), so holding data caps can never confer a people-plane verb.
    const target = await addMember(W.workspaceId, "AGENT");
    const targetM = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: W.workspaceId, userId: target.userId },
    });
    for (const role of ["MANAGER", "AGENT"] as const) {
      const member = await addMember(W.workspaceId, role);
      await expect(inviteOrgAdmin(member.ctx, `x-${role.toLowerCase()}@x.example`)).rejects.toThrow(/lacks/);
      await expect(
        grantBundle(member.ctx, { membershipId: targetM.id, bundle: "ORG_ADMIN" }),
      ).rejects.toThrow(/lacks/);
    }
  });

  it("invite → accept seats an ORG_ADMIN whose context resolves with people-power, no data", async () => {
    const { token } = await inviteOrgAdmin(admin.ctx, "office@x.example");
    const { userId } = await acceptInvite(token, { name: "Office Manager", password: ACCEPT_PASSWORD });

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
    await acceptInvite(inv.token, { password: ACCEPT_PASSWORD });

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
    const { userId } = await acceptInvite(inv.token, { password: ACCEPT_PASSWORD });
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
  it("accept requires a password and stores only the hash", async () => {
    const { token } = await inviteOrgAdmin(admin.ctx, "pwd@x.example");
    await expect(acceptInvite(token, { name: "Hashed" })).rejects.toThrow(/Set a password/);
    await expect(acceptInvite(token, { name: "Hashed", password: "short" })).rejects.toThrow(/at least 10/i);

    const { userId } = await acceptInvite(token, { name: "Hashed", password: ACCEPT_PASSWORD });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toContain(ACCEPT_PASSWORD);
    expect(user.passwordSetAt).not.toBeNull();

    const signedIn = await loginWithPassword("pwd@x.example", ACCEPT_PASSWORD);
    expect("sessionToken" in signedIn).toBe(true);
  });

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
    await acceptInvite(used.token, { password: ACCEPT_PASSWORD });
    await expect(acceptInvite(used.token)).rejects.toThrow(/already used/);

    // email mismatch
    const mm = await inviteOrgAdmin(admin.ctx, "right@x.example");
    await expect(acceptInvite(mm.token, { confirmEmail: "wrong@x.example" })).rejects.toThrow(/does not match/);
  });
});

describe("governance audit", () => {
  it("invite/accept/grant/revoke/remove each write an AuditEvent", async () => {
    const { token, inviteId } = await inviteOrgAdmin(admin.ctx, "audit@x.example");
    await acceptInvite(token, { password: ACCEPT_PASSWORD });
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

describe("invite by seat", () => {
  it("refuses seats that are not invited from /members", async () => {
    await expect(inviteMember(admin.ctx, { email: "x@x.example", role: "WORKSPACE_ADMIN" })).rejects.toThrow(
      /not invited/,
    );
    await expect(inviteMember(admin.ctx, { email: "x@x.example", role: "FIDUCIARY" })).rejects.toThrow(/not invited/);
    await expect(inviteMember(admin.ctx, { email: "x@x.example", role: "LANDLORD" })).rejects.toThrow(
      /owner contact/,
    );
  });

  it("allows only one live invite per workspace+email", async () => {
    await inviteMember(admin.ctx, { email: "once@x.example", role: "MANAGER" });
    await expect(inviteMember(admin.ctx, { email: "once@x.example", role: "ORG_ADMIN" })).rejects.toThrow(
      /already outstanding/,
    );
  });

  it("seats staff (MANAGER) on accept — not a second fiduciary invite", async () => {
    const { token } = await inviteMember(admin.ctx, { email: "staff@x.example", role: "MANAGER" });
    const invite = await prisma.workspaceInvite.findFirstOrThrow({ where: { email: "staff@x.example" } });
    expect(invite.intendedRole).toBe("MANAGER");
    expect(invite.intendedBundles).toEqual([]);

    const { userId } = await acceptInvite(token, { name: "Staffer", password: ACCEPT_PASSWORD });
    const ctx = await authz(userId, W.workspaceId);
    expect(ctx.role).toBe("MANAGER");
    expect(hasCapability(ctx, "tenancies.read")).toBe(true);
    expect(hasCapability(ctx, "members.manage")).toBe(false);

    const listed = await listMembers(admin.ctx);
    expect(listed.members.some((m) => m.email === "staff@x.example" && m.seatLabel === "Staff")).toBe(true);
  });

  it("seats an agent with an empty book that can build a login context", async () => {
    const { token } = await inviteMember(admin.ctx, { email: "agent-seat@x.example", role: "MANAGING_AGENT" });
    const { userId } = await acceptInvite(token, { name: "Agent", password: ACCEPT_PASSWORD });
    const membership = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: W.workspaceId, userId, revokedAt: null },
    });
    expect(membership.role).toBe("MANAGING_AGENT");
    const ctx = await authz(userId, W.workspaceId);
    expect(ctx.role).toBe("MANAGING_AGENT");
    expect(ctx.delegatePropertyIds).toEqual([]);
  });

  it("refuses a staff invite for an email that is already a member", async () => {
    const existing = await addMember(W.workspaceId, "MANAGER");
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: existing.userId } })).email;
    await expect(inviteMember(admin.ctx, { email, role: "MANAGER" })).rejects.toThrow(/already a member/);
  });
});

describe("owner invite (agency only)", () => {
  async function ownerContact() {
    return contacts.createContact(W.ctx, {
      kind: "OWNER",
      name: "Karim Mansour",
      email: "karim.mansour@test.example",
    });
  }

  it("lists OWNER contacts for the invite form, marking seated ones taken", async () => {
    const free = await ownerContact();
    const seatedContact = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Already Seated" });
    await addMember(W.workspaceId, "LANDLORD", undefined, seatedContact.id);

    const listed = await listMembers(admin.ctx);
    expect(listed.workspaceType).toBe("FIDUCIARY");
    expect(listed.seats.some((s) => s.role === "LANDLORD")).toBe(true);
    expect(listed.canRecordContacts).toBe(false); // office admin: people-power, no contacts.write
    const byId = Object.fromEntries(listed.ownerContacts.map((c) => [c.id, c]));
    expect(byId[free.id]?.taken).toBe(false);
    expect(byId[seatedContact.id]?.taken).toBe(true);
  });

  it("seats LANDLORD bound to the OWNER contact; accept builds a portal context", async () => {
    const contact = await ownerContact();
    const { token, inviteId } = await inviteMember(admin.ctx, {
      email: "karim.owner@test.example",
      role: "LANDLORD",
      subjectContactId: contact.id,
    });
    const invite = await prisma.workspaceInvite.findUniqueOrThrow({ where: { id: inviteId } });
    expect(invite.intendedRole).toBe("LANDLORD");
    expect(invite.subjectContactId).toBe(contact.id);
    expect(invite.intendedBundles).toEqual([]);

    const preview = await peekInvite(token);
    expect(preview?.ownerContactName).toBe("Karim Mansour");
    expect(preview?.intendedRole).toBe("LANDLORD");

    const { userId } = await acceptInvite(token, { name: "Karim Mansour", password: ACCEPT_PASSWORD });
    const membership = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: W.workspaceId, userId, revokedAt: null },
    });
    expect(membership.role).toBe("LANDLORD");
    expect(membership.subjectContactId).toBe(contact.id);

    const ctx = await authz(userId, W.workspaceId);
    expect(ctx.role).toBe("LANDLORD");
    expect(ctx.subjectContactId).toBe(contact.id);
    expect(homePathFor(ctx.role)).toBe("/portal");
    expect(hasCapability(ctx, "properties.read")).toBe(true);
    expect(hasCapability(ctx, "members.invite")).toBe(false);
  });

  it("refuses a landlord-licence workspace, a missing/forged contact, and a second seat on the same owner", async () => {
    const contact = await ownerContact();
    const landlordWs = await makeWorkspace("Landlord licence", { type: "OWNER", role: "WORKSPACE_ADMIN" });
    const landlordAdmin = await addMember(landlordWs.workspaceId, "ORG_ADMIN");
    const landlordContact = await contacts.createContact(landlordWs.ctx, { kind: "OWNER", name: "Self" });
    await expect(
      inviteMember(landlordAdmin.ctx, {
        email: "owner.seat@test.example",
        role: "LANDLORD",
        subjectContactId: landlordContact.id,
      }),
    ).rejects.toThrow(/agency workspace/);

    const listed = await listMembers(landlordAdmin.ctx);
    expect(listed.seats.some((s) => s.role === "LANDLORD")).toBe(false);
    expect(listed.ownerContacts).toEqual([]);

    await expect(
      inviteMember(admin.ctx, { email: "x@x.example", role: "MANAGER", subjectContactId: contact.id }),
    ).rejects.toThrow(/not bound to a contact/);

    await expect(
      inviteMember(admin.ctx, { email: "forged@x.example", role: "LANDLORD", subjectContactId: landlordContact.id }),
    ).rejects.toThrow(/Not found/);

    const tenant = await contacts.createContact(W.ctx, { kind: "TENANT", name: "A Tenant" });
    await expect(
      inviteMember(admin.ctx, { email: "tenant-as-owner@x.example", role: "LANDLORD", subjectContactId: tenant.id }),
    ).rejects.toThrow(/Not found/);

    await inviteMember(admin.ctx, {
      email: "first@x.example",
      role: "LANDLORD",
      subjectContactId: contact.id,
    });
    await expect(
      inviteMember(admin.ctx, { email: "second@x.example", role: "LANDLORD", subjectContactId: contact.id }),
    ).rejects.toThrow(/already outstanding for that owner/);
  });

  it("refuses a second live LANDLORD membership on the same contact", async () => {
    const contact = await ownerContact();
    await addMember(W.workspaceId, "LANDLORD", undefined, contact.id);
    await expect(
      inviteMember(admin.ctx, { email: "dup@x.example", role: "LANDLORD", subjectContactId: contact.id }),
    ).rejects.toThrow(/already has a member seat/);
  });

  it("reactivates a removed owner when the same email is reinvited for that contact", async () => {
    const contact = await ownerContact();
    const { token } = await inviteMember(admin.ctx, {
      email: "karim.rejoin@test.example",
      role: "LANDLORD",
      subjectContactId: contact.id,
    });
    const { userId } = await acceptInvite(token, { name: "Karim Mansour", password: ACCEPT_PASSWORD });
    const first = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: W.workspaceId, userId, role: "LANDLORD" },
    });
    await removeMember(admin.ctx, first.id);

    const again = await inviteMember(admin.ctx, {
      email: "karim.rejoin@test.example",
      role: "LANDLORD",
      subjectContactId: contact.id,
    });
    const accepted = await acceptInvite(again.token, { password: ACCEPT_PASSWORD });
    expect(accepted.userId).toBe(userId);

    const rows = await prisma.membership.findMany({
      where: { workspaceId: W.workspaceId, userId, role: "LANDLORD" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].revokedAt).toBeNull();
    expect(rows[0].subjectContactId).toBe(contact.id);

    const ctx = await authz(userId, W.workspaceId);
    expect(ctx.role).toBe("LANDLORD");
    expect(ctx.subjectContactId).toBe(contact.id);
    expect(homePathFor(ctx.role)).toBe("/portal");
  });
});

describe("reinvite after remove", () => {
  it("reactivates a removed staff membership instead of inserting a second row", async () => {
    const { token } = await inviteMember(admin.ctx, { email: "staff.rejoin@x.example", role: "MANAGER" });
    const { userId } = await acceptInvite(token, { name: "Staff", password: ACCEPT_PASSWORD });
    const first = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: W.workspaceId, userId, role: "MANAGER" },
    });
    await removeMember(admin.ctx, first.id);

    const again = await inviteMember(admin.ctx, { email: "staff.rejoin@x.example", role: "MANAGER" });
    await acceptInvite(again.token, { password: ACCEPT_PASSWORD });

    const rows = await prisma.membership.findMany({
      where: { workspaceId: W.workspaceId, userId, role: "MANAGER" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first.id);
    expect(rows[0].revokedAt).toBeNull();

    const ctx = await authz(userId, W.workspaceId);
    expect(ctx.role).toBe("MANAGER");
  });
});
