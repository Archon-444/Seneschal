// Deploy preflight: fail the build with a readable message instead of a
// Prisma stack trace when required configuration is missing.
const required = {
  DATABASE_URL: "attach the Neon/Postgres integration or set it in Project → Settings → Environment Variables",
  APP_SECRET: "openssl rand -hex 32",
};

const missing = Object.entries(required).filter(([key]) => !process.env[key]);
if (missing.length > 0) {
  console.error("\n✖ Deploy blocked — missing environment variables:\n");
  for (const [key, hint] of missing) {
    console.error(`  ${key}  →  ${hint}`);
  }
  console.error("\nSee README → Deploy (Vercel) for the full table.\n");
  process.exit(1);
}

// WhatsApp is optional — unset means a safe console no-op; set all five to go live.
const recommended = [
  "EMAIL_PROVIDER",
  "STORAGE_DRIVER",
  "CRON_SECRET",
  "APP_BASE_URL",
  "WHATSAPP_PROVIDER",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
  "WHATSAPP_APP_SECRET",
];
for (const key of recommended) {
  if (!process.env[key]) {
    console.warn(`⚠ ${key} is not set — see README → Deploy (Vercel).`);
  }
}
console.log("✓ deploy env preflight passed");
