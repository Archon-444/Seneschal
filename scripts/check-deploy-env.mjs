// Deploy preflight: fail the build with a readable message instead of a
// Prisma stack trace (or a silently-misconfigured runtime) when required
// configuration is missing.
//
// The hard-fail set mirrors the runtime boot gate `checkProductionEnv`
// (`src/server/config/env.ts`) so the deploy-time signal matches what the
// running app enforces — a deploy that would fail closed at first cold start
// is rejected here first. The two must stay in sync; that file is the spec.
//
// Production gating uses VERCEL_ENV, NOT NODE_ENV. Vercel sets
// NODE_ENV=production for *every* deploy build including previews, so gating on
// it would hard-fail a preview that legitimately lacks production-only config
// (an https APP_BASE_URL, a Blob token, etc). VERCEL_ENV is "production" only
// for a real production deploy. Off Vercel (VERCEL_ENV unset) we fall back to
// NODE_ENV so a non-Vercel production build is still gated, while a local
// `pnpm vercel-build` (neither set) keeps the prod checks as warnings.

function present(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Keep in sync with blobStorageAuthenticated() in src/server/config/env.ts.
function blobStorageAuthenticated(env) {
  return present(env.BLOB_READ_WRITE_TOKEN) || present(env.BLOB_STORE_ID);
}

const MIN_SECRET_LEN = 32;
const env = process.env;
const isProd = env.VERCEL_ENV ? env.VERCEL_ENV === "production" : env.NODE_ENV === "production";
const problems = [];

// Always required — without these the build itself (migrate deploy) can't run.
if (!env.DATABASE_URL) {
  problems.push(
    "DATABASE_URL missing — attach the Neon/Postgres integration or set it in Project → Settings → Environment Variables",
  );
}
// APP_SECRET presence is always required; the length floor mirrors
// checkProductionEnv, which only enforces it in production (dev/.env.example use
// a short placeholder), so it lives in the prod-gated block below.
if (!env.APP_SECRET) {
  problems.push("APP_SECRET missing (openssl rand -hex 32)");
}

// Production-critical — mirrors checkProductionEnv. Hard-fail on a prod deploy;
// downgraded to a warning otherwise so local/preview builds aren't blocked.
const prodProblems = [];
if (env.APP_SECRET && env.APP_SECRET.length < MIN_SECRET_LEN) {
  prodProblems.push(`APP_SECRET shorter than ${MIN_SECRET_LEN} chars (openssl rand -hex 32)`);
}
if (!env.APP_BASE_URL || !env.APP_BASE_URL.startsWith("https://")) {
  prodProblems.push("APP_BASE_URL must be set to an https:// URL (used in emails + secure links)");
}
if (env.EMAIL_PROVIDER !== "resend") {
  prodProblems.push('EMAIL_PROVIDER must be "resend" in production (console adapter silently drops mail)');
} else {
  if (!env.RESEND_API_KEY) prodProblems.push("RESEND_API_KEY missing");
  if (!env.EMAIL_FROM) prodProblems.push("EMAIL_FROM missing");
}
if (env.STORAGE_DRIVER !== "blob") {
  prodProblems.push('STORAGE_DRIVER must be "blob" in production (local disk is not persistent on Vercel)');
} else if (!blobStorageAuthenticated(env)) {
  // Keep in sync with blobStorageAuthenticated / BLOB_AUTH_MISSING in src/server/config/env.ts.
  // OIDC stores inject BLOB_STORE_ID at build; VERCEL_OIDC_TOKEN only at runtime.
  prodProblems.push(
    "Vercel Blob is not authenticated. Create a private Blob store (Project → Storage → Create Database → Blob) and connect it to Production. Connected stores inject BLOB_STORE_ID (OIDC; VERCEL_OIDC_TOKEN is runtime-only) and/or BLOB_READ_WRITE_TOKEN. STORAGE_DRIVER=blob is set but neither credential is present.",
  );
}
if (!env.CRON_SECRET) prodProblems.push("CRON_SECRET missing (auth for the cron route)");

if (isProd) {
  problems.push(...prodProblems);
} else {
  for (const p of prodProblems) console.warn(`⚠ ${p}`);
}

if (problems.length > 0) {
  console.error("\n✖ Deploy blocked — environment validation failed:\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nSee README → Deploy (Vercel) for the full table.\n");
  process.exit(1);
}

// WhatsApp is optional. Outbound leaves the console no-op when
// whatsappConfigured() is true (provider=meta + phone id + access token).
// VERIFY_TOKEN / APP_SECRET only secure the webhook; missing them does not
// keep outbound as a no-op. Warn so a partial config is visible.
const outboundWhatsApp = ["WHATSAPP_PROVIDER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"];
const webhookWhatsApp = ["WHATSAPP_VERIFY_TOKEN", "WHATSAPP_APP_SECRET"];
for (const key of outboundWhatsApp) {
  if (!env[key]) {
    console.warn(
      `⚠ ${key} is not set — outbound WhatsApp stays a console no-op (whatsappConfigured). See docs/whatsapp-readiness.md.`,
    );
  }
}
for (const key of webhookWhatsApp) {
  if (!env[key]) {
    console.warn(
      `⚠ ${key} is not set — the WhatsApp webhook is not fully secured (GET handshake / POST HMAC). Outbound may still send if the three delivery vars are set. See docs/whatsapp-readiness.md.`,
    );
  }
}

console.log("✓ deploy env preflight passed");
