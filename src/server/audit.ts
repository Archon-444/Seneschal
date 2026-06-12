import type { ActorType, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { sha256Hex } from "./crypto";

// Audit writer (T8.3). Security/admin log, insert-only. Verbs follow
// object.action convention: workspace.update, securelink.revoke, import.rollback…

export interface AuditInput {
  workspaceId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  onBehalfOfId?: string | null;
  verb: string;
  objectType: string;
  objectId?: string | null;
  payload?: Record<string, unknown>;
  ip?: string | null;
}

type Db = Prisma.TransactionClient;

export async function recordAudit(input: AuditInput, db: Db = prisma) {
  if (!/^[a-z_]+\.[a-z_]+$/.test(input.verb)) {
    throw new Error(`Audit verb must be object.action, got "${input.verb}"`);
  }
  return db.auditEvent.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      onBehalfOfId: input.onBehalfOfId ?? null,
      verb: input.verb,
      objectType: input.objectType,
      objectId: input.objectId ?? null,
      payloadHash: input.payload ? sha256Hex(JSON.stringify(input.payload)) : null,
      ip: input.ip ?? null,
    },
  });
}
