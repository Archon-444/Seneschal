import Link from "next/link";
import { Card, LinkButton } from "@/components/ui";

// First-run activation checklist. Rendered only while a step is outstanding
// and only for roles that can actually perform the steps (clients.write —
// gated by the caller); a completed workspace never sees it.

type Step = {
  title: string;
  detail: React.ReactNode;
  done: boolean;
  href: string;
  cta: string;
};

export function GettingStarted({
  hasClient,
  hasTenancy,
  hasTeam,
  showTeamStep,
}: {
  hasClient: boolean;
  hasTenancy: boolean;
  hasTeam: boolean;
  /** Only roles that can reach /members get the invite step. */
  showTeamStep: boolean;
}) {
  const steps: Step[] = [
    {
      title: "Add your first client",
      detail: "The owner (or owning entity) whose portfolio you oversee — every property sits under a client.",
      done: hasClient,
      href: "/clients",
      cta: "Add client",
    },
    {
      title: "Onboard your first tenancy",
      detail: (
        <>
          Scan the contract to propose landlord, tenant, property and term for your review — or{" "}
          <Link href="/onboarding/new" className="text-navy-700 underline underline-offset-2">
            enter them by hand
          </Link>
          . Nothing is written until you confirm.
        </>
      ),
      done: hasTenancy,
      href: "/imports",
      cta: "Scan contract",
    },
    ...(showTeamStep
      ? [
          {
            title: "Invite your team",
            detail: "Colleagues get their own sign-in and role — access is capability-scoped, never shared logins.",
            done: hasTeam,
            href: "/members",
            cta: "Invite",
          },
        ]
      : []),
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const firstPending = steps.findIndex((s) => !s.done);

  return (
    <section className="mb-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-navy-900">Set up your workspace</h2>
          <span className="figure text-xs text-muted">
            {doneCount} of {steps.length} complete
          </span>
        </div>
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  step.done
                    ? "bg-verde-100 text-verde-700"
                    : "border border-line bg-white text-navy-500"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${step.done ? "text-muted line-through" : "text-navy-900"}`}>
                  {step.title}
                  {step.done && <span className="sr-only"> (done)</span>}
                </p>
                {!step.done && <p className="mt-0.5 text-xs text-muted">{step.detail}</p>}
              </div>
              {!step.done && (
                <div className="shrink-0">
                  <LinkButton href={step.href} variant={i === firstPending ? "primary" : "secondary"}>
                    {step.cta}
                  </LinkButton>
                </div>
              )}
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
}
