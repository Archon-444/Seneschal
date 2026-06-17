import { prisma } from "../db";
import { type AuthzContext, clientScope, isDelegateRole, require_, scope } from "../authz";
import { allScopeIds, resolveClientScopeIds } from "./clientScope";
import { todayInDubai } from "../calculators/dates";

// Workspace dashboard + client-viewer + delegate dashboard KPIs (T10.2).

export async function dashboardKpis(ctx: AuthzContext) {
  require_(ctx, "properties.read");
  // A delegate (MANAGING_AGENT) is confined to its assigned client set; a CLIENT_VIEWER
  // to one client. Both resolve to a client-id list and the scope-polymorphic id-set.
  // LANDLORD also holds properties.read but is a persona — wsScope keeps scope(ctx)'s
  // fail-closed throw for it (a persona must not see workspace-wide counts).
  const delegate = isDelegateRole(ctx.role);
  const scopeClientIds = delegate
    ? ctx.delegateClientIds
    : ctx.clientPrincipalId
      ? [ctx.clientPrincipalId]
      : null;
  const wsScope = delegate ? { workspaceId: ctx.workspaceId } : scope(ctx);
  const client = !delegate ? clientScope(ctx) : {};
  const clientIds = scopeClientIds ? await resolveClientScopeIds(ctx.workspaceId, scopeClientIds) : null;
  const tenancyClientFilter = scopeClientIds
    ? { property: { clientPrincipalId: { in: scopeClientIds } } }
    : {};
  const today = todayInDubai();
  const in30 = new Date(today.getTime() + 30 * 86_400_000);

  const [properties, tenancies, upcomingDeadlines, overdueDeadlines, openFlags, openProofs, latePayments] =
    await Promise.all([
      prisma.property.count({
        where: {
          ...wsScope,
          ...client,
          ...(scopeClientIds ? { clientPrincipalId: { in: scopeClientIds } } : {}),
          archivedAt: null,
        },
      }),
      prisma.tenancy.count({ where: { ...wsScope, archivedAt: null, ...tenancyClientFilter } }),
      prisma.deadline.count({
        where: { ...wsScope, status: "OPEN", dueAt: { gte: today, lte: in30 }, tenancy: tenancyClientFilter.property ? { property: tenancyClientFilter.property } : {} },
      }),
      prisma.deadline.count({
        where: { ...wsScope, status: "OPEN", dueAt: { lt: today }, tenancy: tenancyClientFilter.property ? { property: tenancyClientFilter.property } : {} },
      }),
      prisma.riskFlag.count({
        where: {
          ...wsScope,
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
          ...(clientIds ? { scopeId: { in: allScopeIds(clientIds) } } : {}),
        },
      }),
      prisma.proofRequest.count({
        where: {
          ...wsScope,
          status: { notIn: ["APPROVED", "CLOSED"] },
          ...(clientIds ? { id: { in: clientIds.proofRequestIds } } : {}),
        },
      }),
      prisma.paymentItem.count({
        where: { ...wsScope, status: { in: ["LATE", "BOUNCED"] }, ...(tenancyClientFilter.property ? { tenancy: { property: tenancyClientFilter.property } } : {}) },
      }),
    ]);

  return { properties, tenancies, upcomingDeadlines, overdueDeadlines, openFlags, openProofs, latePayments };
}
