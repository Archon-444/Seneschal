import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { listMembers } from "@/server/services/members";
import { DubaiDate, FormSection, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { InviteForm } from "./InviteForm";
import {
  grantOrgAdminAction,
  removeMemberAction,
  revokeInviteAction,
  revokeOrgAdminAction,
} from "./actions";

// In-org member management (F-Admin §4.1, §7). Gated by members.read at the handler; the nav
// entry is cosmetic. An office admin sees this; a data role's route fails closed in listMembers.
export default async function MembersPage() {
  let data;
  try {
    data = await listMembers(await requireCtx());
  } catch {
    redirect("/dashboard");
  }

  return (
    <>
      <PageHeader
        title="Members & access"
        subtitle="Who can act in this workspace. Invite by seat — they choose a password when they accept. Workspace admin is seated when the workspace is provisioned, not from here."
        actions={
          <LinkButton href="/members/assignments" variant="secondary">
            Assignments
          </LinkButton>
        }
      />

      <FormSection title="Invite someone" className="mb-6">
        <InviteForm />
      </FormSection>

      <Table stack headers={["Name", "Email", "Seat", ""]}>
        {data.members.map((m) => (
          <tr key={m.membershipId}>
            <Td label="Name">
              {m.name}
              {m.isSelf && <span className="ml-2 text-xs text-muted">(you)</span>}
            </Td>
            <Td label="Email" className="text-xs">
              {m.email}
            </Td>
            <Td label="Seat">{m.seatLabel}</Td>
            <Td>
              {!m.isSelf && (
                <div className="flex flex-wrap justify-end gap-1.5 text-xs">
                  {m.role !== "ORG_ADMIN" && !m.officeAdminOverlay && (
                    <form action={grantOrgAdminAction}>
                      <input type="hidden" name="membershipId" value={m.membershipId} />
                      <button className="rounded-md border border-line px-2 py-1 text-navy-700 hover:bg-ivory-100">
                        + Office admin
                      </button>
                    </form>
                  )}
                  {m.officeAdminOverlay && (
                    <form action={revokeOrgAdminAction}>
                      <input type="hidden" name="membershipId" value={m.membershipId} />
                      <button className="rounded-md border border-line px-2 py-1 text-navy-700 hover:bg-ivory-100">
                        − Office admin
                      </button>
                    </form>
                  )}
                  <form action={removeMemberAction}>
                    <input type="hidden" name="membershipId" value={m.membershipId} />
                    <button className="rounded-md border border-line px-2 py-1 text-claret-700 hover:bg-claret-100">
                      Remove
                    </button>
                  </form>
                </div>
              )}
            </Td>
          </tr>
        ))}
      </Table>

      {data.invites.length > 0 && (
        <>
          <h2 className="font-display mt-8 mb-3 text-lg text-navy-900">Pending invites</h2>
          <Table stack headers={["Email", "Seat", "Expires", ""]}>
            {data.invites.map((inv) => (
              <tr key={inv.id}>
                <Td label="Email" className="text-xs">
                  {inv.email}
                </Td>
                <Td label="Seat">{inv.seatLabel}</Td>
                <Td label="Expires">
                  <DubaiDate value={inv.expiresAt} className="text-xs" />
                </Td>
                <Td>
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="inviteId" value={inv.id} />
                    <button className="rounded-md border border-line px-2 py-1 text-xs text-claret-700 hover:bg-claret-100">
                      Revoke
                    </button>
                  </form>
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  );
}
