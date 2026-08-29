import { peekInvite } from "@/server/services/members";
import { Logo } from "@/components/Logo";
import { AcceptForm } from "./AcceptForm";
import type { Role } from "@prisma/client";

function inviteBlurb(role: Role | null): string {
  switch (role) {
    case "ORG_ADMIN":
      return "You've been invited as an office admin. Confirm your details and choose a password to join this workspace.";
    case "MANAGER":
      return "You've been invited as staff. Confirm your details and choose a password to join this workspace.";
    case "MANAGING_AGENT":
      return "You've been invited as an agent. Confirm your details and choose a password. After you join, your office will assign the properties you work.";
    case "WORKSPACE_ADMIN":
      return "You've been invited to administer this workspace. Confirm your details and choose a password.";
    default:
      return "Confirm your details and choose a password to join this workspace.";
  }
}

// Public invite-accept (F-Admin §7). The invitee confirms email and sets a password;
// the operator set no credential.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await peekInvite(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ivory-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-navy-900">
          <Logo className="h-8 w-8" />
          <span className="font-display text-2xl">Seneschal</span>
        </div>
        <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
          {!invite || !invite.valid ? (
            <p className="text-sm text-muted">
              This invitation is no longer valid. Ask your workspace admin to send a new one.
            </p>
          ) : (
            <>
              <h1 className="font-display text-xl text-navy-900">Join {invite.workspaceName}</h1>
              <p className="mb-4 mt-1 text-sm text-muted">{inviteBlurb(invite.intendedRole)}</p>
              <AcceptForm token={token} email={invite.email} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
