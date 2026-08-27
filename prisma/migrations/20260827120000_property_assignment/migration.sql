-- Agent book: one responsible member per property. ClientAssignment was client-wide
-- and leaked vacant sibling units of the same client.

CREATE TABLE "PropertyAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "backfilledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    CONSTRAINT "PropertyAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropertyAssignment_workspaceId_membershipId_idx" ON "PropertyAssignment"("workspaceId", "membershipId");
CREATE INDEX "PropertyAssignment_propertyId_idx" ON "PropertyAssignment"("propertyId");

-- Live-uniqueness: one responsible agent per property. Revoked rows are history.
CREATE UNIQUE INDEX "PropertyAssignment_live_property_unique"
    ON "PropertyAssignment"("propertyId")
    WHERE "revokedAt" IS NULL;

ALTER TABLE "PropertyAssignment" ADD CONSTRAINT "PropertyAssignment_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PropertyAssignment" ADD CONSTRAINT "PropertyAssignment_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: each live ClientAssignment becomes a PropertyAssignment for every current
-- property of that client. If two agents shared a client, the earliest assignment wins.
INSERT INTO "PropertyAssignment" ("id", "workspaceId", "membershipId", "propertyId", "assignedById", "assignedAt", "backfilledAt")
SELECT gen_random_uuid()::text, x."workspaceId", x."membershipId", x."propertyId", x."assignedById", x."assignedAt", NOW()
FROM (
  SELECT
    ca."workspaceId",
    ca."membershipId",
    p."id" AS "propertyId",
    ca."assignedById",
    ca."assignedAt",
    ROW_NUMBER() OVER (PARTITION BY p."id" ORDER BY ca."assignedAt" ASC, ca."id" ASC) AS rn
  FROM "ClientAssignment" ca
  INNER JOIN "Property" p
    ON p."workspaceId" = ca."workspaceId"
   AND p."clientPrincipalId" = ca."clientPrincipalId"
  WHERE ca."revokedAt" IS NULL
) x
WHERE x.rn = 1;

ALTER TABLE "ClientAssignment" DROP CONSTRAINT "ClientAssignment_membershipId_fkey";
DROP INDEX IF EXISTS "ClientAssignment_live_unique";
DROP INDEX IF EXISTS "ClientAssignment_workspaceId_membershipId_idx";
DROP TABLE "ClientAssignment";
