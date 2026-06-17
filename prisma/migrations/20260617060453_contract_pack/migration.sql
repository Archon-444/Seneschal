-- CreateEnum
CREATE TYPE "ContractPackStatus" AS ENUM ('GENERATED', 'SENT_FOR_SIGNATURE', 'SIGNED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceType" ADD VALUE 'CONTRACT_PACK_GENERATED';
ALTER TYPE "EvidenceType" ADD VALUE 'CONTRACT_PACK_SENT';
ALTER TYPE "EvidenceType" ADD VALUE 'CONTRACT_PACK_SIGNED';

-- CreateTable
CREATE TABLE "ContractPack" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "listingId" TEXT,
    "propertyId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "status" "ContractPackStatus" NOT NULL DEFAULT 'GENERATED',
    "eSignRef" TEXT,
    "sentAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractPack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractPack_workspaceId_offerId_idx" ON "ContractPack"("workspaceId", "offerId");
