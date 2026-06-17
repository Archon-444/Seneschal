import { prisma } from "../db";
import { type AuthzContext, isDelegateRole, require_, scope } from "../authz";
import { allScopeIds, resolveClientScopeIds } from "./clientScope";
import { todayInDubai } from "../calculators/dates";

// Workspace dashboard + client-viewer + delegate dashboard KPIs (T10.2).

export async function dashboardKpis(ctx: AuthzContext) {
  require_(ctx, "properties.read");
  // A delegate (MANAGING_AGENT) is confined to its assigned client set; a CLIENT_VIEWER
  // to one client. Both resolve through the SAME sanctioned resolver (resolveClientScopeIds)
  // and every scoped count is derived from its id-sets — no bespoke per-table predicate that
  // could drift from clientSetScopedWhere. LANDLORD also holds properties.read but is a
  // persona — wsScope keeps scope(ctx)'s fail-closed throw for it (a persona must not see
  // workspace-wide counts).
  const delegate = isDelegateRole(ctx.role);
  const scopeClientIds = delegate
    ? ctx.delegateClientIds
    : ctx.clientPrincipalId
      ? [ctx.clientPrincipalId]
      : null;
  const wsScope = delegate ? { workspaceId: ctx.workspaceId } : scope(ctx);
  const ids = scopeClientIds ? await resolveClientScopeIds(ctx.workspaceId, scopeClientIds) : null;
  const today = todayInDubai();
  const in30 = new Date(today.getTime() + 30 * 86_400_000);

  const [properties, tenancies, upcomingDeadlines, overdueDeadlines, openFlags, openProofs, latePayments] =
    await Promise.all([
      prisma.property.count({
        where: { ...wsScope, ...(ids ? { id: { in: ids.propertyIds } } : {}), archivedAt: null },
      }),
      prisma.tenancy.count({
        where: { ...wsScope, archivedAt: null, ...(ids ? { id: { in: ids.tenancyIds } } : {}) },
      }),
      prisma.deadline.count({
        where: {
          ...wsScope,
          status: "OPEN",
          dueAt: { gte: today, lte: in30 },
          ...(ids ? { OR: [{ propertyId: { in: ids.propertyIds } }, { tenancyId: { in: ids.tenancyIds } }] } : {}),
        },
      }),
      prisma.deadline.count({
        where: {
          ...wsScope,
          status: "OPEN",
          dueAt: { lt: today },
          ...(ids ? { OR: [{ propertyId: { in: ids.propertyIds } }, { tenancyId: { in: ids.tenancyIds } }] } : {}),
        },
      }),
      prisma.riskFlag.count({
        where: {
          ...wsScope,
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
          ...(ids ? { scopeId: { in: allScopeIds(ids) } } : {}),
        },
      }),
      prisma.proofRequest.count({
        where: {
          ...wsScope,
          status: { notIn: ["APPROVED", "CLOSED"] },
          ...(ids ? { id: { in: ids.proofRequestIds } } : {}),
        },
      }),
      prisma.paymentItem.count({
        where: { ...wsScope, status: { in: ["LATE", "BOUNCED"] }, ...(ids ? { tenancyId: { in: ids.tenancyIds } } : {}) },
      }),
    ]);

  return { properties, tenancies, upcomingDeadlines, overdueDeadlines, openFlags, openProofs, latePayments };
}
