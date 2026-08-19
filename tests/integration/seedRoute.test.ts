import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../helpers";
import { POST } from "@/app/api/v1/jobs/seed/route";

// H9 — the bootstrap seed endpoint is default-deny: it needs BOTH CRON_SECRET
// and SEED_API_ENABLED=true, so a leaked cron secret alone can't run it.

const SECRET = "test-cron-secret";
let savedSecret: string | undefined;
let savedEnabled: string | undefined;

beforeEach(async () => {
  await resetDb();
  savedSecret = process.env.CRON_SECRET;
  savedEnabled = process.env.SEED_API_ENABLED;
});
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
  if (savedEnabled === undefined) delete process.env.SEED_API_ENABLED;
  else process.env.SEED_API_ENABLED = savedEnabled;
});

function post(headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) {
  return POST(
    new NextRequest("http://localhost/api/v1/jobs/seed", { method: "POST", headers }),
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

  // #57 — the two branches the original pair left uncovered. Without the
  // positive case, a gate that rejected everything would pass this file; without
  // the unset-secret case, `!secret` is untested and a deployment that simply
  // never set CRON_SECRET would be the one nobody checked.
  it("401s when CRON_SECRET is unset, even with the flag on and a Bearer header", async () => {
    delete process.env.CRON_SECRET;
    process.env.SEED_API_ENABLED = "true";
    expect((await post()).status).toBe(401);
    // an empty secret must not be satisfiable by an empty Bearer either
    expect((await post({ authorization: "Bearer " })).status).toBe(401);
    expect((await post({ authorization: "Bearer undefined" })).status).toBe(401);
  });

  it("runs the seed when the flag is on and the secret matches", async () => {
    process.env.CRON_SECRET = SECRET;
    process.env.SEED_API_ENABLED = "true";
    const res = await post();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; signInAs?: string };
    expect(body.ok).toBe(true);
    // NODE_ENV is "test" here, so the convenience field is present; the
    // production branch withholds it (route.ts) and is asserted below.
    expect(body.signInAs).toBeTruthy();
  });

  it("withholds the sign-in identity from the production response", async () => {
    process.env.CRON_SECRET = SECRET;
    process.env.SEED_API_ENABLED = "true";
    const savedNodeEnv = process.env.NODE_ENV;
    // NODE_ENV is read-only in the Node types but writable at runtime
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      const body = (await (await post()).json()) as { ok: boolean; signInAs?: string };
      expect(body.ok).toBe(true);
      expect(body.signInAs).toBeUndefined();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
    }
  });
});
