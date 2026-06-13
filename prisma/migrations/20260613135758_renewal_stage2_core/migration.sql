-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('ASSESSING', 'NOTICE_DUE', 'NOTICE_SERVED', 'NEGOTIATING', 'AGREED', 'RENEWED', 'DECLINED', 'LAPSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ScopeType" ADD VALUE 'RENEWAL_CASE';
ALTER TYPE "ScopeType" ADD VALUE 'OFFER';

-- CreateTable
CREATE TABLE "RentIndexCapture" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tenancyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "marketRentAvg" DECIMAL(12,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DLD Smart Rental Index',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "capturedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentIndexCapture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenewalCase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tenancyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "RenewalStatus" NOT NULL DEFAULT 'ASSESSING',
    "currentRentSnapshot" DECIMAL(12,2) NOT NULL,
    "noticeGateAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "renewalDate" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenewalCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentIndexCapture_workspaceId_tenancyId_idx" ON "RentIndexCapture"("workspaceId", "tenancyId");

-- CreateIndex
CREATE INDEX "RenewalCase_workspaceId_status_idx" ON "RenewalCase"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "RenewalCase_workspaceId_tenancyId_idx" ON "RenewalCase"("workspaceId", "tenancyId");
