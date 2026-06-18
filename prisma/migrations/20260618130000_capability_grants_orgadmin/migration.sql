-- F-Admin Phase 1 (D1): the decorrelated capability foundation.

-- ORG_ADMIN: a people/config role that holds ZERO data capabilities — the office manager
-- who onboards staff and wires delegate assignments but cannot open a tenancy. (Adding an
-- enum value is allowed in a transaction in PG12+; it is not USED in this migration, so the
-- block commits cleanly — same pattern as the MANAGING_AGENT migration.)
ALTER TYPE "Role" ADD VALUE 'ORG_ADMIN';

-- Grantable capability bundles, unioned over the role map. CREATE TYPE is fully
-- transactional, so the new type may be used by the table below in the same migration.
CREATE TYPE "Bundle" AS ENUM ('PRINCIPAL', 'ORG_ADMIN', 'DELEGATE', 'CLIENT_VIEWER');

-- Audited per-membership grants. EMPTY on deploy → every existing membership's effective
-- capabilities are byte-identical (parity is trivial; no backfill, no recompute).
CREATE TABLE "MembershipGrant" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "bundle" "Bundle" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    CONSTRAINT "MembershipGrant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MembershipGrant_membershipId_idx" ON "MembershipGrant"("membershipId");

-- Live-uniqueness: at most ONE non-revoked grant per (membership, bundle). Revoked rows are
-- history and may repeat, so this is a PARTIAL unique — Prisma can't express a filtered
-- unique, so raw SQL, and it won't drift (mirrors RiskFlag_active_unique). A plain unique
-- would collide the instant a revoked bundle is re-granted.
CREATE UNIQUE INDEX "MembershipGrant_live_unique"
    ON "MembershipGrant"("membershipId", "bundle")
    WHERE "revokedAt" IS NULL;

ALTER TABLE "MembershipGrant" ADD CONSTRAINT "MembershipGrant_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
