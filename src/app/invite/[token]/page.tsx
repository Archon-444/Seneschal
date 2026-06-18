import { peekInvite } from "@/server/services/members";
import { Logo } from "@/components/Logo";
import { AcceptForm } from "./AcceptForm";

// Public invite-accept (F-Admin §7) — mobile-first like the proof-upload page. The invitee
// confirms their details and sets their own sign-in next; the operator set no credential.
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
              <p className="mb-4 mt-1 text-sm text-muted">
                You&apos;ve been invited as an organisation admin. Confirm your details — you&apos;ll set
                up sign-in on the next step.
              </p>
              <AcceptForm token={token} email={invite.email} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
