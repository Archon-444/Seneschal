import type { Bundle } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_ } from "../authz";
import { recordAudit } from "../audit";
import { generateToken, hashToken } from "../crypto";

// In-org member management (F-Admin §4.1). The people view behind members.read|invite|manage:
// invite by hashed-token, overlay/revoke the ORG_ADMIN people-power bundle, remove. Every act is
// audited. Held by PRINCIPAL (WORKSPACE_ADMIN) and ORG_ADMIN; a data-only FIDUCIARY does not.
//
// SAFETY INVARIANT (capability ∪ scope): a granted DATA bundle (PRINCIPAL/DELEGATE/CLIENT_VIEWER)
// would confer data CAPS while scope(ctx) — which only narrows for the delegate/persona/client-
// viewer ROLES — leaves the read workspace-wide: a leak. So the only grantable overlay here is
// ORG_ADMIN (people/config power, reads no row). Data shapes come from the base role: PRINCIPAL
// via platform seat-zero, DELEGATE via a MANAGING_AGENT membership + the assignment grid.

const INVITE_TTL_DAYS = 14;
const GRANTABLE_BUNDLES: Bundle[] = ["ORG_ADMIN"];

function actor(ctx: AuthzContext, onBehalfOfId?: string) {
  return {
    workspaceId: ctx.workspaceId,
    actorType: (ctx.isStaff ? "STAFF" : "USER") as "STAFF" | "USER",
    actorId: ctx.userId,
    onBehalfOfId,
  };
}

export async function listMembers(ctx: AuthzContext) {
  require_(ctx, "members.read");
  const [memberships, invites] = await Promise.all([
    prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId, revokedAt: null },
      select: {
        id: true,
        userId: true,
        role: true,
        user: { select: { name: true, email: true } },
        grants: { where: { revokedAt: null }, select: { bundle: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.workspaceInvite.findMany({
      where: { workspaceId: ctx.workspaceId, acceptedAt: null, revokedAt: null },
      select: { id: true, email: true, intendedBundles: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    members: memberships.map((m) => ({
      membershipId: m.id,
      role: m.role,
      name: m.user.name,
      email: m.user.email,
      bundles: m.grants.map((g) => g.bundle),
      isSelf: m.userId === ctx.userId,
    })),
    invites,
  };
}

/** Invite an office manager (ORG_ADMIN) by email. Only the token hash is stored. */
export async function inviteOrgAdmin(
  ctx: AuthzContext,
  email: string,
): Promise<{ inviteId: string; token: string; url: string }> {
  require_(ctx, "members.invite");
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new AuthzError("Email required", 422);

  const { token, tokenHash } = generateToken();
  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId: ctx.workspaceId,
      email: normalized,
      intendedBundles: ["ORG_ADMIN"],
      tokenHash,
      invitedById: ctx.userId,
      platformIssued: false,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  await recordAudit({ ...actor(ctx), verb: "invite.issue", objectType: "WorkspaceInvite", objectId: invite.id });
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return { inviteId: invite.id, token, url: `${base}/invite/${token}` };
}

export async function revokeInvite(ctx: AuthzContext, inviteId: string): Promise<void> {
  require_(ctx, "members.manage");
  const invite = await prisma.workspaceInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  await prisma.workspaceInvite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
  await recordAudit({ ...actor(ctx), verb: "invite.revoke", objectType: "WorkspaceInvite", objectId: inviteId });
}

/**
 * Public accept (no AuthzContext — the invitee is not yet signed in). Validates the token,
 * creates the membership for in-org invites (seat-zero memberships already exist), and marks the
 * invite used. The invitee sets their own auth (email OTP) on first login — no secret is set here.
 */
export async function acceptInvite(
  token: string,
  opts?: { name?: string; confirmEmail?: string },
): Promise<{ workspaceId: string; userId: string }> {
  const invite = await prisma.workspaceInvite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite) throw new AuthzError("Invalid invite", 404);
  if (invite.revokedAt) throw new AuthzError("This invite was revoked", 410);
  if (invite.acceptedAt) throw new AuthzError("This invite was already used", 410);
  if (invite.expiresAt.getTime() < Date.now()) throw new AuthzError("This invite has expired", 410);
  if (opts?.confirmEmail && opts.confirmEmail.trim().toLowerCase() !== invite.email) {
    throw new AuthzError("That email does not match this invite", 403);
  }

  // Never overwrite an existing account — upsert by the invited email, create if new.
  const user = await prisma.user.upsert({
    where: { email: invite.email },
    update: opts?.name ? { name: opts.name } : {},
    create: { email: invite.email, name: opts?.name ?? invite.email },
  });

  if (!invite.platformIssued) {
    if (!invite.intendedBundles.includes("ORG_ADMIN")) {
      throw new AuthzError("Unsupported invite", 422);
    }
    await prisma.membership.upsert({
      where: { workspaceId_userId_role: { workspaceId: invite.workspaceId, userId: user.id, role: "ORG_ADMIN" } },
      update: { revokedAt: null },
      create: { workspaceId: invite.workspaceId, userId: user.id, role: "ORG_ADMIN" },
    });
  }

  await prisma.workspaceInvite.update({
    where: { id: invite.id },
    data: { acceptedAt: new Date(), acceptedUserId: user.id },
  });
  await recordAudit({
    workspaceId: invite.workspaceId,
    actorType: "USER",
    actorId: user.id,
    verb: "invite.accept",
    objectType: "WorkspaceInvite",
    objectId: invite.id,
  });
  return { workspaceId: invite.workspaceId, userId: user.id };
}

/** Public, read-only invite preview for the accept screen (the token is the secret that authorises it). */
export async function peekInvite(
  token: string,
): Promise<{ email: string; workspaceName: string; valid: boolean } | null> {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { email: true, expiresAt: true, acceptedAt: true, revokedAt: true, workspaceId: true },
  });
  if (!invite) return null;
  const ws = await prisma.workspace.findUnique({ where: { id: invite.workspaceId }, select: { name: true } });
  const valid = !invite.acceptedAt && !invite.revokedAt && invite.expiresAt.getTime() > Date.now();
  return { email: invite.email, workspaceName: ws?.name ?? "", valid };
}

/** Overlay the ORG_ADMIN people-power bundle on an existing member (e.g. a delegate who also runs onboarding). */
export async function grantBundle(ctx: AuthzContext, args: { membershipId: string; bundle: Bundle }) {
  require_(ctx, "members.manage");
  if (!GRANTABLE_BUNDLES.includes(args.bundle)) {
    throw new AuthzError(
      `${args.bundle} is not grantable here — PRINCIPAL is platform seat-zero only; DELEGATE/CLIENT_VIEWER data scope comes from the base role`,
      422,
    );
  }
  const target = await prisma.membership.findUnique({
    where: { id: args.membershipId },
    select: { id: true, workspaceId: true, userId: true, revokedAt: true },
  });
  if (!target || target.workspaceId !== ctx.workspaceId || target.revokedAt) throw new AuthzError("Not found", 404);
  // Separation of duties: never elevate your OWN membership.
  if (target.userId === ctx.userId) throw new AuthzError("You cannot grant a bundle to your own membership", 403);

  const existing = await prisma.membershipGrant.findFirst({
    where: { membershipId: target.id, bundle: args.bundle, revokedAt: null },
  });
  if (existing) return existing;
  const grant = await prisma.membershipGrant.create({
    data: { membershipId: target.id, bundle: args.bundle, grantedById: ctx.userId },
  });
  await recordAudit({ ...actor(ctx, target.userId), verb: "grant.create", objectType: "MembershipGrant", objectId: grant.id });
  return grant;
}

export async function revokeBundle(ctx: AuthzContext, args: { membershipId: string; bundle: Bundle }) {
  require_(ctx, "members.manage");
  const live = await prisma.membershipGrant.findFirst({
    where: { membershipId: args.membershipId, bundle: args.bundle, revokedAt: null, membership: { workspaceId: ctx.workspaceId } },
    select: { id: true, membership: { select: { userId: true } } },
  });
  if (!live) return null;
  const grant = await prisma.membershipGrant.update({
    where: { id: live.id },
    data: { revokedAt: new Date(), revokedById: ctx.userId },
  });
  await recordAudit({ ...actor(ctx, live.membership.userId), verb: "grant.revoke", objectType: "MembershipGrant", objectId: grant.id });
  return grant;
}

export async function removeMember(ctx: AuthzContext, membershipId: string): Promise<void> {
  require_(ctx, "members.manage");
  const target = await prisma.membership.findUnique({
    where: { id: membershipId },
    select: { id: true, workspaceId: true, userId: true },
  });
  if (!target || target.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  if (target.userId === ctx.userId) throw new AuthzError("You cannot remove your own membership", 403);
  await prisma.membership.update({ where: { id: membershipId }, data: { revokedAt: new Date() } });
  await recordAudit({ ...actor(ctx, target.userId), verb: "membership.revoke", objectType: "Membership", objectId: membershipId });
}
