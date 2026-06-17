import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// Outbox (T0.3 + H1): request handlers never execute side effects inline —
// they enqueue, the runner dispatches with retries. Workers claim rows
// atomically via SELECT … FOR UPDATE SKIP LOCKED so multiple workers (or
// multiple cold-start serverless invocations) can never dispatch the same row.

export type OutboxTopic = "notification.send" | "risk.evaluate" | "payments.late_check" | "whatsapp.status";

type Db = Prisma.TransactionClient;

export interface EnqueueOptions {
  availableAt?: Date;
  /**
   * Provider-level idempotency key. Same key passed to the upstream provider
   * on send (Resend Idempotency-Key header, WhatsApp client message id), so a
   * crash between provider-accept and DB-flip-to-dispatched can't double-send.
   * Also dedupes enqueues via the unique (topic, idempotencyKey) constraint —
   * a second enqueue with the same key throws P2002 and is the caller's signal
   * that the row is already queued.
   */
  idempotencyKey?: string;
}

export async function enqueue(
  topic: OutboxTopic,
  payload: Record<string, unknown>,
  db: Db = prisma,
  options?: EnqueueOptions | Date,
) {
  // Back-compat: older callers passed a Date as the 4th argument.
  const opts: EnqueueOptions = options instanceof Date ? { availableAt: options } : options ?? {};
  return db.outbox.create({
    data: {
      topic,
      payload: payload as Prisma.InputJsonValue,
      availableAt: opts.availableAt ?? new Date(),
      idempotencyKey: opts.idempotencyKey ?? null,
    },
  });
}

const MAX_ATTEMPTS = 5;
const LEASE_MS = 60_000; // a worker has one minute to finish a row or the lease expires

export interface OutboxEntry {
  id: string;
  topic: string;
  payload: unknown;
  attempts: number;
  idempotencyKey: string | null;
}

export type OutboxHandler = (
  payload: Record<string, unknown>,
  ctx: { idempotencyKey: string | null },
) => Promise<void>;

/**
 * Dispatch one batch of due outbox entries. Returns number processed.
 *
 * Claim semantics (H1):
 *  1. Release expired leases (`processing` rows whose `lockedUntil` passed) —
 *     covers crashed workers without needing a separate sweeper.
 *  2. Inside a single transaction: SELECT … FOR UPDATE SKIP LOCKED a batch of
 *     `pending` rows whose `availableAt` is due, then UPDATE them to
 *     `processing` with a fresh `lockedUntil`. Row locks give each worker a
 *     disjoint set for free — workers never overlap.
 *  3. Process each claimed row outside the claim transaction. On success flip
 *     to `dispatched`; on failure schedule a retry with exponential backoff.
 */
export async function dispatchPending(
  handlers: Record<string, OutboxHandler>,
  batchSize = 20,
): Promise<number> {
  // 1. Recover crashed leases.
  await prisma.$executeRaw`
    UPDATE "Outbox"
       SET status = 'pending', "lockedUntil" = NULL
     WHERE status = 'processing' AND "lockedUntil" < now()
  `;

  // 2. Atomic claim.
  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Outbox"
       WHERE status = 'pending' AND "availableAt" <= now()
       ORDER BY "availableAt" ASC
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) return [] as OutboxEntry[];
    const ids = rows.map((r) => r.id);
    const leaseUntil = new Date(Date.now() + LEASE_MS);
    await tx.$executeRaw`
      UPDATE "Outbox"
         SET status = 'processing', "lockedUntil" = ${leaseUntil}
       WHERE id = ANY(${ids}::text[])
    `;
    return tx.outbox.findMany({
      where: { id: { in: ids } },
      select: { id: true, topic: true, payload: true, attempts: true, idempotencyKey: true },
    });
  });

  // 3. Process each claimed row.
  let processed = 0;
  for (const entry of claimed) {
    const handler = handlers[entry.topic];
    try {
      if (!handler) throw new Error(`No handler for topic ${entry.topic}`);
      await handler(entry.payload as Record<string, unknown>, { idempotencyKey: entry.idempotencyKey });
      await prisma.outbox.update({
        where: { id: entry.id },
        data: { status: "dispatched", attempts: { increment: 1 }, lockedUntil: null },
      });
    } catch (err) {
      const attempts = entry.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.outbox.update({
        where: { id: entry.id },
        data: {
          status: failed ? "failed" : "pending",
          attempts,
          lockedUntil: null,
          // exponential backoff: 1m, 2m, 4m, 8m
          availableAt: new Date(Date.now() + 60_000 * 2 ** (attempts - 1)),
        },
      });
      console.error(`[outbox] ${entry.topic} attempt ${attempts} failed:`, err);
    }
    processed++;
  }
  return processed;
}
