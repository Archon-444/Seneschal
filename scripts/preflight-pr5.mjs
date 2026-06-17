// Pre-flight for the PR5 schema-hygiene migration (riskflag_partial_unique).
//
// Both changes can fail on real data, AFTER the migration has partially run:
//   1. The partial unique index errors if a (workspace, scope, code) already has
//      more than one ACTIVE (OPEN|ACKNOWLEDGED) RiskFlag.
//   2. The contractDocId FK errors if any Tenancy.contractDocId points at a
//      Document that doesn't exist (orphan).
//
// Run this against the target DB BEFORE `prisma migrate deploy`. It only reads;
// it resolves nothing. If it reports rows, fix them (clear/merge the duplicate
// flags; repoint or NULL the orphaned contractDocId) and re-run until clean.
//
//   DATABASE_URL=<target> node scripts/preflight-pr5.mjs
//
// CI runs it against the fixture-seeded test DB so a regression that reintroduces
// duplicate active flags or orphan refs is caught before it reaches staging.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  let bad = 0;

  const dupes = await prisma.$queryRaw`
    SELECT "workspaceId", "scopeType", "scopeId", "code", count(*)::int AS n
      FROM "RiskFlag"
     WHERE "status" IN ('OPEN', 'ACKNOWLEDGED')
     GROUP BY "workspaceId", "scopeType", "scopeId", "code"
    HAVING count(*) > 1
  `;
  if (dupes.length > 0) {
    bad += dupes.length;
    console.error(`✖ ${dupes.length} (workspace, scope, code) group(s) have >1 active RiskFlag:`);
    for (const d of dupes) {
      console.error(`    ${d.workspaceId} ${d.scopeType}:${d.scopeId} ${d.code} → ${d.n} active`);
    }
    console.error("  Resolve: keep one active flag per group, clear the rest.\n");
  }

  const orphans = await prisma.$queryRaw`
    SELECT t."id", t."contractDocId"
      FROM "Tenancy" t
      LEFT JOIN "Document" d ON d."id" = t."contractDocId"
     WHERE t."contractDocId" IS NOT NULL AND d."id" IS NULL
  `;
  if (orphans.length > 0) {
    bad += orphans.length;
    console.error(`✖ ${orphans.length} Tenancy row(s) have a contractDocId with no Document:`);
    for (const o of orphans) {
      console.error(`    tenancy ${o.id} → missing document ${o.contractDocId}`);
    }
    console.error("  Resolve: repoint to the real Document, or set contractDocId = NULL.\n");
  }

  if (bad > 0) {
    console.error(`Pre-flight FAILED: ${bad} blocking row(s). Migration would error mid-apply.`);
    process.exit(1);
  }
  console.log("✓ Pre-flight clean: no duplicate active flags, no orphaned contract docs.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
