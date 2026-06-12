import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

// Outbox (T0.3): request handlers never execute side effects inline — they
// enqueue, the runner dispatches with retries.

export type OutboxTopic = "notification.send" | "risk.evaluate" | "payments.late_check";

type Db = Prisma.TransactionClient;

export async function enqueue(
  topic: OutboxTopic,
  payload: Record<string, unknown>,
  db: Db = prisma,
  availableAt?: Date,
) {
  return db.outbox.create({
    data: {
      topic,
      payload: payload as Prisma.InputJsonValue,
      availableAt: availableAt ?? new Date(),
    },
  });
}

const MAX_ATTEMPTS = 5;

export type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;

/** Dispatch one batch of due outbox entries. Returns number processed. */
export async function dispatchPending(
  handlers: Record<string, OutboxHandler>,
  batchSize = 20,
): Promise<number> {
  const due = await prisma.outbox.findMany({
    where: { status: "pending", availableAt: { lte: new Date() } },
    orderBy: { availableAt: "asc" },
    take: batchSize,
  });

  let processed = 0;
  for (const entry of due) {
    const handler = handlers[entry.topic];
    try {
      if (!handler) throw new Error(`No handler for topic ${entry.topic}`);
      await handler(entry.payload as Record<string, unknown>);
      await prisma.outbox.update({
        where: { id: entry.id },
        data: { status: "dispatched", attempts: { increment: 1 } },
      });
    } catch (err) {
      const attempts = entry.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.outbox.update({
        where: { id: entry.id },
        data: {
          status: failed ? "failed" : "pending",
          attempts,
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
