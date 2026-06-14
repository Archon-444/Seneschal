-- CreateTable
CREATE TABLE "RentIndexBenchmark" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "community" TEXT NOT NULL,
    "building" TEXT,
    "marketRentAvg" DECIMAL(12,2) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DLD Smart Rental Index',
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "capturedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentIndexBenchmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentIndexBenchmark_workspaceId_community_building_idx" ON "RentIndexBenchmark"("workspaceId", "community", "building");
