import type { WorkspaceType } from "@prisma/client";
import { prisma } from "../db";
import { AuthzError, type PlatformAdminContext } from "../authz";
import { recordAudit } from "../audit";
import { generateToken } from "../crypto";

// Platform provisioning (F-Admin §3.4). The operator creates the customer org and seats the
// FIRST principal, then steps out — they set NO credential, and the workspace is empty (zero
// confidential rows) at the moment they touch it, so "I can't see their data" is true by
// construction. Imports only infra (db/crypto/audit/authz) — never a confidential service.

const INVITE_TTL_DAYS = 14;

function operatorActor(ctx: PlatformAdminContext, onBehalfOfId?: string) {
  return { actorType: "STAFF" as const, actorId: ctx.userId, onBehalfOfId };
}

export interface ProvisionInput {
  name: string;
  type: WorkspaceType;
  customerEmail: string;
  customerName: string;
  planCode?: string;
}

export interface ProvisionResult {
  workspaceId: string;
  inviteId: string;
  /** Raw invite token — returned ONCE, never stored or logged. */
  inviteToken: string;
  inviteUrl: string;
}

/**
 * Seat-zero: create the customer org, seat their first user as PRINCIPAL (the
 * WORKSPACE_ADMIN base shape, the sole in-org authority root — never a bare org-admin), and
 * issue a hashed-token invite. The user sets their own passkey/OTP on accept; the operator
 * sets no secret.
 */
export async function provisionWorkspace(
  ctx: PlatformAdminContext,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const workspace = await prisma.workspace.create({ data: { name: input.name, type: input.type } });

  // The customer's principal — created by email with NO credential set by the operator.
  const user = await prisma.user.upsert({
    where: { email: input.customerEmail },
    update: {},
    create: { email: input.customerEmail, name: input.customerName },
  });

  // {PRINCIPAL} = WORKSPACE_ADMIN: see-all-do-all within (and only within) this workspace.
  const membership = await prisma.membership.create({
    data: { workspaceId: workspace.id, userId: user.id, role: "WORKSPACE_ADMIN" },
  });

  const { token, tokenHash } = generateToken();
  const invite = await prisma.workspaceInvite.create({
    data: {
      workspaceId: workspace.id,
      email: input.customerEmail,
      intendedBundles: ["PRINCIPAL"],
      tokenHash,
      invitedById: null, // platform-issued seat-zero
      platformIssued: true,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });

  if (input.planCode) await attachPlan(ctx, workspace.id, input.planCode);

  await recordAudit({
    workspaceId: workspace.id,
    ...operatorActor(ctx, user.id),
    verb: "workspace.provision",
    objectType: "Workspace",
    objectId: workspace.id,
  });
  await recordAudit({
    workspaceId: workspace.id,
    ...operatorActor(ctx, user.id),
    verb: "invite.issue",
    objectType: "WorkspaceInvite",
    objectId: invite.id,
  });
  void membership;

  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return { workspaceId: workspace.id, inviteId: invite.id, inviteToken: token, inviteUrl: `${base}/invite/${token}` };
}

async function loadWorkspace(workspaceId: string) {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) throw new AuthzError("Workspace not found", 404);
  return ws;
}

export async function suspendWorkspace(ctx: PlatformAdminContext, workspaceId: string) {
  await loadWorkspace(workspaceId);
  const ws = await prisma.workspace.update({ where: { id: workspaceId }, data: { suspendedAt: new Date() } });
  await recordAudit({ workspaceId, ...operatorActor(ctx), verb: "workspace.suspend", objectType: "Workspace", objectId: workspaceId });
  return ws;
}

export async function unsuspendWorkspace(ctx: PlatformAdminContext, workspaceId: string) {
  await loadWorkspace(workspaceId);
  const ws = await prisma.workspace.update({ where: { id: workspaceId }, data: { suspendedAt: null } });
  await recordAudit({ workspaceId, ...operatorActor(ctx), verb: "workspace.unsuspend", objectType: "Workspace", objectId: workspaceId });
  return ws;
}

export async function archiveWorkspace(ctx: PlatformAdminContext, workspaceId: string) {
  await loadWorkspace(workspaceId);
  const ws = await prisma.workspace.update({ where: { id: workspaceId }, data: { archivedAt: new Date() } });
  await recordAudit({ workspaceId, ...operatorActor(ctx), verb: "workspace.archive", objectType: "Workspace", objectId: workspaceId });
  return ws;
}

/** Attach a plan (entitlement) to a workspace — billing record-keeping, not data. */
export async function attachPlan(ctx: PlatformAdminContext, workspaceId: string, planCode: string) {
  const plan = await prisma.plan.findUnique({ where: { code: planCode } });
  if (!plan) throw new AuthzError(`Unknown plan ${planCode}`, 404);
  const sub = await prisma.subscription.create({
    data: { workspaceId, planId: plan.id, status: "active", period: "YEAR" },
  });
  await recordAudit({ workspaceId, ...operatorActor(ctx), verb: "subscription.assign", objectType: "Subscription", objectId: sub.id });
  return sub;
}
