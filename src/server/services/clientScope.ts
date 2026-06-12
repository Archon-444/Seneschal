import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// Resolves every record id a single ClientPrincipal's scope covers, so that
// CLIENT_VIEWER queries on scope-polymorphic tables (Document, EvidenceEvent,
// ProofRequest, RiskFlag) can be constrained server-side. Workspace filtering
// alone is NOT enough for those tables — they carry scopeType/scopeId instead
// of a clientPrincipalId column.

export interface ClientScopeIds {
  clientPrincipalId: string;
  propertyIds: string[];
  tenancyIds: string[];
  paymentItemIds: string[];
  proofRequestIds: string[];
}

type Db = Prisma.TransactionClient;

export async function resolveClientScopeIds(
  workspaceId: string,
  clientPrincipalId: string,
  db: Db = prisma,
): Promise<ClientScopeIds> {
  const properties = await db.property.findMany({
    where: { workspaceId, clientPrincipalId },
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

  const ownScopeIds = [clientPrincipalId, ...propertyIds, ...tenancyIds, ...paymentItemIds];
  const proofRequests = await db.proofRequest.findMany({
    where: { workspaceId, scopeId: { in: ownScopeIds } },
    select: { id: true },
  });
  const proofRequestIds = proofRequests.map((r) => r.id);

  return { clientPrincipalId, propertyIds, tenancyIds, paymentItemIds, proofRequestIds };
}

/** All scopeIds (across scope types) a client viewer may see, including the client itself. */
export function allScopeIds(ids: ClientScopeIds): string[] {
  return [
    ids.clientPrincipalId,
    ...ids.propertyIds,
    ...ids.tenancyIds,
    ...ids.paymentItemIds,
    ...ids.proofRequestIds,
  ];
}

/** Prisma OR-clause matching rows whose scopeType/scopeId fall inside the client scope. */
export function scopeMatchClauses(ids: ClientScopeIds): {
  scopeType: "CLIENT" | "PROPERTY" | "TENANCY" | "PAYMENT_ITEM" | "PROOF_REQUEST";
  scopeId: { in: string[] } | string;
}[] {
  return [
    { scopeType: "CLIENT", scopeId: ids.clientPrincipalId },
    { scopeType: "PROPERTY", scopeId: { in: ids.propertyIds } },
    { scopeType: "TENANCY", scopeId: { in: ids.tenancyIds } },
    { scopeType: "PAYMENT_ITEM", scopeId: { in: ids.paymentItemIds } },
    { scopeType: "PROOF_REQUEST", scopeId: { in: ids.proofRequestIds } },
  ];
}

/** True when a scoped row (scopeType/scopeId) belongs to the client's scope. */
export function scopeBelongsToClient(
  ids: ClientScopeIds,
  scopeType: string,
  scopeId: string | null,
): boolean {
  if (!scopeId) return false;
  switch (scopeType) {
    case "CLIENT":
      return scopeId === ids.clientPrincipalId;
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
