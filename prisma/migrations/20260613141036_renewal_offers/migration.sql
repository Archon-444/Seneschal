-- CreateEnum
CREATE TYPE "OfferParty" AS ENUM ('LANDLORD', 'TENANT');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('SENT', 'COUNTERED', 'ACCEPTED', 'SUPERSEDED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "RenewalCase" ADD COLUMN     "decidedOfferId" TEXT,
ADD COLUMN     "noticeDocId" TEXT,
ADD COLUMN     "noticeServedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "renewalCaseId" TEXT NOT NULL,
    "tenancyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "party" "OfferParty" NOT NULL,
    "annualRent" DECIMAL(12,2) NOT NULL,
    "paymentSchedule" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "termMonths" INTEGER,
    "startDate" TIMESTAMP(3),
    "note" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'SENT',
    "createdById" TEXT,
    "viaSecureLinkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Offer_workspaceId_renewalCaseId_idx" ON "Offer"("workspaceId", "renewalCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_renewalCaseId_version_key" ON "Offer"("renewalCaseId", "version");
