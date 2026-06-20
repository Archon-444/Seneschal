import { redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { listMembers } from "@/server/services/members";
import { Badge, Card, LinkButton, PageHeader, Table, Td } from "@/components/ui";
import { formatDubaiDate } from "@/server/calculators/dates";
import { InviteForm } from "./InviteForm";
import {
  grantOrgAdminAction,
  removeMemberAction,
  revokeInviteAction,
  revokeOrgAdminAction,
} from "./actions";

// In-org member management (F-Admin §4.1, §7). Gated by members.read at the handler; the nav
// entry is cosmetic. An org-admin sees this; a data role's route fails closed in listMembers.
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
        subtitle="Who can act in this workspace. Org-admins onboard people and wire delegate assignments — they hold no data access."
        actions={
          // Assignment is a relationship edit, not a top-level destination — reached from here.
          // Anyone with members.read also holds clients.assign (both are PEOPLE_ADMIN).
          <LinkButton href="/members/assignments" variant="secondary">
            Assignments
          </LinkButton>
        }
      />

      <Card className="mb-6">
        <h2 className="font-display mb-3 text-lg text-navy-900">Invite an org-admin</h2>
        <p className="mb-3 text-sm text-muted">
          People-power only: an org-admin manages members and assignments but cannot open a tenancy.
        </p>
        <InviteForm />
      </Card>

      <Table headers={["Name", "Email", "Role", "Bundles", ""]}>
        {data.members.map((m) => (
          <tr key={m.membershipId}>
            <Td>
              {m.name}
              {m.isSelf && <span className="ml-2 text-xs text-muted">(you)</span>}
            </Td>
            <Td className="text-xs">{m.email}</Td>
            <Td>
              <Badge value={m.role} />
            </Td>
            <Td>
              {m.bundles.length ? (
                m.bundles.map((b) => <Badge key={b} value={b} />)
              ) : (
                <span className="text-muted">—</span>
              )}
            </Td>
            <Td>
              {!m.isSelf && (
                <div className="flex gap-1.5 text-xs">
                  {m.role !== "ORG_ADMIN" && !m.bundles.includes("ORG_ADMIN") && (
                    <form action={grantOrgAdminAction}>
                      <input type="hidden" name="membershipId" value={m.membershipId} />
                      <button className="rounded-md border border-line px-2 py-1 text-navy-700 hover:bg-ivory-100">
                        + Org-admin
                      </button>
                    </form>
                  )}
                  {m.bundles.includes("ORG_ADMIN") && (
                    <form action={revokeOrgAdminAction}>
                      <input type="hidden" name="membershipId" value={m.membershipId} />
                      <button className="rounded-md border border-line px-2 py-1 text-navy-700 hover:bg-ivory-100">
                        − Org-admin
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
          <Table headers={["Email", "Bundles", "Expires", ""]}>
            {data.invites.map((inv) => (
              <tr key={inv.id}>
                <Td className="text-xs">{inv.email}</Td>
                <Td>
                  {inv.intendedBundles.map((b) => (
                    <Badge key={b} value={b} />
                  ))}
                </Td>
                <Td className="figure text-xs">{formatDubaiDate(inv.expiresAt)}</Td>
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
