import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { formatDubaiDateTime } from "@/server/calculators/dates";
import type { RenewalWorkspaceTask } from "@/server/services/renewalWorkspace";

const STATE_LABEL: Record<RenewalWorkspaceTask["state"], string> = {
  COMPLETED: "Completed",
  CURRENT: "Current",
  BLOCKED: "Awaiting",
  FUTURE: "Not available",
  NOT_APPLICABLE: "Not applicable",
};

export function RenewalTaskPath({
  tasks,
  tenancyId,
}: {
  tasks: RenewalWorkspaceTask[];
  tenancyId: string;
}) {
  const hasCurrentTask = tasks.some((task) => task.state === "CURRENT");
  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-navy-900">Renewal task path</h2>
        <p className="mt-1 text-sm text-muted">
          Completed steps read as receipts. The current or awaiting step is expanded; future controls remain unavailable.
        </p>
      </div>
      <ol className="space-y-3">
        {tasks.map((task) => {
          const expanded = task.state === "CURRENT" || (task.state === "BLOCKED" && !hasCurrentTask);
          const completed = task.state === "COMPLETED";
          return (
            <li key={task.code}>
              <details
                open={expanded}
                className={`group rounded border ${
                  task.state === "CURRENT"
                    ? "border-navy-900 bg-navy-50/60"
                    : task.state === "BLOCKED"
                      ? "border-amber-500/50 bg-amber-100/30"
                      : completed
                        ? "border-verde-100 bg-verde-100/20"
                        : "border-line bg-ivory-100/60"
                }`}
              >
                <summary className="flex cursor-pointer list-none items-start gap-3 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 [&::-webkit-details-marker]:hidden">
                  <span
                    className={`figure flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      completed
                        ? "bg-verde-700 text-white"
                        : task.state === "CURRENT"
                          ? "bg-navy-900 text-white"
                          : "border border-line bg-white text-muted"
                    }`}
                    aria-hidden
                  >
                    {completed ? "✓" : task.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`font-semibold ${task.state === "FUTURE" ? "text-muted" : "text-navy-900"}`}>
                        {task.title}
                      </span>
                      <Badge value={STATE_LABEL[task.state]} />
                    </span>
                    {completed && task.receipt && (
                      <span className="mt-1 block text-xs text-verde-700">
                        {task.receipt.label} · {formatDubaiDateTime(task.receipt.at)}
                      </span>
                    )}
                  </span>
                  <span aria-hidden className="mt-1 text-muted transition group-open:rotate-180">⌄</span>
                </summary>
                <div className="border-t border-line px-4 py-3 pl-14 text-sm">
                  <p className="text-navy-700">{task.summary}</p>
                  {task.prerequisite && <p className="mt-1 text-xs text-muted">{task.prerequisite}</p>}
                  {task.receipt && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{task.receipt.label}</span>
                      <span>{formatDubaiDateTime(task.receipt.at)}</span>
                      {task.receipt.actorType && <span>Recorded by {task.receipt.actorType.toLowerCase().replace(/_/g, " ")}</span>}
                      {task.receipt.eventId && (
                        <Link
                          href={`/renewals/${tenancyId}?view=evidence#event-${task.receipt.eventId}`}
                          className="font-semibold text-navy-500 hover:underline"
                        >
                          View receipt
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
