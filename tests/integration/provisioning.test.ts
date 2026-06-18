import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers";
import { authz, type PlatformAdminContext } from "@/server/authz";
import { hashToken } from "@/server/crypto";
import {
  archiveWorkspace,
  attachPlan,
  provisionWorkspace,
  suspendWorkspace,
  unsuspendWorkspace,
} from "@/server/admin/provisioning";

// F-Admin Phase 2 — platform provisioning (seat-zero). ⛔ tests 8, 9, 12.

let ctx: PlatformAdminContext;

beforeEach(async () => {
  await resetDb();
  const operator = await prisma.user.create({
    data: { email: `op-${Date.now()}@seneschal.example`, name: "Operator", isPlatformAdmin: true },
  });
  ctx = { kind: "platform", userId: operator.id };
});

describe("seat-zero provisioning", () => {
  it("creates Workspace + {PRINCIPAL} membership + hashed invite, sets no credential, leaves it empty (§8.9)", async () => {
    const result = await provisionWorkspace(ctx, {
      name: "Acme Fiduciary",
      type: "FIDUCIARY",
      customerEmail: "principal@acme.example",
      customerName: "Acme Principal",
    });

    // Workspace exists.
    const ws = await prisma.workspace.findUnique({ where: { id: result.workspaceId } });
    expect(ws?.name).toBe("Acme Fiduciary");

    // The customer's first user is seated as PRINCIPAL (WORKSPACE_ADMIN base shape).
    const user = await prisma.user.findUnique({ where: { email: "principal@acme.example" } });
    const membership = await prisma.membership.findFirst({ where: { workspaceId: result.workspaceId, userId: user!.id } });
    expect(membership?.role).toBe("WORKSPACE_ADMIN");

    // The operator set NO credential — the invited user has no session yet.
    expect(await prisma.session.count({ where: { userId: user!.id } })).toBe(0);

    // Only the token HASH is stored; the raw token is the one returned, never persisted.
    const invite = await prisma.workspaceInvite.findUnique({ where: { id: result.inviteId } });
    expect(invite!.tokenHash).toBe(hashToken(result.inviteToken));
    expect(invite!.tokenHash).not.toBe(result.inviteToken);
    expect(invite!.platformIssued).toBe(true);
    expect(invite!.invitedById).toBeNull();
    expect(invite!.intendedBundles).toEqual(["PRINCIPAL"]);
    expect(invite!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Empty at provision: zero confidential rows exist at the moment the operator touched it.
    for (const n of await Promise.all([
      prisma.property.count({ where: { workspaceId: result.workspaceId } }),
      prisma.tenancy.count({ where: { workspaceId: result.workspaceId } }),
      prisma.document.count({ where: { workspaceId: result.workspaceId } }),
      prisma.contact.count({ where: { workspaceId: result.workspaceId } }),
      prisma.clientPrincipal.count({ where: { workspaceId: result.workspaceId } }),
    ])) {
      expect(n).toBe(0);
    }
  });

  it("audits provision and invite with operator actor + on-behalf-of (§8.8)", async () => {
    const result = await provisionWorkspace(ctx, {
      name: "Beta", type: "OWNER", customerEmail: "p@beta.example", customerName: "Beta P",
    });
    const audits = await prisma.auditEvent.findMany({ where: { workspaceId: result.workspaceId } });
    const provision = audits.find((a) => a.verb === "workspace.provision");
    expect(provision?.actorId).toBe(ctx.userId);
    expect(provision?.actorType).toBe("STAFF");
    const user = await prisma.user.findUnique({ where: { email: "p@beta.example" } });
    expect(provision?.onBehalfOfId).toBe(user!.id);
    expect(audits.map((a) => a.verb)).toContain("invite.issue");
  });

  it("attaches a plan and surfaces it as subscription status", async () => {
    await prisma.plan.create({ data: { code: "fiduciary_client_pack_v1", name: "Fiduciary Pack", features: {}, limits: {} } });
    const result = await provisionWorkspace(ctx, {
      name: "Gamma", type: "FIDUCIARY", customerEmail: "p@gamma.example", customerName: "Gamma P",
      planCode: "fiduciary_client_pack_v1",
    });
    const sub = await prisma.subscription.findFirst({ where: { workspaceId: result.workspaceId } });
    expect(sub?.status).toBe("active");
  });

  it("an unknown plan code rolls back — no orphaned workspace, user, or invite (transactional)", async () => {
    const before = await prisma.workspace.count();
    await expect(
      provisionWorkspace(ctx, {
        name: "Orphan", type: "FIDUCIARY", customerEmail: "o@orphan.example", customerName: "O", planCode: "nope",
      }),
    ).rejects.toThrow(/unknown plan/i);
    // Nothing committed: validating the plan before the transaction prevents the orphan a retry would duplicate.
    expect(await prisma.workspace.count()).toBe(before);
    expect(await prisma.workspaceInvite.count({ where: { email: "o@orphan.example" } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { email: "o@orphan.example" } })).toBeNull();
  });
});

describe("workspace lifecycle", () => {
  it("suspends, unsuspends, and archives — each audited", async () => {
    const { workspaceId } = await provisionWorkspace(ctx, {
      name: "Delta", type: "OWNER", customerEmail: "p@delta.example", customerName: "Delta P",
    });

    await suspendWorkspace(ctx, workspaceId);
    expect((await prisma.workspace.findUnique({ where: { id: workspaceId } }))!.suspendedAt).not.toBeNull();

    await unsuspendWorkspace(ctx, workspaceId);
    expect((await prisma.workspace.findUnique({ where: { id: workspaceId } }))!.suspendedAt).toBeNull();

    await archiveWorkspace(ctx, workspaceId);
    expect((await prisma.workspace.findUnique({ where: { id: workspaceId } }))!.archivedAt).not.toBeNull();

    const verbs = (await prisma.auditEvent.findMany({ where: { workspaceId } })).map((a) => a.verb);
    expect(verbs).toEqual(expect.arrayContaining(["workspace.suspend", "workspace.unsuspend", "workspace.archive"]));
  });

  it("a suspended or archived workspace denies its members a context (enforcement, not cosmetic)", async () => {
    const { workspaceId } = await provisionWorkspace(ctx, {
      name: "Enforce", type: "FIDUCIARY", customerEmail: "p@enforce.example", customerName: "P",
    });
    const principal = await prisma.user.findUniqueOrThrow({ where: { email: "p@enforce.example" } });

    // Active → the principal's context resolves.
    await expect(authz(principal.id, workspaceId)).resolves.toMatchObject({ role: "WORKSPACE_ADMIN" });

    // Suspended → denied; restored on unsuspend.
    await suspendWorkspace(ctx, workspaceId);
    await expect(authz(principal.id, workspaceId)).rejects.toThrow(/suspended/i);
    await unsuspendWorkspace(ctx, workspaceId);
    await expect(authz(principal.id, workspaceId)).resolves.toBeTruthy();

    // Archived → denied (terminal).
    await archiveWorkspace(ctx, workspaceId);
    await expect(authz(principal.id, workspaceId)).rejects.toThrow(/archived/i);
  });

  it("rejects lifecycle ops on an unknown workspace", async () => {
    await expect(suspendWorkspace(ctx, "does-not-exist")).rejects.toThrow(/not found/i);
    await expect(attachPlan(ctx, "x", "nope")).rejects.toThrow();
  });
});
