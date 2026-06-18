import { beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { dispatchPending, enqueue, type OutboxHandler } from "@/server/outbox";
import { prisma, resetDb } from "../helpers";

// H1 — atomic outbox claim. Two-worker concurrent dispatch must surface each
// row exactly once (SKIP LOCKED gives disjoint sets), crashed leases must
// recover on the next claim, and duplicate enqueues by the same idempotency
// key must be rejected at the DB.

beforeEach(async () => {
  await resetDb();
});

describe("dispatchPending — atomic claim", () => {
  it("two concurrent workers each handle a row exactly once", async () => {
    const N = 20;
    for (let i = 0; i < N; i++) {
      await enqueue("risk.evaluate", { i });
    }

    // Independent Prisma clients == two real workers, not a shared pool.
    const workerB = new PrismaClient();
    try {
      const seenA: number[] = [];
      const seenB: number[] = [];

      const handlersA: Record<string, OutboxHandler> = {
        "risk.evaluate": async (p) => { seenA.push(p.i as number); },
      };
      const handlersB: Record<string, OutboxHandler> = {
        "risk.evaluate": async (p) => { seenB.push(p.i as number); },
      };

      // Worker B runs against its own client; rebind dispatchPending to it.
      const dispatchOnB = async () => {
        // Mirror the logic in dispatchPending but on workerB's client.
        await workerB.$executeRaw`
          UPDATE "Outbox" SET status = 'pending', "lockedUntil" = NULL
           WHERE status = 'processing' AND "lockedUntil" < now()
        `;
        const entries = await workerB.$transaction(async (tx) => {
          const rows = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM "Outbox"
             WHERE status = 'pending' AND "availableAt" <= now()
             ORDER BY "availableAt" ASC LIMIT 20 FOR UPDATE SKIP LOCKED
          `;
          if (!rows.length) return [];
          const ids = rows.map((r) => r.id);
          await tx.$executeRaw`
            UPDATE "Outbox" SET status = 'processing',
                              "lockedUntil" = ${new Date(Date.now() + 60_000)}
             WHERE id = ANY(${ids}::text[])
          `;
          return tx.outbox.findMany({ where: { id: { in: ids } } });
        });
        for (const e of entries) {
          await handlersB["risk.evaluate"]!(e.payload as Record<string, unknown>, { idempotencyKey: null });
          await workerB.outbox.update({
            where: { id: e.id },
            data: { status: "dispatched", attempts: { increment: 1 }, lockedUntil: null },
          });
        }
        return entries.length;
      };

      const [countA, countB] = await Promise.all([
        dispatchPending(handlersA),
        dispatchOnB(),
      ]);

      expect(countA + countB).toBe(N);
      const all = [...seenA, ...seenB].sort((a, b) => a - b);
      expect(all).toEqual(Array.from({ length: N }, (_, i) => i));
      // Disjoint — no row dispatched twice.
      expect(new Set(seenA).size + new Set(seenB).size).toBe(N);

      const final = await prisma.outbox.findMany();
      expect(final.every((r) => r.status === "dispatched")).toBe(true);
    } finally {
      await workerB.$disconnect();
    }
  });

  it("recovers crashed leases on the next claim", async () => {
    const row = await enqueue("risk.evaluate", { x: 1 });
    // Simulate a worker that claimed but crashed before completion.
    await prisma.outbox.update({
      where: { id: row.id },
      data: {
        status: "processing",
        lockedUntil: new Date(Date.now() - 60_000),
      },
    });

    const seen: number[] = [];
    await dispatchPending({
      "risk.evaluate": async (p) => { seen.push(p.x as number); },
    });
    expect(seen).toEqual([1]);
    const after = await prisma.outbox.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe("dispatched");
    expect(after?.lockedUntil).toBeNull();
  });

  it("does not claim a fresh (unexpired) lease held by another worker", async () => {
    const row = await enqueue("risk.evaluate", { x: 1 });
    await prisma.outbox.update({
      where: { id: row.id },
      data: { status: "processing", lockedUntil: new Date(Date.now() + 60_000) },
    });

    const seen: number[] = [];
    await dispatchPending({
      "risk.evaluate": async (p) => { seen.push(p.x as number); },
    });
    expect(seen).toEqual([]);
  });
});

describe("enqueue — provider idempotency", () => {
  it("rejects a duplicate enqueue with the same (topic, idempotencyKey)", async () => {
    await enqueue("notification.send", { messageId: "m1" }, prisma, {
      idempotencyKey: "notification.send:m1",
    });
    await expect(
      enqueue("notification.send", { messageId: "m1" }, prisma, {
        idempotencyKey: "notification.send:m1",
      }),
    ).rejects.toThrow();
  });

  it("allows multiple enqueues with null idempotencyKey (Postgres treats NULLs as distinct)", async () => {
    await enqueue("risk.evaluate", { workspaceId: "a" });
    await enqueue("risk.evaluate", { workspaceId: "a" });
    const rows = await prisma.outbox.count({ where: { topic: "risk.evaluate" } });
    expect(rows).toBe(2);
  });

  it("passes the idempotency key to the handler via ctx", async () => {
    await enqueue("notification.send", { messageId: "m2" }, prisma, {
      idempotencyKey: "notification.send:m2",
    });
    let received: string | null = "unset";
    await dispatchPending({
      "notification.send": async (_p, ctx) => { received = ctx.idempotencyKey; },
    });
    expect(received).toBe("notification.send:m2");
  });
});
