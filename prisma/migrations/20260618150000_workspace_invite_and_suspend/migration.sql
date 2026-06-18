-- F-Admin Phase 2: platform provisioning surface.

-- Temporary platform suspend, distinct from the terminal archive (F-Admin §3.2).
ALTER TABLE "Workspace" ADD COLUMN "suspendedAt" TIMESTAMP(3);

-- Seat-zero + member invites. Only the token HASH is stored (SecureLink discipline); the raw
-- token is returned once at issue and never persisted or logged.
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "intendedBundles" "Bundle"[] DEFAULT ARRAY[]::"Bundle"[],
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "platformIssued" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");
CREATE INDEX "WorkspaceInvite_workspaceId_idx" ON "WorkspaceInvite"("workspaceId");
CREATE INDEX "WorkspaceInvite_email_idx" ON "WorkspaceInvite"("email");
