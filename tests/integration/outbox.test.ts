import { beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { dispatchPending, enqueue, type OutboxHandler } from "@/server/outbox";
import { makeWorkspace, prisma, resetDb } from "../helpers";
import { deliverNotification, notify } from "@/server/notify";

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

// Issue #51, acceptance criterion 4 — the failure the atomic claim does NOT
// cover. Two workers can no longer take the same row, but a single worker can
// still send to the provider and then die before writing status = SENT. On the
// next dispatch the message is still QUEUED, so deliverNotification runs the
// send again.
//
// This is the honest shape of the guarantee: the local guard cannot close that
// window, so idempotency has to reach the provider. What these assert is that
// the retry carries the SAME key the first send used (Resend's Idempotency-Key
// / WhatsApp's biz_opaque_callback_data suppress the duplicate on their side),
// and that once the status flip does land, further dispatches are true no-ops.

describe("retry after provider send, before status update (#51)", () => {
  it("re-sends with the identical idempotency key, then stops once SENT lands", async () => {
    const W = await makeWorkspace("Crash WS");
    const user = await prisma.user.create({
      data: { email: "crash@test.example", name: "Crash" },
    });
    await prisma.membership.create({
      data: { workspaceId: W.workspaceId, userId: user.id, role: "FIDUCIARY" },
    });

    const message = await notify({
      workspaceId: W.workspaceId,
      channel: "EMAIL",
      templateCode: "proof_request_v1",
      subject: "Evidence requested",
      body: "Please upload the deposit slip.",
      toUserId: user.id,
    });

    const sends: { to: string; idempotencyKey: string | null | undefined }[] = [];
    let crashAfterSend = true;
    const handlers = {
      "notification.send": async (
        payload: Record<string, unknown>,
        ctx?: { idempotencyKey: string | null },
      ) => {
        // Stand in for the adapter: record the call, then simulate the process
        // dying between a successful provider send and the local status write.
        sends.push({ to: String(payload.messageId), idempotencyKey: ctx?.idempotencyKey });
        if (crashAfterSend) throw new Error("process died after provider accepted the send");
        await prisma.notificationMessage.update({
          where: { id: message.id },
          data: { status: "SENT", providerRef: "provider-ref-1" },
        });
      },
    };

    // attempt 1: provider accepted, we crashed before the status flip
    expect(await dispatchPending(handlers)).toBe(1);
    expect(sends).toHaveLength(1);
    expect(sends[0].idempotencyKey).toBe(`notification.send:${message.id}`);
    // the message is still QUEUED, which is exactly why the retry re-sends
    expect((await prisma.notificationMessage.findUnique({ where: { id: message.id } }))!.status)
      .toBe("QUEUED");

    // attempt 2: same outbox row, same key — the provider is what dedupes
    crashAfterSend = false;
    const row = await prisma.outbox.findFirst({ where: { topic: "notification.send" } });
    await prisma.outbox.update({ where: { id: row!.id }, data: { availableAt: new Date() } });
    expect(await dispatchPending(handlers)).toBe(1);
    expect(sends).toHaveLength(2);
    expect(sends[1].idempotencyKey).toBe(sends[0].idempotencyKey);

    // now SENT and dispatched — a further sweep must not send a third time
    expect((await prisma.notificationMessage.findUnique({ where: { id: message.id } }))!.status)
      .toBe("SENT");
    expect(await dispatchPending(handlers)).toBe(0);
    expect(sends).toHaveLength(2);
  });

  it("deliverNotification itself is a no-op once the message has left QUEUED", async () => {
    const W = await makeWorkspace("Guard WS");
    const user = await prisma.user.create({ data: { email: "guard@test.example", name: "Guard" } });
    await prisma.membership.create({
      data: { workspaceId: W.workspaceId, userId: user.id, role: "FIDUCIARY" },
    });
    const message = await notify({
      workspaceId: W.workspaceId,
      channel: "EMAIL",
      templateCode: "proof_request_v1",
      subject: "Evidence requested",
      body: "Please upload the deposit slip.",
      toUserId: user.id,
    });
    await prisma.notificationMessage.update({
      where: { id: message.id },
      data: { status: "SENT", providerRef: "already-sent" },
    });

    // No adapter is configured in tests, so reaching the send would throw.
    // Returning quietly is the proof that the QUEUED guard short-circuited.
    await expect(
      deliverNotification({ messageId: message.id }, { idempotencyKey: `notification.send:${message.id}` }),
    ).resolves.toBeUndefined();
    const after = await prisma.notificationMessage.findUnique({ where: { id: message.id } });
    expect(after!.providerRef).toBe("already-sent");
  });
});
