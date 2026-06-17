-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MANAGING_AGENT';

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "assignedClientIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
