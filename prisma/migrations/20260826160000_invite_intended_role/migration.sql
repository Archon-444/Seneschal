-- In-org invites name a seat (Role), not a capability bundle. Platform seat-zero
-- is WORKSPACE_ADMIN. Existing org-admin rows backfill from intendedBundles.

ALTER TABLE "WorkspaceInvite" ADD COLUMN "intendedRole" "Role";

UPDATE "WorkspaceInvite"
SET "intendedRole" = 'ORG_ADMIN'
WHERE "intendedRole" IS NULL AND 'ORG_ADMIN' = ANY("intendedBundles");

UPDATE "WorkspaceInvite"
SET "intendedRole" = 'WORKSPACE_ADMIN'
WHERE "intendedRole" IS NULL AND ("platformIssued" = true OR 'PRINCIPAL' = ANY("intendedBundles"));
