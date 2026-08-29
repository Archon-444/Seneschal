import type { Bundle, Role } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, hasCapability, pickMembership, require_ } from "../authz";
import { GRANT_HONORED_BUNDLES } from "../capabilities";
import { recordAudit } from "../audit";
import { generateToken, hashPassword, hashToken, PasswordPolicyError } from "../crypto";
import {
  inviteableSeatsFor,
  inviteSeatCopyFor,
  isInviteableSeat,
  memberSeatLabel,
  ROLE_SEAT_LABEL,
  type InviteableSeat,
  type OwnerInviteContact,
} from "@/lib/seats";

// In-org member management (F-Admin §4.1). The people view behind members.read|invite|manage:
// invite by hashed-token, overlay/revoke the ORG_ADMIN people-power bundle, remove. Every act is
// audited. Held by PRINCIPAL (WORKSPACE_ADMIN) and ORG_ADMIN; a data-only FIDUCIARY does not.
//
// SAFETY INVARIANT (capability ∪ scope): a granted DATA bundle (PRINCIPAL/DELEGATE/CLIENT_VIEWER)
// would confer data CAPS while scope(ctx) — which only narrows for the delegate/persona/client-
// viewer ROLES — leaves the read workspace-wide: a leak. So the only grantable overlay is the
// people-power ORG_ADMIN. This is layer ONE (issuance); layer TWO is the resolver, which only
// honors GRANT_HONORED_BUNDLES (authz.liveGrantBundles), so a data-bundle grant from ANY path is
// inert. Both reference the same source of truth, GRANT_HONORED_BUNDLES.

const INVITE_TTL_DAYS = 14;
const GRANTABLE_BUNDLES: Bundle[] = GRANT_HONORED_BUNDLES;

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
      select: { id: true, email: true, intendedRole: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { type: true },
  });
  const ownerContacts = await listOwnerContactsForInvite(ctx, workspace.type);
  return {
    members: memberships.map((m) => {
      const bundles = m.grants.map((g) => g.bundle);
      return {
        membershipId: m.id,
        role: m.role,
        seatLabel: memberSeatLabel(m.role, bundles.includes("ORG_ADMIN")),
        officeAdminOverlay: bundles.includes("ORG_ADMIN") && m.role !== "ORG_ADMIN",
        name: m.user.name,
        email: m.user.email,
        isSelf: m.userId === ctx.userId,
      };
    }),
    invites: invites.map((inv) => ({
      id: inv.id,
      email: inv.email,
      seatLabel: inv.intendedRole ? ROLE_SEAT_LABEL[inv.intendedRole] : "Invite",
      expiresAt: inv.expiresAt,
    })),
    workspaceType: workspace.type,
    seats: inviteSeatCopyFor(workspace.type),
    ownerContacts,
    canRecordContacts: hasCapability(ctx, "contacts.write"),
  };
}

/** OWNER contacts an agency office may bind an owner seat to. Gated by members.read
 *  (office admin has no contacts.read). Taken = live LANDLORD membership or outstanding invite. */
async function listOwnerContactsForInvite(
  ctx: AuthzContext,
  workspaceType: "OWNER" | "FIDUCIARY" | "OPERATOR" | "INTERNAL",
): Promise<OwnerInviteContact[]> {
  if (workspaceType !== "FIDUCIARY") return [];
  const [contacts, seated, pending] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId: ctx.workspaceId, kind: "OWNER", archivedAt: null },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId, role: "LANDLORD", revokedAt: null, subjectContactId: { not: null } },
      select: { subjectContactId: true },
    }),
    prisma.workspaceInvite.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        intendedRole: "LANDLORD",
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        subjectContactId: { not: null },
      },
      select: { subjectContactId: true },
    }),
  ]);
  const taken = new Set(
    [...seated.map((s) => s.subjectContactId), ...pending.map((p) => p.subjectContactId)].filter(
      (id): id is string => Boolean(id),
    ),
  );
  return contacts.map((c) => ({ ...c, taken: taken.has(c.id) }));
}

/** Fail-closed: the contact must be a live OWNER in this workspace, with no live LANDLORD seat. */
async function assertOwnerInviteContact(workspaceId: string, contactId: string): Promise<void> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId, kind: "OWNER", archivedAt: null },
    select: { id: true },
  });
  if (!contact) throw new AuthzError("Not found", 404);
  const seated = await prisma.membership.findFirst({
    where: { workspaceId, role: "LANDLORD", subjectContactId: contactId, revokedAt: null },
    select: { id: true },
  });
  if (seated) throw new AuthzError("That owner already has a member seat.", 409);
}

function intendedBundlesForSeat(role: InviteableSeat): Bundle[] {
  return role === "ORG_ADMIN" ? ["ORG_ADMIN"] : [];
}

/** Invite a member by seat. Only the token hash is stored. One live invite per workspace+email.
 *  Owner (LANDLORD) is fiduciary-only and must name a live OWNER contact. */
export async function inviteMember(
  ctx: AuthzContext,
  args: { email: string; role: Role; subjectContactId?: string },
): Promise<{ inviteId: string; token: string; url: string }> {
  require_(ctx, "members.invite");
  const normalized = args.email.trim().toLowerCase();
  if (!normalized) throw new AuthzError("Email required", 422);
  if (!isInviteableSeat(args.role)) {
    throw new AuthzError("That seat is not invited from here.", 422);
  }

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { type: true },
  });
  if (!inviteableSeatsFor(workspace.type).includes(args.role)) {
    throw new AuthzError("Owner seats are invited from an agency workspace.", 422);
  }

  const subjectContactId = args.subjectContactId?.trim() || undefined;
  if (args.role === "LANDLORD") {
    if (!subjectContactId) throw new AuthzError("Pick the owner contact they act as.", 422);
    await assertOwnerInviteContact(ctx.workspaceId, subjectContactId);
    const pendingForContact = await prisma.workspaceInvite.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        intendedRole: "LANDLORD",
        subjectContactId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (pendingForContact) throw new AuthzError("An invitation is already outstanding for that owner.", 409);
  } else if (subjectContactId) {
    throw new AuthzError("That seat is not bound to a contact.", 422);
  }

  const live = await prisma.workspaceInvite.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      email: normalized,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (live) throw new AuthzError("An invitation is already outstanding for this email.", 409);

  if (args.role !== "ORG_ADMIN") {
    const existingUser = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true } });
    if (existingUser) {
      const member = await prisma.membership.findFirst({
        where: { workspaceId: ctx.workspaceId, userId: existingUser.id, revokedAt: null },
      });
      if (member) throw new AuthzError("That person is already a member of this workspace.", 409);
    }
  }

  const { token, tokenHash } = generateToken();
  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId: ctx.workspaceId,
      email: normalized,
      intendedRole: args.role,
      intendedBundles: intendedBundlesForSeat(args.role),
      subjectContactId: args.role === "LANDLORD" ? subjectContactId! : null,
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

/** Invite an office admin (ORG_ADMIN) by email. */
export async function inviteOrgAdmin(
  ctx: AuthzContext,
  email: string,
): Promise<{ inviteId: string; token: string; url: string }> {
  return inviteMember(ctx, { email, role: "ORG_ADMIN" });
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
 * invite used. The invitee sets a password here — the operator never set a credential.
 */
export async function acceptInvite(
  token: string,
  opts?: { name?: string; confirmEmail?: string; password?: string },
): Promise<{ workspaceId: string; userId: string; isPlatformAdmin: boolean; intendedRole: Role | null }> {
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

  if (!user.passwordHash && !opts?.password) {
    throw new AuthzError("Set a password to accept this invitation.", 422);
  }
  if (opts?.password) {
    try {
      const passwordHash = await hashPassword(opts.password);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordSetAt: new Date(), failedLoginCount: 0, loginLockedUntil: null },
      });
    } catch (e) {
      if (e instanceof PasswordPolicyError) throw new AuthzError(e.message, 422);
      throw e;
    }
  }

  if (!invite.platformIssued) {
    const seat: Role | null =
      invite.intendedRole ?? (invite.intendedBundles.includes("ORG_ADMIN") ? "ORG_ADMIN" : null);
    if (!seat || !isInviteableSeat(seat)) {
      throw new AuthzError("Unsupported invite", 422);
    }

    const existing = await prisma.membership.findMany({
      where: { workspaceId: invite.workspaceId, userId: user.id, revokedAt: null },
    });

    if (seat === "ORG_ADMIN") {
      // If the invitee is already a member, OVERLAY the ORG_ADMIN people-power onto their
      // resolved membership — minting a second ORG_ADMIN membership would let pickMembership mask
      // their real role. A genuinely new person gets a fresh office-admin membership.
      if (existing.length === 0) {
        await prisma.membership.create({
          data: { workspaceId: invite.workspaceId, userId: user.id, role: "ORG_ADMIN" },
        });
      } else {
        const target = pickMembership(existing)!;
        const alreadyAdmin =
          target.role === "ORG_ADMIN" ||
          (await prisma.membershipGrant.findFirst({
            where: { membershipId: target.id, bundle: "ORG_ADMIN", revokedAt: null },
          })) !== null;
        if (!alreadyAdmin) {
          await prisma.membershipGrant.create({
            data: { membershipId: target.id, bundle: "ORG_ADMIN", grantedById: invite.invitedById ?? user.id },
          });
        }
      }
    } else {
      if (existing.length > 0) {
        throw new AuthzError("That person is already a member of this workspace.", 409);
      }
      if (seat === "LANDLORD") {
        if (!invite.subjectContactId) throw new AuthzError("Owner invite is missing its contact.", 422);
        await assertOwnerInviteContact(invite.workspaceId, invite.subjectContactId);
      }
      await prisma.membership.create({
        data: {
          workspaceId: invite.workspaceId,
          userId: user.id,
          role: seat,
          subjectContactId: seat === "LANDLORD" ? invite.subjectContactId : null,
        },
      });
    }
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
  return {
    workspaceId: invite.workspaceId,
    userId: user.id,
    isPlatformAdmin: user.isPlatformAdmin,
    intendedRole:
      invite.intendedRole ?? (invite.intendedBundles.includes("ORG_ADMIN") ? "ORG_ADMIN" : null),
  };
}

/** Public, read-only invite preview for the accept screen (the token is the secret that authorises it). */
export async function peekInvite(
  token: string,
): Promise<{
  email: string;
  workspaceName: string;
  valid: boolean;
  intendedRole: Role | null;
  ownerContactName: string | null;
} | null> {
  const invite = await prisma.workspaceInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      email: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      workspaceId: true,
      intendedRole: true,
      intendedBundles: true,
      subjectContactId: true,
    },
  });
  if (!invite) return null;
  const [ws, owner] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: invite.workspaceId }, select: { name: true } }),
    invite.subjectContactId
      ? prisma.contact.findUnique({ where: { id: invite.subjectContactId }, select: { name: true } })
      : Promise.resolve(null),
  ]);
  const valid = !invite.acceptedAt && !invite.revokedAt && invite.expiresAt.getTime() > Date.now();
  const intendedRole =
    invite.intendedRole ?? (invite.intendedBundles.includes("ORG_ADMIN") ? "ORG_ADMIN" : null);
  return {
    email: invite.email,
    workspaceName: ws?.name ?? "",
    valid,
    intendedRole,
    ownerContactName: owner?.name ?? null,
  };
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
