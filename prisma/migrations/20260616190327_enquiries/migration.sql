-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'ENQUIRIES';

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "listingId" TEXT,
    "propertyId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "message" TEXT,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT,
    "secureLinkId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Enquiry_workspaceId_status_idx" ON "Enquiry"("workspaceId", "status");
