-- AlterEnum
ALTER TYPE "EvidenceType" ADD VALUE 'NOTICE_SERVICE_RECORDED';

-- AlterEnum
ALTER TYPE "NoticeStatus" ADD VALUE 'SERVICE_RECORDED_PENDING_EVIDENCE';

-- DropIndex
DROP INDEX "Tenancy_renewsFromTenancyId_idx";

-- AlterTable
ALTER TABLE "Notice" ADD COLUMN     "attestation" TEXT,
ADD COLUMN     "attestedAt" TIMESTAMP(3),
ADD COLUMN     "attestedById" TEXT;

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "indexCaptureId" TEXT,
ADD COLUMN     "indexCitation" JSONB;

-- CreateIndex
-- PR-pilot P0-1: one successor tenancy per predecessor. Postgres allows many
-- NULLs under a unique index, so original (non-renewal) tenancies are unaffected.
-- PRE-FLIGHT: fails if a prior race already minted two successors for one
-- predecessor — resolve any such duplicate before deploy.
CREATE UNIQUE INDEX "Tenancy_renewsFromTenancyId_key" ON "Tenancy"("renewsFromTenancyId");

-- PR-pilot P0-1: partial unique indexes. Prisma can't express filtered indexes,
-- so these are raw SQL — and because Prisma doesn't model them it won't drift on
-- them (a later `migrate dev` is a no-op, not a DROP). The WHERE clauses mirror
-- the app's own invariants: TERMINAL = (RENEWED, DECLINED, LAPSED) in renewals.ts,
-- and exactly one ACCEPTED offer per case. PRE-FLIGHT: on real data each CREATE
-- fails if duplicate active rows already exist — resolve them before deploy.

-- At most one non-terminal RenewalCase per tenancy (the DB backstop for the
-- openRenewalCase idempotency guard under concurrency).
CREATE UNIQUE INDEX "RenewalCase_active_unique"
  ON "RenewalCase"("workspaceId", "tenancyId")
  WHERE "status" NOT IN ('RENEWED', 'DECLINED', 'LAPSED');

-- At most one ACCEPTED Offer per RenewalCase (the DB backstop for acceptOffer).
-- renewalCaseId is nullable (new-tenancy offers), and the filter only covers
-- ACCEPTED rows, so non-renewal and superseded offers are unaffected.
CREATE UNIQUE INDEX "Offer_one_accepted_per_case"
  ON "Offer"("renewalCaseId")
  WHERE "status" = 'ACCEPTED';
