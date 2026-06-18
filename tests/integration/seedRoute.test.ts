import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/v1/jobs/seed/route";

// H9 — the bootstrap seed endpoint is default-deny: it needs BOTH CRON_SECRET
// and SEED_API_ENABLED=true, so a leaked cron secret alone can't run it.

const SECRET = "test-cron-secret";
let savedSecret: string | undefined;
let savedEnabled: string | undefined;

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET;
  savedEnabled = process.env.SEED_API_ENABLED;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
  if (savedEnabled === undefined) delete process.env.SEED_API_ENABLED;
  else process.env.SEED_API_ENABLED = savedEnabled;
});

function post() {
  return POST(
    new NextRequest("http://localhost/api/v1/jobs/seed", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    }),
  );
}

describe("seed route gate (H9)", () => {
  it("401s with the correct secret but the flag unset", async () => {
    process.env.CRON_SECRET = SECRET;
    delete process.env.SEED_API_ENABLED;
    expect((await post()).status).toBe(401);
  });

  it("401s with the flag set but the wrong secret", async () => {
    process.env.CRON_SECRET = "a-different-secret";
    process.env.SEED_API_ENABLED = "true";
    expect((await post()).status).toBe(401);
  });
});
