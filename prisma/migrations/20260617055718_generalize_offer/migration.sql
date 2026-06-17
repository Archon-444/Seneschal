-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "listingId" TEXT,
ADD COLUMN     "prospectContactId" TEXT,
ALTER COLUMN "renewalCaseId" DROP NOT NULL,
ALTER COLUMN "tenancyId" DROP NOT NULL;
