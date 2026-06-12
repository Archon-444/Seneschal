import type { ActorType, EvidenceType, Prisma, ScopeType } from "@prisma/client";
import { prisma } from "./db";
import { sha256Hex } from "./crypto";

// Single evidence writer (T8.1 — release blocking). No module writes
// EvidenceEvent directly; everything funnels through recordEvidence so enum,
// scope refs and actor typing stay consistent. Insert-only — corrections are
// new events referencing the old via supersedesId.

export interface EvidenceInput {
  workspaceId: string;
  type: EvidenceType;
  actorType: ActorType;
  actorId?: string | null;
  onBehalfOfId?: string | null;
  scopeType: ScopeType;
  scopeId?: string | null;
  propertyId?: string | null;
  tenancyId?: string | null;
  payload?: Record<string, unknown>;
  supersedesId?: string | null;
}

type Db = Prisma.TransactionClient;

export async function recordEvidence(input: EvidenceInput, db: Db = prisma) {
  if (!input.workspaceId) throw new Error("EvidenceEvent requires workspaceId");
  if ((input.actorType === "USER" || input.actorType === "STAFF") && !input.actorId) {
    throw new Error(`actorType ${input.actorType} requires actorId`);
  }
  const payload = input.payload ?? undefined;
  return db.evidenceEvent.create({
    data: {
      workspaceId: input.workspaceId,
      type: input.type,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      onBehalfOfId: input.onBehalfOfId ?? null,
      scopeType: input.scopeType,
      scopeId: input.scopeId ?? null,
      propertyId: input.propertyId ?? null,
      tenancyId: input.tenancyId ?? null,
      payload: payload as Prisma.InputJsonValue | undefined,
      payloadHash: payload ? sha256Hex(JSON.stringify(payload)) : null,
      supersedesId: input.supersedesId ?? null,
    },
  });
}
