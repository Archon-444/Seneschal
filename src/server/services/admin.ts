import type { Role, User } from "@prisma/client";
import { prisma } from "../db";
import { AuthzError, isPersonaRole } from "../authz";
import { recordAudit } from "../audit";

// Provisioning writes for the platform operator (F-Admin §3.4 seat-zero / persona onboarding).
//
// F-Admin teardown (D2): the cross-workspace DATA reads that used to live here
// (staffListWorkspaces/Notifications/RiskFlags/ExtractionQueue, staffAuditStream,
// staffListUsers) are GONE — the platform plane sees aggregate stats only, via
// `src/server/admin/platformStats.ts`. The break-glass rail `staffActAs` is DELETED, not
// gated (it was latent and the wrong shape; §3.5). What remains is membership creation,
// reconciled into the in-org member-management service in Phase 3.

function assertPlatformAdmin(operator: User): void {
  if (!operator.isPlatformAdmin) throw new AuthzError("Platform admin only", 403);
}

export async function staffCreateMembership(
  operator: User,
  args: { workspaceId: string; userId: string; role: Role; clientPrincipalId?: string; subjectContactId?: string },
) {
  assertPlatformAdmin(operator);
  // Mirror the contextFromMembership guards at creation so a scoped role can never be
  // onboarded without its scope (which would later fail authz() with "missing scope").
  if (isPersonaRole(args.role) && !args.subjectContactId) {
    throw new AuthzError(`${args.role} membership requires subjectContactId`, 422);
  }
  if (args.role === "CLIENT_VIEWER" && !args.clientPrincipalId) {
    throw new AuthzError("CLIENT_VIEWER membership requires clientPrincipalId", 422);
  }
  const membership = await prisma.membership.create({
    data: {
      workspaceId: args.workspaceId,
      userId: args.userId,
      role: args.role,
      clientPrincipalId: args.clientPrincipalId ?? null,
      subjectContactId: isPersonaRole(args.role) ? args.subjectContactId : null,
    },
  });
  await recordAudit({
    workspaceId: args.workspaceId,
    actorType: "STAFF",
    actorId: operator.id,
    onBehalfOfId: args.userId,
    verb: "membership.create",
    objectType: "Membership",
    objectId: membership.id,
  });
  return membership;
}
