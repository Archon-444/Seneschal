import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// Resolves every record id a single ClientPrincipal's scope covers, so that
// CLIENT_VIEWER queries on scope-polymorphic tables (Document, EvidenceEvent,
// ProofRequest, RiskFlag) can be constrained server-side. Workspace filtering
// alone is NOT enough for those tables — they carry scopeType/scopeId instead
// of a clientPrincipalId column.

export interface ClientScopeIds {
  /** First covered client — meaningful for CLIENT_VIEWER (single); use clientPrincipalIds for the full set. */
  clientPrincipalId: string;
  /** Every client this set covers: one for CLIENT_VIEWER, the assigned set for a MANAGING_AGENT delegate. */
  clientPrincipalIds: string[];
  propertyIds: string[];
  tenancyIds: string[];
  paymentItemIds: string[];
  proofRequestIds: string[];
}

type Db = Prisma.TransactionClient;

/**
 * Resolve the record-id set covering one client (CLIENT_VIEWER) or several
 * (MANAGING_AGENT delegate — F0d). The traversal keys on `clientPrincipalId`, which
 * Prisma accepts as `{ in: [...] }`, so single- and multi-client callers share one
 * path and the read/write boundaries cannot drift apart.
 */
export async function resolveClientScopeIds(
  workspaceId: string,
  clientPrincipalId: string | string[],
  db: Db = prisma,
): Promise<ClientScopeIds> {
  const clientPrincipalIds = Array.isArray(clientPrincipalId) ? clientPrincipalId : [clientPrincipalId];
  const properties = await db.property.findMany({
    where: { workspaceId, clientPrincipalId: { in: clientPrincipalIds } },
    select: { id: true },
  });
  const propertyIds = properties.map((p) => p.id);

  const tenancies = await db.tenancy.findMany({
    where: { workspaceId, propertyId: { in: propertyIds } },
    select: { id: true },
  });
  const tenancyIds = tenancies.map((t) => t.id);

  const paymentItems = await db.paymentItem.findMany({
    where: { workspaceId, tenancyId: { in: tenancyIds } },
    select: { id: true },
  });
  const paymentItemIds = paymentItems.map((i) => i.id);

  const ownScopeIds = [...clientPrincipalIds, ...propertyIds, ...tenancyIds, ...paymentItemIds];
  const proofRequests = await db.proofRequest.findMany({
    where: { workspaceId, scopeId: { in: ownScopeIds } },
    select: { id: true },
  });
  const proofRequestIds = proofRequests.map((r) => r.id);

  return {
    clientPrincipalId: clientPrincipalIds[0] ?? "",
    clientPrincipalIds,
    propertyIds,
    tenancyIds,
    paymentItemIds,
    proofRequestIds,
  };
}

/** All scopeIds (across scope types) a client viewer/delegate may see, including the client(s). */
export function allScopeIds(ids: ClientScopeIds): string[] {
  return [
    ...ids.clientPrincipalIds,
    ...ids.propertyIds,
    ...ids.tenancyIds,
    ...ids.paymentItemIds,
    ...ids.proofRequestIds,
  ];
}

/** Prisma OR-clause matching rows whose scopeType/scopeId fall inside the client scope. */
export function scopeMatchClauses(ids: ClientScopeIds): {
  scopeType: "CLIENT" | "PROPERTY" | "TENANCY" | "PAYMENT_ITEM" | "PROOF_REQUEST";
  scopeId: { in: string[] };
}[] {
  return [
    { scopeType: "CLIENT", scopeId: { in: ids.clientPrincipalIds } },
    { scopeType: "PROPERTY", scopeId: { in: ids.propertyIds } },
    { scopeType: "TENANCY", scopeId: { in: ids.tenancyIds } },
    { scopeType: "PAYMENT_ITEM", scopeId: { in: ids.paymentItemIds } },
    { scopeType: "PROOF_REQUEST", scopeId: { in: ids.proofRequestIds } },
  ];
}

/** True when a scoped row (scopeType/scopeId) belongs to the client/delegate scope. */
export function scopeBelongsToClient(
  ids: ClientScopeIds,
  scopeType: string,
  scopeId: string | null,
): boolean {
  if (!scopeId) return false;
  switch (scopeType) {
    case "CLIENT":
      return ids.clientPrincipalIds.includes(scopeId);
    case "PROPERTY":
      return ids.propertyIds.includes(scopeId);
    case "TENANCY":
      return ids.tenancyIds.includes(scopeId);
    case "PAYMENT_ITEM":
      return ids.paymentItemIds.includes(scopeId);
    case "PROOF_REQUEST":
      return ids.proofRequestIds.includes(scopeId);
    default:
      return false;
  }
}
