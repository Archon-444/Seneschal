-- AlterEnum
ALTER TYPE "ConsentPurpose" ADD VALUE 'PASSPORT_SHARING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceType" ADD VALUE 'PASSPORT_SHARED';
ALTER TYPE "EvidenceType" ADD VALUE 'PASSPORT_VIEWED';
ALTER TYPE "EvidenceType" ADD VALUE 'ENQUIRY_RECEIVED';

-- AlterEnum
ALTER TYPE "LinkPurpose" ADD VALUE 'PASSPORT_SHARE';
