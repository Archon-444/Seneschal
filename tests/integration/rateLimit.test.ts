import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma, resetDb } from "../helpers";
import { consumeRateLimit } from "@/server/services/rateLimit";

// H5/H8 durable rate limiter. The properties that matter: it caps within a
// window, it survives serverless cold starts (state in Postgres, not memory),
// and the increment is atomic under concurrency.

beforeEach(async () => {
  await resetDb();
});

describe("consumeRateLimit", () => {
  it("caps at the limit within a window and reports remaining", async () => {
    const key = "test:count-cap";
    const seen: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push((await consumeRateLimit(key, 3, 60_000)).ok);
    }
    // first 3 ok, then rejected
    expect(seen).toEqual([true, true, true, false, false]);
    const last = await consumeRateLimit(key, 3, 60_000);
    expect(last).toMatchObject({ ok: false, remaining: 0 });
  });

  it("is durable across simulated serverless cold starts (fresh client each call)", async () => {
    const url =
      process.env.TEST_DATABASE_URL ?? "postgresql://seneschal:seneschal@localhost:5432/seneschal_test";
    const key = "test:cold-start";
    const clients: PrismaClient[] = [];
    try {
      const results: boolean[] = [];
      for (let i = 0; i < 4; i++) {
        // a brand-new client per call models a fresh lambda invocation — an
        // in-memory limiter would reset to zero here and never trip.
        const c = new PrismaClient({ datasources: { db: { url } } });
        clients.push(c);
        results.push((await consumeRateLimit(key, 2, 60_000, c)).ok);
      }
      expect(results).toEqual([true, true, false, false]);
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()));
    }
  });

  it("is atomic: concurrent hits on one key admit exactly `limit`", async () => {
    const key = "test:concurrent";
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeRateLimit(key, 10, 60_000)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    const row = await prisma.rateLimit.findUnique({ where: { key } });
    expect(row!.count).toBe(20); // every hit counted; only the first 10 were ok
  });

  it("rolls the window: a hit after the window expires resets the count", async () => {
    const key = "test:window-roll";
    expect((await consumeRateLimit(key, 1, 40)).ok).toBe(true);
    expect((await consumeRateLimit(key, 1, 40)).ok).toBe(false); // still in window
    await new Promise((r) => setTimeout(r, 60)); // window (40ms) elapses
    expect((await consumeRateLimit(key, 1, 40)).ok).toBe(true); // fresh window
  });
});
