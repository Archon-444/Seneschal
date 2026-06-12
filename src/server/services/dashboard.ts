import { prisma } from "../db";
import { type AuthzContext, clientScope, require_, scope } from "../authz";
import { allScopeIds, resolveClientScopeIds } from "./clientScope";
import { todayInDubai } from "../calculators/dates";

// Workspace dashboard + client-viewer dashboard KPIs (T10.2).

export async function dashboardKpis(ctx: AuthzContext) {
  require_(ctx, "properties.read");
  const client = clientScope(ctx);
  // CLIENT_VIEWER: flag/proof counts are scope-polymorphic — count only rows
  // whose scope resolves to the viewer's client.
  const clientIds = ctx.clientPrincipalId
    ? await resolveClientScopeIds(ctx.workspaceId, ctx.clientPrincipalId)
    : null;
  const tenancyClientFilter = client.clientPrincipalId
    ? { property: { clientPrincipalId: client.clientPrincipalId } }
    : {};
  const today = todayInDubai();
  const in30 = new Date(today.getTime() + 30 * 86_400_000);

  const [properties, tenancies, upcomingDeadlines, overdueDeadlines, openFlags, openProofs, latePayments] =
    await Promise.all([
      prisma.property.count({ where: { ...scope(ctx), ...client, archivedAt: null } }),
      prisma.tenancy.count({ where: { ...scope(ctx), archivedAt: null, ...tenancyClientFilter } }),
      prisma.deadline.count({
        where: { ...scope(ctx), status: "OPEN", dueAt: { gte: today, lte: in30 }, tenancy: tenancyClientFilter.property ? { property: tenancyClientFilter.property } : {} },
      }),
      prisma.deadline.count({
        where: { ...scope(ctx), status: "OPEN", dueAt: { lt: today }, tenancy: tenancyClientFilter.property ? { property: tenancyClientFilter.property } : {} },
      }),
      prisma.riskFlag.count({
        where: {
          ...scope(ctx),
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
          ...(clientIds ? { scopeId: { in: allScopeIds(clientIds) } } : {}),
        },
      }),
      prisma.proofRequest.count({
        where: {
          ...scope(ctx),
          status: { notIn: ["APPROVED", "CLOSED"] },
          ...(clientIds ? { id: { in: clientIds.proofRequestIds } } : {}),
        },
      }),
      prisma.paymentItem.count({
        where: { ...scope(ctx), status: { in: ["LATE", "BOUNCED"] }, ...(tenancyClientFilter.property ? { tenancy: { property: tenancyClientFilter.property } } : {}) },
      }),
    ]);

  return { properties, tenancies, upcomingDeadlines, overdueDeadlines, openFlags, openProofs, latePayments };
}
