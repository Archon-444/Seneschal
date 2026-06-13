import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getRenewalRisk } from "@/server/services/renewals";
import { daysBetween, formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Button, Card, Field, inputClass, Money, PageHeader, Table, Td } from "@/components/ui";
import {
  acceptOfferAction,
  captureIndexAction,
  openRenewalCaseAction,
  proposeOfferAction,
  serveNoticeAction,
} from "../../actions";

// Renewal risk report (Renewal Risk Desk). Notice-gate countdown + the lawful
// Decree 43 position from a captured index. Estimates for review — not legal advice.

export default async function RenewalReportPage({
  params,
}: {
  params: Promise<{ tenancyId: string }>;
}) {
  const { tenancyId } = await params;
  const ctx = await requireCtx();

  let risk;
  try {
    risk = await getRenewalRisk(ctx, tenancyId);
  } catch {
    notFound();
  }

  const t = risk!.tenancy;
  const p = t.property;
  const unit = [p.community, p.building, p.unitNo].filter(Boolean).join(" · ") || "Unit";
  const pos = risk!.position;

  // Timeline ribbon positions across the contract term.
  const total = Math.max(1, daysBetween(t.startDate, t.endDate));
  const pct = (d: Date) => Math.min(100, Math.max(0, (daysBetween(t.startDate, d) / total) * 100));
  const gateLeft = pct(risk!.noticeGateAt);

  return (
    <>
      <Link href="/renewals" className="mb-4 inline-block text-sm text-muted hover:text-navy-900">
        ← All renewals
      </Link>
      <PageHeader
        eyebrow="Renewal risk report"
        title={unit}
        subtitle={`Contract ${formatDubaiDate(t.startDate)} → ${formatDubaiDate(t.endDate)}${t.ejariNo ? ` · Ejari ${t.ejariNo}` : ""}`}
        actions={
          risk!.renewalCase ? (
            <Badge value={risk!.renewalCase.status} />
          ) : (
            <form action={openRenewalCaseAction}>
              <input type="hidden" name="tenancyId" value={tenancyId} />
              <Button type="submit">Open renewal case</Button>
            </form>
          )
        }
      />

      {/* Key dates */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KeyDate
          label="Last day to serve a change notice"
          value={formatDubaiDate(risk!.noticeGateAt)}
          note={`${t.noticePeriodDays} days before expiry`}
          hot={!risk!.gatePassed && risk!.daysToGate <= 30}
        />
        <KeyDate label="Contract expiry" value={formatDubaiDate(risk!.expiresAt)} note="renews on current terms if no valid notice" />
        <KeyDate label="Renewal date" value={formatDubaiDate(risk!.renewalDate)} note="new term begins" />
        <KeyDate
          label="Window remaining"
          value={risk!.gatePassed ? "Gate passed" : `${risk!.daysToGate} days`}
          note="to the notice gate"
          hot={!risk!.gatePassed && risk!.daysToGate <= 30}
        />
      </div>

      {/* Timeline ribbon */}
      <div className="mb-8">
        <div className="relative h-3 rounded-full bg-verde-100">
          <div className="absolute inset-y-0 right-0 rounded-r-full bg-claret-100" style={{ width: `${100 - gateLeft}%` }} />
          <div className="absolute -top-1 bottom-[-4px] w-0.5 bg-navy-900" style={{ left: `${gateLeft}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>{formatDubaiDate(t.startDate)} · start</span>
          <span className="text-navy-900">notice gate · {formatDubaiDate(risk!.noticeGateAt)}</span>
          <span>{formatDubaiDate(t.endDate)} · expiry</span>
        </div>
      </div>

      {/* RERA position */}
      <Card className="mb-6 border-gold-300 bg-gold-50/40">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl text-navy-900">Lawful position (Decree 43)</h2>
          {risk!.latestIndex && (
            <span className="figure text-xs text-muted">
              {risk!.latestIndex.source} · captured {formatDubaiDate(risk!.latestIndex.capturedAt)}
            </span>
          )}
        </div>

        {pos ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Index average market rent" value={<Money amount={pos.marketRentAvg} />} />
              <Fact label="Your rent vs market" value={`${Math.round(pos.gapPct * 100)}% below`} />
              <Fact label="Decree 43 band" value={`${pos.bandPct}%`} />
              <Fact label="Lawful ceiling" value={<Money amount={pos.ceiling} />} />
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-lg bg-white/70 p-3 text-sm text-navy-700">
              <span className="mt-0.5 rounded-full bg-navy-900 px-2 py-0.5 text-xs font-bold text-ivory-50">
                est.
              </span>
              <p>
                {pos.bandPct === 0 ? (
                  <>The rent sits within the top market band — no lawful increase applies this renewal.</>
                ) : (
                  <>
                    An estimated <b>{pos.bandPct}%</b> increase applies, lifting the lawful ceiling to{" "}
                    <Money amount={pos.ceiling} />. Up to <Money amount={pos.valueAtRisk} />/yr is forgone
                    if no valid notice is served by <b>{formatDubaiDate(risk!.noticeGateAt)}</b> — recurring
                    until the next correct notice.
                  </>
                )}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">
            No index figure captured yet. Enter the DLD Smart Rental Index average for a comparable unit
            below to compute the lawful band, ceiling and value at risk.
          </p>
        )}
      </Card>

      {/* Capture index */}
      <Card className="mb-6 max-w-2xl">
        <h2 className="font-display mb-1 text-lg text-navy-900">Capture index figure</h2>
        <p className="mb-3 text-xs text-muted">
          Current rent <Money amount={Number(t.annualRent)} />/yr. Enter the official index average; it is
          saved to the evidence record with its capture date.
        </p>
        <form action={captureIndexAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tenancyId" value={tenancyId} />
          <Field label="Index average market rent (AED/yr)">
            <input name="marketRentAvg" type="number" min="1" step="1" required className={inputClass} placeholder="e.g. 96000" />
          </Field>
          <Field label="Captured on">
            <input name="capturedAt" type="date" className={inputClass} />
          </Field>
          <Button type="submit">Save index figure</Button>
        </form>
      </Card>

      {/* Negotiation workspace */}
      {risk!.renewalCase && (
        <Card className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg text-navy-900">Renewal terms</h2>
            {risk!.renewalCase.status !== "AGREED" && risk!.renewalCase.status !== "NOTICE_SERVED" && (
              <form action={serveNoticeAction}>
                <input type="hidden" name="renewalCaseId" value={risk!.renewalCase.id} />
                <input type="hidden" name="tenancyId" value={tenancyId} />
                <Button type="submit" variant="secondary">Mark notice served</Button>
              </form>
            )}
          </div>

          {risk!.offers.length === 0 ? (
            <p className="mb-4 text-sm text-muted">No terms on the table yet — send the first proposal below.</p>
          ) : (
            <Table headers={["v", "Party", "Annual rent", "Payment", "Status", ""]}>
              {risk!.offers.map((o) => (
                <tr key={o.id} className={o.status === "ACCEPTED" ? "bg-verde-100/40" : ""}>
                  <Td className="figure">{o.version}</Td>
                  <Td><Badge value={o.party} /></Td>
                  <Td><Money amount={o.annualRent} /></Td>
                  <Td>{o.paymentSchedule}{o.paymentMethod ? ` · ${o.paymentMethod}` : ""}</Td>
                  <Td><Badge value={o.status} /></Td>
                  <Td>
                    {(o.status === "SENT" || o.status === "COUNTERED") && (
                      <form action={acceptOfferAction}>
                        <input type="hidden" name="offerId" value={o.id} />
                        <input type="hidden" name="tenancyId" value={tenancyId} />
                        <button className="text-xs text-navy-500 underline-offset-2 hover:text-verde-700 hover:underline">
                          Accept
                        </button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}

          {risk!.renewalCase.status !== "AGREED" && (
            <form action={proposeOfferAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <input type="hidden" name="renewalCaseId" value={risk!.renewalCase.id} />
              <input type="hidden" name="tenancyId" value={tenancyId} />
              <Field label="Party">
                <select name="party" className={inputClass}>
                  <option value="LANDLORD">Landlord proposal</option>
                  <option value="TENANT">Tenant counter</option>
                </select>
              </Field>
              <Field label="Annual rent (AED)">
                <input name="annualRent" type="number" min="1" step="1" required className={inputClass} placeholder="e.g. 79200" />
              </Field>
              <Field label="Payment schedule">
                <input name="paymentSchedule" required className={inputClass} placeholder="4 cheques" />
              </Field>
              <Field label="Method">
                <input name="paymentMethod" className={inputClass} placeholder="Cheque" />
              </Field>
              <Button type="submit">Add terms</Button>
            </form>
          )}
        </Card>
      )}

      <p className="text-xs text-muted">
        Decree No. (43) of 2013 figures are estimates anchored to the captured index. Seneschal provides
        software and a record — it is not a broker or legal adviser. Review official sources before acting.
      </p>
    </>
  );
}

function KeyDate({ label, value, note, hot = false }: { label: string; value: string; note: string; hot?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${hot ? "border-claret-100 bg-claret-100/40" : "border-line bg-ivory-100"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={`figure mt-1 text-lg font-semibold ${hot ? "text-claret-700" : "text-navy-900"}`}>{value}</div>
      <div className="text-[11px] text-muted">{note}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="figure mt-0.5 text-lg text-navy-900">{value}</div>
    </div>
  );
}
