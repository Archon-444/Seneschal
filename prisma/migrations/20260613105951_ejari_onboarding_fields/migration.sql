-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "emiratesId" TEXT,
ADD COLUMN     "licenseNo" TEXT,
ADD COLUMN     "licensingAuthority" TEXT,
ADD COLUMN     "nationality" TEXT;

-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "dewaPremiseNo" TEXT,
ADD COLUMN     "makaniNo" TEXT,
ADD COLUMN     "plotNo" TEXT,
ADD COLUMN     "sizeSqm" DECIMAL(10,2),
ADD COLUMN     "usage" TEXT;
