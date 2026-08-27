import { prisma } from "../db";
import { type AuthzContext, hasCapability, isDelegateRole, require_, scope } from "../authz";
import { allScopeIds, inIds, resolveClientScopeIds } from "./clientScope";
import { resolveDelegateScopeIds } from "./delegateScope";
import { todayInDubai } from "../calculators/dates";

// Workspace dashboard + client-viewer + delegate dashboard KPIs (T10.2).

export async function dashboardKpis(ctx: AuthzContext) {
  require_(ctx, "properties.read");
  // A delegate (MANAGING_AGENT) is confined to its assigned properties; a CLIENT_VIEWER
  // to one client. Delegate counts go through resolveDelegateScopeIds (property book);
  // CLIENT_VIEWER through resolveClientScopeIds. LANDLORD also holds properties.read but
  // is a persona — wsScope keeps scope(ctx)'s fail-closed throw for it.
  const delegate = isDelegateRole(ctx.role);
  const ids = delegate
    ? await resolveDelegateScopeIds(ctx)
    : ctx.clientPrincipalId
      ? await resolveClientScopeIds(ctx.workspaceId, ctx.clientPrincipalId)
      : null;
  const wsScope = delegate ? { workspaceId: ctx.workspaceId } : scope(ctx);
  const today = todayInDubai();
  const in30 = new Date(today.getTime() + 30 * 86_400_000);

  const [properties, tenancies, upcomingDeadlines, overdueDeadlines, openFlags, openProofs, latePayments] =
    await Promise.all([
      prisma.property.count({
        where: { ...wsScope, ...(ids ? { id: inIds(ids.propertyIds) } : {}), archivedAt: null },
      }),
      prisma.tenancy.count({
        where: { ...wsScope, archivedAt: null, ...(ids ? { id: inIds(ids.tenancyIds) } : {}) },
      }),
      hasCapability(ctx, "deadlines.read") ? prisma.deadline.count({
        where: {
          ...wsScope,
          status: "OPEN",
          dueAt: { gte: today, lte: in30 },
          ...(ids ? { OR: [{ propertyId: inIds(ids.propertyIds) }, { tenancyId: inIds(ids.tenancyIds) }] } : {}),
        },
      }) : Promise.resolve(null),
      hasCapability(ctx, "deadlines.read") ? prisma.deadline.count({
        where: {
          ...wsScope,
          status: "OPEN",
          dueAt: { lt: today },
          ...(ids ? { OR: [{ propertyId: inIds(ids.propertyIds) }, { tenancyId: inIds(ids.tenancyIds) }] } : {}),
        },
      }) : Promise.resolve(null),
      hasCapability(ctx, "riskflags.read") ? prisma.riskFlag.count({
        where: {
          ...wsScope,
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
          ...(ids ? { scopeId: inIds(allScopeIds(ids)) } : {}),
        },
      }) : Promise.resolve(null),
      hasCapability(ctx, "proofs.read") ? prisma.proofRequest.count({
        where: {
          ...wsScope,
          status: { notIn: ["APPROVED", "CLOSED"] },
          ...(ids ? { id: inIds(ids.proofRequestIds) } : {}),
        },
      }) : Promise.resolve(null),
      hasCapability(ctx, "payments.read") ? prisma.paymentItem.count({
        where: { ...wsScope, status: { in: ["LATE", "BOUNCED"] }, ...(ids ? { tenancyId: inIds(ids.tenancyIds) } : {}) },
      }) : Promise.resolve(null),
    ]);

  return { properties, tenancies, upcomingDeadlines, overdueDeadlines, openFlags, openProofs, latePayments };
}

/** First-run activation state for the dashboard's getting-started card.
 *  Workspace-wide by design — the card only renders for roles holding
 *  clients.write, which are never client- or contact-scoped. */
export async function activationStatus(ctx: AuthzContext) {
  require_(ctx, "clients.write");
  const [clients, tenancies, activeMembers] = await Promise.all([
    prisma.clientPrincipal.count({ where: { ...scope(ctx), archivedAt: null } }),
    prisma.tenancy.count({ where: { ...scope(ctx), archivedAt: null } }),
    prisma.membership.count({ where: { ...scope(ctx), revokedAt: null } }),
  ]);
  return {
    hasClient: clients > 0,
    hasTenancy: tenancies > 0,
    hasTeam: activeMembers > 1,
  };
}
