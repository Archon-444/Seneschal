-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceType" ADD VALUE 'VIEWING_SCHEDULED';
ALTER TYPE "EvidenceType" ADD VALUE 'VIEWING_COMPLETED';

-- CreateTable
CREATE TABLE "Viewing" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "listingId" TEXT,
    "enquiryId" TEXT,
    "contactId" TEXT,
    "prospectName" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "ViewingStatus" NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Viewing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Viewing_workspaceId_status_idx" ON "Viewing"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Viewing_workspaceId_scheduledAt_idx" ON "Viewing"("workspaceId", "scheduledAt");
