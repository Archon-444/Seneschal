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

const recommended = ["EMAIL_PROVIDER", "STORAGE_DRIVER", "CRON_SECRET", "APP_BASE_URL"];
for (const key of recommended) {
  if (!process.env[key]) {
    console.warn(`⚠ ${key} is not set — see README → Deploy (Vercel).`);
  }
}
console.log("✓ deploy env preflight passed");
