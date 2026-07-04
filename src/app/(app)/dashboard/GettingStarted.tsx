import Link from "next/link";
import { Card, Eyebrow, LinkButton } from "@/components/ui";

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
          Capture landlord, tenant, property and contract in one pass — or{" "}
          <Link href="/imports" className="text-gold-700 underline-offset-2 hover:underline">
            upload the contract
          </Link>{" "}
          and let extraction propose the fields for your review.
        </>
      ),
      done: hasTenancy,
      href: "/onboarding/new",
      cta: "Onboard tenancy",
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
    <section className="mb-8">
      <Card className="border-gold-500/40">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <Eyebrow>Getting started</Eyebrow>
            <h2 className="font-display text-lg font-semibold text-navy-900">
              Set up your workspace
            </h2>
          </div>
          <span className="figure text-xs text-muted">
            {doneCount} of {steps.length} complete
          </span>
        </div>
        <ol className="space-y-4">
          {steps.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  step.done
                    ? "bg-verde-100 text-verde-700"
                    : "border border-line bg-ivory-100 text-navy-500"
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
