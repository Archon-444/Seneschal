-- CreateEnum
CREATE TYPE "MoveInStatus" AS ENUM ('PENDING', 'PARTIALLY_ACKNOWLEDGED', 'COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceType" ADD VALUE 'MOVEIN_ACKNOWLEDGED';
ALTER TYPE "EvidenceType" ADD VALUE 'MOVEIN_COMPLETED';

-- CreateTable
CREATE TABLE "MoveIn" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tenancyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "MoveInStatus" NOT NULL DEFAULT 'PENDING',
    "landlordAckAt" TIMESTAMP(3),
    "tenantAckAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MoveIn_workspaceId_tenancyId_idx" ON "MoveIn"("workspaceId", "tenancyId");
