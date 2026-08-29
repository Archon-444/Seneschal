-- Owner invite (agency/fiduciary only): bind the LANDLORD seat to an OWNER contact.
ALTER TABLE "WorkspaceInvite" ADD COLUMN "subjectContactId" TEXT;

CREATE INDEX "WorkspaceInvite_subjectContactId_idx" ON "WorkspaceInvite"("subjectContactId");
