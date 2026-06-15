-- Fold workspace-user messaging consent into the append-only ConsentRecord,
-- alongside contacts. Adds a nullable userId subject and migrates the existing
-- User.waOptInAt timestamps into ConsentRecord rows before dropping the column.

-- AlterTable: ConsentRecord gains a User subject; contactId becomes optional.
ALTER TABLE "ConsentRecord" ADD COLUMN     "userId" TEXT,
ALTER COLUMN "contactId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ConsentRecord_workspaceId_userId_idx" ON "ConsentRecord"("workspaceId", "userId");

-- Backfill: a user opted in globally (waOptInAt) becomes one active MESSAGING
-- consent per workspace they belong to (aligning storage with the already
-- workspace-scoped grant/evidence). Deduplicated across membership roles.
INSERT INTO "ConsentRecord" ("id", "workspaceId", "userId", "purpose", "source", "noticeVersion", "grantedAt")
SELECT gen_random_uuid(), sub."workspaceId", sub."userId", 'MESSAGING', 'FORM', 'messaging_notice_v1', sub."waOptInAt"
FROM (
  SELECT DISTINCT m."workspaceId", u."id" AS "userId", u."waOptInAt"
  FROM "User" u
  JOIN "Membership" m ON m."userId" = u."id"
  WHERE u."waOptInAt" IS NOT NULL
) sub;

-- AlterTable: the column is now redundant.
ALTER TABLE "User" DROP COLUMN "waOptInAt";
