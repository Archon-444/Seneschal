// CLI wrapper for the idempotent seed (T0.2). The seed itself lives in
// src/server/seed.ts so the protected /api/v1/jobs/seed route can run it
// in serverless deployments where this machine has no DB access.
import { runSeed } from "../src/server/seed";
import { prisma } from "../src/server/db";

runSeed()
  .then((result) => {
    if (result.proofLinkUrl) {
      console.log(`\nSeeded live proof-upload link: ${result.proofLinkUrl}\n`);
    }
    console.log("Seed complete: demo workspace ready.");
    console.log("Sign in as operator@example.com (OTP appears in the worker/console log in dev).");
    console.log("Tenant portal:   r.fernandes@example.com → /portal");
    console.log("Landlord portal: owner@example.com → /portal");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
