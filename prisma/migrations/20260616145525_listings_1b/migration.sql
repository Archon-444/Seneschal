-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceType" ADD VALUE 'LISTING_CREATED';
ALTER TYPE "EvidenceType" ADD VALUE 'LISTING_UPDATED';
ALTER TYPE "EvidenceType" ADD VALUE 'LISTING_PUBLISHED';
ALTER TYPE "EvidenceType" ADD VALUE 'LISTING_ARCHIVED';

-- AlterEnum
ALTER TYPE "ScopeType" ADD VALUE 'LISTING';

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "headline" TEXT,
    "askingRent" DECIMAL(12,2),
    "availableFrom" TIMESTAMP(3),
    "furnished" BOOLEAN,
    "description" TEXT,
    "permitRef" TEXT,
    "permitExpiry" TIMESTAMP(3),
    "readinessScore" INTEGER,
    "readiness" JSONB,
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Listing_workspaceId_status_idx" ON "Listing"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Listing_workspaceId_propertyId_idx" ON "Listing"("workspaceId", "propertyId");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
