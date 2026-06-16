-- CreateEnum
CREATE TYPE "PassportStatus" AS ENUM ('DRAFT', 'READY');

-- AlterEnum
ALTER TYPE "ScopeType" ADD VALUE 'TENANT_PASSPORT';

-- CreateTable
CREATE TABLE "TenantPassport" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "PassportStatus" NOT NULL DEFAULT 'DRAFT',
    "employer" TEXT,
    "jobTitle" TEXT,
    "monthlyIncome" DECIMAL(12,2),
    "nationality" TEXT,
    "householdSize" INTEGER,
    "moveInBy" TIMESTAMP(3),
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPassport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantPassport_workspaceId_contactId_key" ON "TenantPassport"("workspaceId", "contactId");
