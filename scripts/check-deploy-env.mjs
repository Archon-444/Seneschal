// Deploy preflight: fail the build with a readable message instead of a
// Prisma stack trace (or a silently-misconfigured runtime) when required
// configuration is missing.
//
// The hard-fail set mirrors the runtime boot gate `checkProductionEnv`
// (`src/server/config/env.ts`) so the deploy-time signal matches what the
// running app enforces — a deploy that would fail closed at first cold start
// is rejected here first. The two must stay in sync; that file is the spec.
//
// Production gating uses NODE_ENV, exactly as the runtime validator does.
// Vercel sets NODE_ENV=production for deploy builds, so the strong checks fire
// on every real deploy; a local `pnpm vercel-build` (NODE_ENV unset) keeps them
// as warnings so it doesn't false-fail without prod secrets present.

const MIN_SECRET_LEN = 32;
const isProd = process.env.NODE_ENV === "production";
const env = process.env;
const problems = [];

// Always required — without these the build itself (migrate deploy) can't run.
if (!env.DATABASE_URL) {
  problems.push(
    "DATABASE_URL missing — attach the Neon/Postgres integration or set it in Project → Settings → Environment Variables",
  );
}
if (!env.APP_SECRET || env.APP_SECRET.length < MIN_SECRET_LEN) {
  problems.push(`APP_SECRET missing or shorter than ${MIN_SECRET_LEN} chars (openssl rand -hex 32)`);
}

// Production-critical — mirrors checkProductionEnv. Hard-fail on a prod deploy;
// downgraded to a warning otherwise so local builds aren't blocked.
const prodProblems = [];
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
} else if (!env.BLOB_READ_WRITE_TOKEN) {
  prodProblems.push("BLOB_READ_WRITE_TOKEN missing");
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

// WhatsApp is genuinely optional — unset means a safe console no-op (the runtime
// validator doesn't enforce it either). Set all five to go live via the Meta
// Cloud API adapter; warn so a partial config is visible.
const whatsapp = [
  "WHATSAPP_PROVIDER",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
];
for (const key of whatsapp) {
  if (!env[key]) console.warn(`⚠ ${key} is not set — WhatsApp stays a console no-op. See README → Deploy (Vercel).`);
}

console.log("✓ deploy env preflight passed");
