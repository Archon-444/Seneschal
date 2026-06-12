import { redirect } from "next/navigation";
import { requireStaff } from "@/server/auth/request";
import {
  staffAuditStream,
  staffListExtractionQueue,
  staffListNotifications,
  staffListRiskFlags,
  staffListWorkspaces,
} from "@/server/services/admin";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";

// Screen 15 — staff console (T10.3). Unreachable without isStaff; every read audited.

export default async function AdminPage() {
  let staff;
  try {
    staff = await requireStaff();
  } catch {
    redirect("/dashboard");
  }
  const [workspaces, queue, notifications, flags, audit] = await Promise.all([
    staffListWorkspaces(staff!),
    staffListExtractionQueue(staff!),
    staffListNotifications(staff!),
    staffListRiskFlags(staff!),
    staffAuditStream(staff!),
  ]);

  return (
    <>
      <PageHeader title="Staff console" subtitle="Every staff action is audited with on-behalf-of attribution" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Workspaces</h2>
          <Table headers={["Name", "Type", "Members"]}>
            {workspaces.map((w) => (
              <tr key={w.id}>
                <Td>{w.name}</Td>
                <Td><Badge value={w.type} /></Td>
                <Td className="text-xs">
                  {w.memberships.map((m) => `${m.user.email} (${m.role})`).join(", ")}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Extraction review queue</h2>
          {queue.length === 0 ? (
            <p className="text-sm text-navy-300">Queue empty.</p>
          ) : (
            <Table headers={["Created", "Workspace", "Status"]}>
              {queue.map((j) => (
                <tr key={j.id}>
                  <Td className="figure text-xs">{j.createdAt.toISOString().slice(0, 10)}</Td>
                  <Td className="figure text-xs">{j.workspaceId.slice(0, 8)}…</Td>
                  <Td><Badge value={j.status} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Notification log</h2>
          <Table headers={["When", "Channel", "Template", "Status"]}>
            {notifications.slice(0, 15).map((n) => (
              <tr key={n.id}>
                <Td className="figure text-xs">{n.createdAt.toISOString().replace("T", " ").slice(0, 16)}</Td>
                <Td>{n.channel}</Td>
                <Td className="text-xs">{n.templateCode ?? "—"}</Td>
                <Td><Badge value={n.status} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <h2 className="font-display mb-3 text-lg text-navy-900">Open risk flags (all workspaces)</h2>
          <Table headers={["Raised", "Code", "Severity"]}>
            {flags.slice(0, 15).map((f) => (
              <tr key={f.id}>
                <Td className="figure text-xs">{f.raisedAt.toISOString().slice(0, 10)}</Td>
                <Td><Badge value={f.code} /></Td>
                <Td><Badge value={f.severity} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      <h2 className="font-display mt-8 mb-3 text-xl text-navy-900">Audit stream</h2>
      <Table headers={["When (UTC)", "Actor", "Verb", "Object", "On behalf of"]}>
        {audit.slice(0, 30).map((a) => (
          <tr key={a.id}>
            <Td className="figure text-xs">{a.createdAt.toISOString().replace("T", " ").slice(0, 19)}</Td>
            <Td className="text-xs">{a.actorType} {a.actorId?.slice(0, 8) ?? ""}</Td>
            <Td className="figure text-xs">{a.verb}</Td>
            <Td className="text-xs">{a.objectType}</Td>
            <Td className="text-xs">{a.onBehalfOfId?.slice(0, 8) ?? "—"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
