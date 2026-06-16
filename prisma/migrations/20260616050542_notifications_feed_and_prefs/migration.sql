-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('DEADLINES', 'PAYMENTS', 'RENEWALS', 'PROOFS', 'RISK', 'DIGEST');

-- CreateEnum
CREATE TYPE "Cadence" AS ENUM ('IMMEDIATE', 'DAILY', 'WEEKLY', 'OFF');

-- AlterTable
ALTER TABLE "NotificationMessage" ADD COLUMN     "category" "NotificationCategory",
ADD COLUMN     "digestedAt" TIMESTAMP(3),
ADD COLUMN     "emailMessageId" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "cadence" "Cadence" NOT NULL DEFAULT 'DAILY',
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationPreference_workspaceId_userId_idx" ON "NotificationPreference"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_workspaceId_userId_category_key" ON "NotificationPreference"("workspaceId", "userId", "category");

-- CreateIndex
CREATE INDEX "NotificationMessage_workspaceId_toUserId_channel_readAt_idx" ON "NotificationMessage"("workspaceId", "toUserId", "channel", "readAt");

-- CreateIndex
CREATE INDEX "NotificationMessage_workspaceId_toUserId_digestedAt_idx" ON "NotificationMessage"("workspaceId", "toUserId", "digestedAt");
