-- AlterEnum
ALTER TYPE "EvidenceType" ADD VALUE 'LANDLORD_VERIFIED';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;
