-- DropIndex
DROP INDEX "RiskFlag_workspaceId_scopeType_scopeId_code_status_key";

-- CreateIndex
CREATE INDEX "RiskFlag_workspaceId_scopeType_scopeId_code_idx" ON "RiskFlag"("workspaceId", "scopeType", "scopeId", "code");

-- H2: partial unique — at most one ACTIVE (OPEN|ACKNOWLEDGED) flag per code per
-- scope; CLEARED rows are history and may repeat. Prisma can't express filtered
-- indexes, so it's raw SQL — and because Prisma doesn't model them it won't drift
-- on this (a later `migrate dev` is a no-op, not a DROP). PRE-FLIGHT: on real data
-- this CREATE fails if duplicate active rows already exist — run
-- scripts/preflight-pr5.mjs first and resolve any rows it reports before deploy.
CREATE UNIQUE INDEX "RiskFlag_active_unique"
  ON "RiskFlag"("workspaceId", "scopeType", "scopeId", "code")
  WHERE "status" IN ('OPEN', 'ACKNOWLEDGED');

-- AddForeignKey
-- PRE-FLIGHT: fails on orphaned Tenancy.contractDocId (a value with no Document).
-- preflight-pr5.mjs reports those too; repoint or null them before deploy.
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_contractDocId_fkey" FOREIGN KEY ("contractDocId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
