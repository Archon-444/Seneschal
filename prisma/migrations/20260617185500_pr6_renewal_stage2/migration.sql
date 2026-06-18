-- CreateEnum
CREATE TYPE "IndexSource" AS ENUM ('SMART_RENTAL_INDEX_2025', 'RERA_INDEX_LEGACY', 'MANUAL_CONCIERGE');

-- CreateEnum
CREATE TYPE "NoticeKind" AS ENUM ('RENEWAL_CHANGE', 'NON_RENEWAL');

-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('GENERATED', 'APPROVED', 'SERVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ServiceMethod" AS ENUM ('EMAIL', 'COURIER', 'IN_PERSON', 'REGISTERED_POST', 'OTHER');

-- AlterEnum
ALTER TYPE "EvidenceType" ADD VALUE 'RENEWAL_COMPLETED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RiskCode" ADD VALUE 'PROPOSED_INCREASE_ABOVE_INDEX_BAND';
ALTER TYPE "RiskCode" ADD VALUE 'RENEWAL_NOTICE_WINDOW_MISSED';

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "permittedMaxSnapshot" DECIMAL(12,2),
ADD COLUMN     "proposedEndDate" TIMESTAMP(3),
ADD COLUMN     "proposedStartDate" TIMESTAMP(3),
ADD COLUMN     "responseDueDeadlineId" TEXT;

-- AlterTable
ALTER TABLE "RenewalCase" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "currentNoticeId" TEXT,
ADD COLUMN     "currentOfferId" TEXT,
ADD COLUMN     "indexCaptureId" TEXT,
ADD COLUMN     "proposedEndDate" TIMESTAMP(3),
ADD COLUMN     "proposedRent" DECIMAL(12,2),
ADD COLUMN     "proposedStartDate" TIMESTAMP(3),
ADD COLUMN     "renewedTenancyId" TEXT;

-- AlterTable
ALTER TABLE "RentIndexCapture" ADD COLUMN     "backfilledAt" TIMESTAMP(3),
ADD COLUMN     "calculatorVersion" TEXT,
ADD COLUMN     "comparableBasis" JSONB,
ADD COLUMN     "gapPct" DECIMAL(5,4),
ADD COLUMN     "indexSource" "IndexSource",
ADD COLUMN     "permittedNewRentMax" DECIMAL(12,2),
ADD COLUMN     "permittedPct" INTEGER,
ADD COLUMN     "sourceRef" JSONB;

-- AlterTable
ALTER TABLE "Tenancy" ADD COLUMN     "renewsFromTenancyId" TEXT;

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "renewalCaseId" TEXT NOT NULL,
    "kind" "NoticeKind" NOT NULL,
    "status" "NoticeStatus" NOT NULL DEFAULT 'GENERATED',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "servedAt" TIMESTAMP(3),
    "servedById" TEXT,
    "serviceMethod" "ServiceMethod",
    "serviceRef" TEXT,
    "docId" TEXT,
    "templateCode" TEXT,
    "templateVersion" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notice_workspaceId_renewalCaseId_idx" ON "Notice"("workspaceId", "renewalCaseId");

-- CreateIndex
CREATE INDEX "Notice_workspaceId_status_idx" ON "Notice"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalCase_renewedTenancyId_key" ON "RenewalCase"("renewedTenancyId");

-- CreateIndex
CREATE INDEX "Tenancy_renewsFromTenancyId_idx" ON "Tenancy"("renewsFromTenancyId");

-- AddForeignKey
ALTER TABLE "Tenancy" ADD CONSTRAINT "Tenancy_renewsFromTenancyId_fkey" FOREIGN KEY ("renewsFromTenancyId") REFERENCES "Tenancy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PR6 backfill (provenance-preserving). Mark pre-existing RentIndexCapture rows
-- with indexSource = MANUAL_CONCIERGE and stamp backfilledAt = now(). The computed
-- fields (gapPct, permittedPct, permittedNewRentMax, calculatorVersion) stay NULL
-- ON PURPOSE — recomputing them from decree43() against a reconstructed
-- historical rent would write a present-day assessment onto a row dated months
-- earlier, indistinguishable from a contemporaneous capture. That's a direct
-- violation of the append-only/provenance promise the capture row exists to
-- keep. UI MUST render rows with backfilledAt IS NOT NULL distinctly.
UPDATE "RentIndexCapture"
   SET "indexSource"  = 'MANUAL_CONCIERGE',
       "backfilledAt" = now()
 WHERE "indexSource" IS NULL;

