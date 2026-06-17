// H6: production environment hard-fail.
//
// `crypto.ts` only throws on missing `APP_SECRET`, and only on first use.
// Email defaults to console, storage defaults to local, base URL defaults to
// localhost, CRON_SECRET is checked only on cron requests. The net effect is a
// prod deployment can boot, accept traffic, and silently swallow OTP emails or
// drop documents on a non-persistent disk before anyone notices.
//
// This validator is the single boot gate. Called from `instrumentation.ts`
// `register()` — runs once per cold start, so misconfigured prod deploys never
// serve a request. Build-time is the wrong place: Vercel injects runtime env
// separately, and a build-time check false-fails when prod vars legitimately
// aren't present during `next build`.

export type EnvCheck = { ok: true } | { ok: false; problems: string[] };

const MIN_SECRET_LEN = 32;

export function checkProductionEnv(env: NodeJS.ProcessEnv = process.env): EnvCheck {
  if (env.NODE_ENV !== "production") return { ok: true };

  const problems: string[] = [];

  const appSecret = env.APP_SECRET;
  if (!appSecret || appSecret.length < MIN_SECRET_LEN) {
    problems.push(`APP_SECRET missing or shorter than ${MIN_SECRET_LEN} chars`);
  }

  const baseUrl = env.APP_BASE_URL;
  if (!baseUrl || !baseUrl.startsWith("https://")) {
    problems.push("APP_BASE_URL must be set to an https:// URL");
  }

  if (env.EMAIL_PROVIDER !== "resend") {
    problems.push('EMAIL_PROVIDER must be "resend" in production (console adapter silently drops mail)');
  } else {
    if (!env.RESEND_API_KEY) problems.push("RESEND_API_KEY missing");
    if (!env.EMAIL_FROM) problems.push("EMAIL_FROM missing");
  }

  if (env.STORAGE_DRIVER !== "blob") {
    problems.push('STORAGE_DRIVER must be "blob" in production (local disk is not persistent on Vercel)');
  } else if (!env.BLOB_READ_WRITE_TOKEN) {
    problems.push("BLOB_READ_WRITE_TOKEN missing");
  }

  if (!env.CRON_SECRET) problems.push("CRON_SECRET missing");

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * Throws in production if any env var is missing or weak. Warns in dev.
 * Call from `instrumentation.ts` `register()`.
 */
export function validateProductionEnv(env: NodeJS.ProcessEnv = process.env): void {
  const result = checkProductionEnv(env);
  if (result.ok) return;
  const message = `Production env validation failed:\n  - ${result.problems.join("\n  - ")}`;
  if (env.NODE_ENV === "production") {
    throw new Error(message);
  }
  console.warn(`[env] ${message}`);
}
