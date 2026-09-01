import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  BLOB_AUTH_MISSING,
  blobStorageAuthenticated,
  checkProductionEnv,
  validateProductionEnv,
} from "@/server/config/env";

const goodProd = {
  NODE_ENV: "production",
  APP_SECRET: "x".repeat(32),
  APP_BASE_URL: "https://app.example.com",
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Seneschal <noreply@example.com>",
  STORAGE_DRIVER: "blob",
  BLOB_READ_WRITE_TOKEN: "vbt_test",
  CRON_SECRET: "cron-test",
} as unknown as NodeJS.ProcessEnv;

describe("checkProductionEnv", () => {
  it("passes a fully-configured prod env", () => {
    expect(checkProductionEnv(goodProd)).toEqual({ ok: true });
  });

  it("skips checks when NODE_ENV != production", () => {
    expect(checkProductionEnv({ ...goodProd, NODE_ENV: "development", APP_SECRET: "x" } as NodeJS.ProcessEnv)).toEqual({ ok: true });
  });

  const cases: [string, Partial<Record<string, string | undefined>>, string][] = [
    ["short APP_SECRET", { APP_SECRET: "tooshort" }, "APP_SECRET"],
    ["missing APP_SECRET", { APP_SECRET: undefined }, "APP_SECRET"],
    ["http APP_BASE_URL", { APP_BASE_URL: "http://app.example.com" }, "APP_BASE_URL"],
    ["missing APP_BASE_URL", { APP_BASE_URL: undefined }, "APP_BASE_URL"],
    ["console EMAIL_PROVIDER", { EMAIL_PROVIDER: "console" }, "EMAIL_PROVIDER"],
    ["missing RESEND_API_KEY", { RESEND_API_KEY: undefined }, "RESEND_API_KEY"],
    ["missing EMAIL_FROM", { EMAIL_FROM: undefined }, "EMAIL_FROM"],
    ["local STORAGE_DRIVER", { STORAGE_DRIVER: "local" }, "STORAGE_DRIVER"],
    ["missing blob credentials", { BLOB_READ_WRITE_TOKEN: undefined }, "Vercel Blob is not authenticated"],
    ["missing CRON_SECRET", { CRON_SECRET: undefined }, "CRON_SECRET"],
  ];

  for (const [name, override, expected] of cases) {
    it(`flags ${name}`, () => {
      const env = { ...goodProd, ...override } as NodeJS.ProcessEnv;
      const r = checkProductionEnv(env);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems.join("\n")).toContain(expected);
    });
  }
});

describe("validateProductionEnv", () => {
  it("throws in production on bad env", () => {
    const env = { ...goodProd, APP_SECRET: undefined } as NodeJS.ProcessEnv;
    expect(() => validateProductionEnv(env)).toThrow(/APP_SECRET/);
  });

  it("does not throw in dev even with bad env", () => {
    const env = { NODE_ENV: "development", APP_SECRET: "x" } as unknown as NodeJS.ProcessEnv;
    expect(() => validateProductionEnv(env)).not.toThrow();
  });

  it("does not throw in production on good env", () => {
    expect(() => validateProductionEnv(goodProd)).not.toThrow();
  });
});

describe("blobStorageAuthenticated", () => {
  it("accepts the static read-write token", () => {
    expect(blobStorageAuthenticated({ BLOB_READ_WRITE_TOKEN: "vbt_test" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("accepts a connected-store id without a static token (OIDC at runtime)", () => {
    expect(blobStorageAuthenticated({ BLOB_STORE_ID: "store_abc" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it("rejects blank or missing credentials", () => {
    expect(blobStorageAuthenticated({} as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(
      blobStorageAuthenticated({ BLOB_READ_WRITE_TOKEN: "  ", BLOB_STORE_ID: "" } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe("checkProductionEnv blob OIDC", () => {
  it("passes production when STORAGE_DRIVER=blob and only BLOB_STORE_ID is set", () => {
    const env = { ...goodProd, BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: "store_abc" } as NodeJS.ProcessEnv;
    expect(checkProductionEnv(env)).toEqual({ ok: true });
  });

  it("uses the attach-store message when blob has no credentials", () => {
    const env = { ...goodProd, BLOB_READ_WRITE_TOKEN: undefined } as NodeJS.ProcessEnv;
    const r = checkProductionEnv(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toContain(BLOB_AUTH_MISSING);
  });
});

const PREFLIGHT = "scripts/check-deploy-env.mjs";

function runPreflight(env: Record<string, string | undefined>) {
  const cleaned: Record<string, string> = {};
  if (process.env.PATH) cleaned.PATH = process.env.PATH;
  if (process.env.HOME) cleaned.HOME = process.env.HOME;
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) cleaned[k] = v;
  }
  return spawnSync(process.execPath, [PREFLIGHT], {
    encoding: "utf8",
    env: cleaned as unknown as NodeJS.ProcessEnv,
  });
}

const goodBuild = {
  VERCEL_ENV: "production",
  DATABASE_URL: "postgresql://seneschal:seneschal@localhost:5432/seneschal",
  APP_SECRET: "x".repeat(32),
  APP_BASE_URL: "https://app.example.com",
  EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Seneschal <noreply@example.com>",
  STORAGE_DRIVER: "blob",
  CRON_SECRET: "cron-test",
};

describe("check-deploy-env.mjs", () => {
  it("passes production when the store is connected via BLOB_STORE_ID (no static token)", () => {
    const r = runPreflight({ ...goodBuild, BLOB_STORE_ID: "store_abc" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("deploy env preflight passed");
  });

  it("still blocks production when STORAGE_DRIVER=blob and neither credential is present", () => {
    const r = runPreflight(goodBuild);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Vercel Blob is not authenticated");
    expect(r.stderr).not.toMatch(/^.*BLOB_READ_WRITE_TOKEN missing\s*$/m);
  });

  it("does not hard-fail preview: missing blob auth is a warning", () => {
    const r = runPreflight({ ...goodBuild, VERCEL_ENV: "preview" });
    expect(r.status).toBe(0);
    expect(r.stderr + r.stdout).toMatch(/Vercel Blob is not authenticated/);
  });
});
