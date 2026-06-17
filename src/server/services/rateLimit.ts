import { Prisma } from "@prisma/client";
import { prisma } from "../db";

// Durable, atomic rate limiter (H5/H8). The whole point is that it survives
// serverless cold starts (state in Postgres, not process memory) AND that the
// increment is a single atomic statement, so concurrent hits on one key can't
// read-modify-write past each other — the same TOCTOU class H4 closed.

export interface RateLimitResult {
  /** false once the window's count has exceeded `limit`. */
  ok: boolean;
  count: number;
  remaining: number;
}

/**
 * Consume one hit against `key` in a fixed window of `windowMs`.
 *
 * One `INSERT … ON CONFLICT DO UPDATE … RETURNING` does the whole thing: insert
 * the first hit, or atomically roll the window (reset to 1 when expired) / bump
 * the count (when live). No separate SELECT — a read-then-write would reopen the
 * race. Fixed window is the deliberate pilot-scale choice: one cheap row per
 * key, at the cost of allowing up to a 2× burst straddling the window boundary.
 * A sliding window would be exact but needs unbounded per-hit rows + pruning.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  db: Prisma.TransactionClient = prisma,
): Promise<RateLimitResult> {
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count", "updatedAt")
    VALUES (${key}, now(), 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN now() - "RateLimit"."windowStart" > ${windowMs} * interval '1 millisecond'
          THEN 1
          ELSE "RateLimit"."count" + 1
      END,
      "windowStart" = CASE
        WHEN now() - "RateLimit"."windowStart" > ${windowMs} * interval '1 millisecond'
          THEN now()
          ELSE "RateLimit"."windowStart"
      END,
      "updatedAt" = now()
    RETURNING "count"
  `;
  const count = Number(rows[0]?.count ?? 1);
  return { ok: count <= limit, count, remaining: Math.max(0, limit - count) };
}
