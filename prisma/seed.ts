// CLI wrapper for the idempotent seed (T0.2). The seed itself lives in
// src/server/seed.ts so the protected /api/v1/jobs/seed route can run it
// in serverless deployments where this machine has no DB access.
import { runSeed } from "../src/server/seed";
import { prisma } from "../src/server/db";

runSeed()
  .then((result) => {
    console.log("\nSeed complete: demo workspaces ready.\n");

    console.log("Workspaces (one per type):");
    for (const w of result.workspaces) console.log(`  • ${w.name} [${w.type}]`);

    console.log("\nMember logins — recurring relationships (OTP prints to the worker/console log in dev):");
    for (const m of result.memberLogins) {
      console.log(`  • ${m.email.padEnd(32)} ${String(m.role).padEnd(16)} → ${m.home}`);
    }

    const links = [...result.linkUrls];
    if (result.proofLinkUrl) links.push({ label: "Agent proof upload (Marina cheque 4)", url: result.proofLinkUrl });
    if (links.length) {
      console.log("\nLink-party URLs — episodic counterparties, no account (open directly):");
      for (const l of links) console.log(`  • ${l.label}\n      ${l.url}`);
    }

    console.log("\nThe tenant is a LINK-PARTY, not a login: use the tenant offer/ID links above.");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
