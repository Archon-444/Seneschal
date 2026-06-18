import { prisma } from "../db";
import type { PlatformAdminContext } from "../authz";

// Platform-plane aggregate health (F-Admin §3.3). Returns ONLY typed scalars — counts,
// status strings, timestamps. NEVER a value that resolves to a named row: no tenant, no
// address, no document title, no contact, no member email. Workspace name/type ARE
// returned because they are the operator's own customer-org identity (the operator
// provisioned them), not tenancy data. The module-graph allowlist test (Phase 2) asserts
// the admin plane imports no confidential service; this module reads only aggregates off
// the raw client.

/** Per-workspace operator dashboard row — scalars only. */
export interface WorkspaceStat {
  workspaceId: string;
  name: string;
  type: string;
  archived: boolean;
  seatsUsed: number;
  subscriptionStatus: string | null;
  properties: number;
  tenanciesByStatus: Record<string, number>;
  openProofRequests: number;
  openRiskFlags: number;
  documents: number;
  notifications: { sent: number; failed: number; queued: number };
  lastActivityAt: Date | null;
}

// "Open" = not yet in a terminal state (the operator cares about live work, not history).
const OPEN_PROOF = ["OPEN", "SENT", "WAITING_PROOF", "SUBMITTED", "OVERDUE"] as const;
const OPEN_FLAG = ["OPEN", "ACKNOWLEDGED"] as const;

/**
 * Aggregate stats for every workspace, computed with a fixed set of grouped queries
 * (no N+1, no per-row fetch). The `_ctx` is required so this can only be called from the
 * platform plane; it carries no scope and is not otherwise consulted.
 */
export async function platformStats(_ctx: PlatformAdminContext): Promise<WorkspaceStat[]> {
  const [
    workspaces,
    propsByWs,
    tenByWs,
    proofsByWs,
    flagsByWs,
    docsByWs,
    notifsByWs,
    seatRows,
    subs,
    lastActivity,
  ] = await Promise.all([
    prisma.workspace.findMany({ select: { id: true, name: true, type: true, archivedAt: true } }),
    prisma.property.groupBy({ by: ["workspaceId"], _count: { _all: true } }),
    prisma.tenancy.groupBy({ by: ["workspaceId", "status"], _count: { _all: true } }),
    prisma.proofRequest.groupBy({
      by: ["workspaceId"],
      where: { status: { in: [...OPEN_PROOF] } },
      _count: { _all: true },
    }),
    prisma.riskFlag.groupBy({
      by: ["workspaceId"],
      where: { status: { in: [...OPEN_FLAG] } },
      _count: { _all: true },
    }),
    prisma.document.groupBy({ by: ["workspaceId"], _count: { _all: true } }),
    prisma.notificationMessage.groupBy({ by: ["workspaceId", "status"], _count: { _all: true } }),
    // Distinct (workspace, user) pairs among live memberships → seat count per workspace.
    // Returns opaque IDs used only to tally; no name/email leaves this function.
    prisma.membership.groupBy({ by: ["workspaceId", "userId"], where: { revokedAt: null } }),
    prisma.subscription.findMany({ select: { workspaceId: true, status: true, startedAt: true } }),
    prisma.auditEvent.groupBy({
      by: ["workspaceId"],
      where: { workspaceId: { not: null } },
      _max: { createdAt: true },
    }),
  ]);

  const countByWs = (rows: { workspaceId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.workspaceId, r._count._all]));

  const props = countByWs(propsByWs);
  const proofs = countByWs(proofsByWs);
  const flags = countByWs(flagsByWs);
  const docs = countByWs(docsByWs);

  const tenancies = new Map<string, Record<string, number>>();
  for (const r of tenByWs) {
    const m = tenancies.get(r.workspaceId) ?? {};
    m[r.status] = r._count._all;
    tenancies.set(r.workspaceId, m);
  }

  const notifs = new Map<string, { sent: number; failed: number; queued: number }>();
  for (const r of notifsByWs) {
    const m = notifs.get(r.workspaceId) ?? { sent: 0, failed: 0, queued: 0 };
    if (r.status === "FAILED") m.failed += r._count._all;
    else if (r.status === "QUEUED") m.queued += r._count._all;
    else m.sent += r._count._all; // SENT | DELIVERED | READ | RECEIVED
    notifs.set(r.workspaceId, m);
  }

  const seats = new Map<string, number>();
  for (const r of seatRows) seats.set(r.workspaceId, (seats.get(r.workspaceId) ?? 0) + 1);

  // Latest subscription per workspace by start date wins.
  const subByWs = new Map<string, string>();
  const subStart = new Map<string, number>();
  for (const s of subs) {
    const t = s.startedAt.getTime();
    if (!subStart.has(s.workspaceId) || t > subStart.get(s.workspaceId)!) {
      subStart.set(s.workspaceId, t);
      subByWs.set(s.workspaceId, s.status);
    }
  }

  const activity = new Map(
    lastActivity.map((r) => [r.workspaceId as string, r._max.createdAt ?? null] as const),
  );

  return workspaces.map((w) => ({
    workspaceId: w.id,
    name: w.name,
    type: w.type,
    archived: w.archivedAt !== null,
    seatsUsed: seats.get(w.id) ?? 0,
    subscriptionStatus: subByWs.get(w.id) ?? null,
    properties: props.get(w.id) ?? 0,
    tenanciesByStatus: tenancies.get(w.id) ?? {},
    openProofRequests: proofs.get(w.id) ?? 0,
    openRiskFlags: flags.get(w.id) ?? 0,
    documents: docs.get(w.id) ?? 0,
    notifications: notifs.get(w.id) ?? { sent: 0, failed: 0, queued: 0 },
    lastActivityAt: activity.get(w.id) ?? null,
  }));
}
