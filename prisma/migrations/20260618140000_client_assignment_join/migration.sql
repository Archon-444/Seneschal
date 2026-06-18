-- F-Admin Phase 4 (D3): delegate scope moves from Membership.assignedClientIds[] to an
-- audited ClientAssignment join — an assignment is a delegation ACT and needs a record.

CREATE TABLE "ClientAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "clientPrincipalId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "backfilledAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    CONSTRAINT "ClientAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientAssignment_workspaceId_membershipId_idx" ON "ClientAssignment"("workspaceId", "membershipId");

-- Live-uniqueness: one non-revoked assignment per (membership, client). Revoked rows are
-- history and may repeat → PARTIAL unique (raw SQL; Prisma can't express it, won't drift).
CREATE UNIQUE INDEX "ClientAssignment_live_unique"
    ON "ClientAssignment"("membershipId", "clientPrincipalId")
    WHERE "revokedAt" IS NULL;

ALTER TABLE "ClientAssignment" ADD CONSTRAINT "ClientAssignment_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Parity backfill: every existing array entry becomes a LIVE assignment so no delegate loses
-- access on deploy. Provenance is NOT fabricated — assignedById is NULL and backfilledAt marks
-- the row as pre-audit ("this access exists; we have no record of who granted it"). assignedAt
-- is the migration time, not a made-up original date.
INSERT INTO "ClientAssignment" ("id", "workspaceId", "membershipId", "clientPrincipalId", "assignedById", "assignedAt", "backfilledAt")
SELECT gen_random_uuid()::text, m."workspaceId", m."id", c, NULL, NOW(), NOW()
  FROM "Membership" m, unnest(m."assignedClientIds") AS c;

-- Single source of truth: the array is gone. resolveClientScopeIds reads the live join rows.
ALTER TABLE "Membership" DROP COLUMN "assignedClientIds";
