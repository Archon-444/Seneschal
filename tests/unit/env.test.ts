import { describe, expect, it } from "vitest";
import { checkProductionEnv, validateProductionEnv } from "@/server/config/env";

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
    ["missing BLOB_READ_WRITE_TOKEN", { BLOB_READ_WRITE_TOKEN: undefined }, "BLOB_READ_WRITE_TOKEN"],
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
