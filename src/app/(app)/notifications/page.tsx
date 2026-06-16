import { requireCtx } from "@/server/auth/request";
import { listMyNotifications } from "@/server/services/notifications";
import { Button, EmptyState, PageHeader } from "@/components/ui";
import { formatDubaiDate } from "@/server/calculators/dates";
import { markAllReadAction } from "./actions";

const CATEGORY_LABEL: Record<string, string> = {
  DEADLINES: "Deadlines",
  PAYMENTS: "Payments",
  RENEWALS: "Renewals",
  PROOFS: "Proof requests",
  RISK: "Risk flags",
  DIGEST: "Summary",
};

export default async function NotificationsPage() {
  const ctx = await requireCtx();
  const { items } = await listMyNotifications(ctx, { limit: 100 });
  const hasUnread = items.some((i) => !i.readAt);

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Notifications"
        subtitle="Everything Seneschal has flagged for you."
        actions={
          hasUnread ? (
            <form action={markAllReadAction}>
              <Button type="submit" variant="secondary">
                Mark all read
              </Button>
            </form>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState message="You're all caught up — no notifications yet." />
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white shadow-sm">
          {items.map((it) => (
            <div key={it.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  it.readAt ? "bg-transparent" : it.urgent ? "bg-claret-500" : "bg-gold-500"
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className={`text-sm ${it.readAt ? "text-muted" : "font-medium text-navy-900"}`}>
                  {it.subject ?? "Notification"}
                </div>
                {it.bodyRef && <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{it.bodyRef}</p>}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[11px] uppercase tracking-wider text-gold-700">
                  {CATEGORY_LABEL[it.category ?? ""] ?? ""}
                </div>
                <div className="figure text-[11px] text-muted">{formatDubaiDate(it.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
