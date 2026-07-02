import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getRenewalRisk } from "@/server/services/renewals";
import { daysBetween, formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Button, Card, Field, FormActions, inputClass, Money, PageHeader, Table, Td } from "@/components/ui";
import {
  acceptOfferAction,
  captureIndexAction,
  confirmNoticeServiceAction,
  openRenewalCaseAction,
  proposeOfferAction,
  sendOfferToTenantAction,
  serveNoticeAction,
} from "../../actions";

// Renewal risk report (Renewal Risk Desk). Notice-gate countdown + the index-based
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
      <Card className="mb-6 border-gold-300 bg-gold-100/40">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl text-navy-900">Index-based position · Decree 43</h2>
          {risk!.latestIndex && (
            <span className="figure flex items-center gap-2 text-xs text-muted">
              <span>
                {risk!.latestIndex.source} · captured {formatDubaiDate(risk!.latestIndex.capturedAt)}
              </span>
              {risk!.latestIndex.provisional && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  awaiting verification
                </span>
              )}
            </span>
          )}
        </div>

        {pos ? (
          <>
            <CeilingScale
              current={pos.currentRent}
              ceiling={pos.ceiling}
              bandPct={pos.bandPct}
              markers={risk!.offers
                .filter((o) => o.status === "SENT" || o.status === "COUNTERED" || o.status === "ACCEPTED")
                .map((o) => ({ label: `AED ${o.annualRent.toLocaleString("en-AE")}`, value: o.annualRent, party: o.party }))}
            />
            <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Index average market rent" value={<Money amount={pos.marketRentAvg} />} />
              <Fact label="Your rent vs market" value={`${Math.round(pos.gapPct * 100)}% below`} />
              <Fact label="Decree 43 band" value={`${pos.bandPct}%`} />
              <Fact label="Value at risk / yr" value={<Money amount={pos.valueAtRisk} />} />
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-lg bg-white/70 p-3 text-sm text-navy-700">
              <span className="mt-0.5 rounded-full bg-navy-900 px-2 py-0.5 text-xs font-bold text-ivory-50">
                est.
              </span>
              <p>
                {pos.bandPct === 0 ? (
                  <>The rent sits within the top market band — no estimated permissible increase applies this renewal.</>
                ) : (
                  <>
                    An estimated <b>{pos.bandPct}%</b> increase applies, lifting the index-based ceiling estimate to{" "}
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
            below to compute the estimated band, ceiling and value at risk.
          </p>
        )}
      </Card>

      {/* Capture index */}
      <Card className="mb-6 max-w-2xl">
        <h2 className="font-display mb-1 text-lg text-navy-900">Capture index figure</h2>
        <p className="mb-3 text-xs text-muted">
          Current rent <Money amount={Number(t.annualRent)} />/yr. An official source (DLD Smart Rental
          Index / RERA) requires a source reference; without one the figure is saved as a concierge
          estimate marked “awaiting verification” — never as DLD-sourced.
        </p>
        <form action={captureIndexAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tenancyId" value={tenancyId} />
          <Field label="Index average market rent (AED/yr)">
            <input name="marketRentAvg" type="number" min="1" step="1" required className={inputClass} placeholder="e.g. 96000" />
          </Field>
          <Field label="Captured on">
            <input name="capturedAt" type="date" className={inputClass} />
          </Field>
          <Field label="Source">
            <select name="indexSource" defaultValue="MANUAL_CONCIERGE" className={inputClass}>
              <option value="MANUAL_CONCIERGE">Concierge estimate (provisional)</option>
              <option value="SMART_RENTAL_INDEX_2025">DLD Smart Rental Index</option>
              <option value="RERA_INDEX_LEGACY">RERA index (legacy)</option>
            </select>
          </Field>
          <Field label="Source reference (URL / screenshot id)">
            <input name="sourceRef" className={inputClass} placeholder="required for an official source" />
          </Field>
          <Field label="Comparable basis (optional)">
            <input name="comparableBasis" className={inputClass} placeholder="e.g. 2BR, Marina Heights" />
          </Field>
          <Button type="submit">Save index figure</Button>
        </form>
      </Card>

      {/* Notice service */}
      {risk!.renewalCase && (
        <NoticeServiceCard
          renewalCaseId={risk!.renewalCase.id}
          tenancyId={tenancyId}
          notice={risk!.currentNotice}
        />
      )}

      {/* Negotiation workspace */}
      {risk!.renewalCase && (
        <Card className="mb-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg text-navy-900">Renewal terms</h2>
          </div>

          {risk!.offers.length === 0 ? (
            <p className="mb-4 text-sm text-muted">No terms on the table yet — send the first proposal below.</p>
          ) : (
            <Table headers={["v", "Party", "Annual rent", "Payment", "Status", ""]}>
              {risk!.offers.map((o) => (
                <tr
                  key={o.id}
                  className={
                    o.status === "ACCEPTED"
                      ? "bg-verde-100/40"
                      : o.status === "SENT" || o.status === "COUNTERED"
                        ? "bg-amber-100/30"
                        : ""
                  }
                >
                  <Td className="figure">{o.version}</Td>
                  <Td><Badge value={o.party} /></Td>
                  <Td>
                    <Money amount={o.annualRent} />
                    <div className="text-[11px] text-muted">{deltaOnCurrent(o.annualRent, Number(t.annualRent))}</div>
                  </Td>
                  <Td>{o.paymentSchedule}{o.paymentMethod ? ` · ${o.paymentMethod}` : ""}</Td>
                  <Td>
                    <Badge value={o.status} />
                    {(o.status === "SENT" || o.status === "COUNTERED") && (
                      <div className="mt-0.5 text-[11px] text-amber-700">awaiting response</div>
                    )}
                  </Td>
                  <Td>
                    {(o.status === "SENT" || o.status === "COUNTERED") && (
                      <div className="flex gap-3">
                        <form action={acceptOfferAction}>
                          <input type="hidden" name="offerId" value={o.id} />
                          <input type="hidden" name="tenancyId" value={tenancyId} />
                          <button className="text-xs text-navy-500 underline-offset-2 hover:text-verde-700 hover:underline">
                            Accept
                          </button>
                        </form>
                        {o.party === "LANDLORD" && (
                          <form action={sendOfferToTenantAction}>
                            <input type="hidden" name="offerId" value={o.id} />
                            <input type="hidden" name="tenancyId" value={tenancyId} />
                            <button className="text-xs text-navy-500 underline-offset-2 hover:text-gold-700 hover:underline">
                              Send to tenant
                            </button>
                          </form>
                        )}
                      </div>
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

      {/* Partner desk */}
      {risk!.renewalCase && (
        <Card className="mb-6">
          <h2 className="font-display mb-1 text-lg text-navy-900">Partner desk</h2>
          <p className="mb-4 text-xs text-muted">
            Seneschal owns the software, workflow and record. Regulated execution is performed by a
            licensed partner office under its own licence.
          </p>
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Case progress</h3>
              <ul className="space-y-1.5 text-sm">
                <Task done={!!risk!.latestIndex} label="Index captured & index position computed" />
                <Task done label="Renewal case opened" />
                <Task done={risk!.offers.some((o) => o.party === "LANDLORD")} label="Proposal prepared" />
                <Task done={risk!.offers.some((o) => o.party === "TENANT")} label="Tenant responded" />
                <Task done={risk!.renewalCase.status === "AGREED"} label="Terms agreed" />
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Who does what</h3>
              <Table headers={["Layer", "Owner"]}>
                <WhoRow layer="Risk scan & index capture" owner="Seneschal" />
                <WhoRow layer="Workflow, documents & evidence" owner="Seneschal" />
                <WhoRow layer="Tenant coordination & notice service" owner="Licensed partner" />
                <WhoRow layer="Ejari submission (where in scope)" owner="Licensed partner" />
              </Table>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            Regulated scope, fees and licence boundaries are confirmed with the licensed partner before
            action. No specific licence is represented here.
          </p>
        </Card>
      )}

      <p className="text-xs text-muted">
        Decree No. (43) of 2013 figures are estimates anchored to the captured index. Seneschal provides
        software and a record — it is not a broker or legal adviser. Review official sources before acting.
      </p>
    </>
  );
}

const SERVICE_METHODS = ["EMAIL", "COURIER", "IN_PERSON", "REGISTERED_POST", "OTHER"] as const;

/** Serve / confirm a change notice. A notice reaches SERVED only with proof of
 *  service; without it the record rests at pending-evidence and the timeline does
 *  not advance (enforced server-side in serveNoticeFormal / confirmNoticeService). */
function NoticeServiceCard({
  renewalCaseId,
  tenancyId,
  notice,
}: {
  renewalCaseId: string;
  tenancyId: string;
  notice: { id: string; status: string; serviceMethod: string | null } | null;
}) {
  const served = notice?.status === "SERVED";
  const pending = notice?.status === "SERVICE_RECORDED_PENDING_EVIDENCE";
  const label = (m: string) => m.replace(/_/g, " ").toLowerCase();
  return (
    <Card className="mb-6 max-w-2xl">
      <h2 className="font-display mb-1 text-lg text-navy-900">Serve change notice</h2>
      <p className="mb-3 text-xs text-muted">
        A notice is recorded as <b>served</b> only with proof of service — a delivery reference, an
        uploaded service document, or a signed attestation. Without proof it is held as “service
        recorded — awaiting evidence” and the renewal timeline does not advance.
      </p>

      {served ? (
        <div className="flex items-center gap-2 rounded-lg border border-verde-100 bg-verde-100/40 p-3 text-sm text-verde-700">
          <span aria-hidden>✓</span>
          <span>
            Notice served{notice?.serviceMethod ? ` via ${label(notice.serviceMethod)}` : ""}, with
            evidence on file.
          </span>
        </div>
      ) : (
        <>
          {pending && (
            <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-100/50 p-3 text-sm text-amber-700">
              Service was recorded but no proof is attached yet. Add a delivery reference, a document,
              or a signed attestation below to mark it served.
            </div>
          )}
          <form action={pending ? confirmNoticeServiceAction : serveNoticeAction} className="space-y-3">
            <input type="hidden" name="renewalCaseId" value={renewalCaseId} />
            <input type="hidden" name="tenancyId" value={tenancyId} />
            {pending && <input type="hidden" name="noticeId" value={notice!.id} />}
            <Field label="Service method">
              <select name="serviceMethod" defaultValue={notice?.serviceMethod ?? "EMAIL"} className={inputClass}>
                {SERVICE_METHODS.map((m) => (
                  <option key={m} value={m}>{label(m)}</option>
                ))}
              </select>
            </Field>
            <fieldset className="space-y-3 rounded-lg border border-line bg-ivory-100/60 p-3">
              <legend className="t-label px-1 text-muted">
                Proof of service — provide at least one
              </legend>
              <Field label="Delivery reference" hint="Courier tracking no., registered-post ref, or inbox reference.">
                <input name="serviceRef" className={inputClass} placeholder="courier / inbox ref" />
              </Field>
              <Field label="Service document" hint="A delivery receipt, signed copy, or similar.">
                <input type="file" name="file" className="text-sm" />
              </Field>
              <div>
                <label className="flex items-center gap-2 text-sm text-navy-700">
                  <input type="checkbox" name="attest" value="yes" />
                  I attest this notice was served as recorded
                </label>
                <div className="mt-2">
                  <Field label="Attested by (name)">
                    <input name="attestedBy" className={inputClass} placeholder="your name" />
                  </Field>
                </div>
              </div>
            </fieldset>
            <FormActions
              note={
                pending
                  ? "At least one proof element above is needed to move this notice to served."
                  : "With no proof attached, the service is recorded but held as awaiting evidence — it does not count as served."
              }
            >
              <Button type="submit" variant="secondary">
                {pending ? "Confirm service with evidence" : "Record notice service"}
              </Button>
            </FormActions>
          </form>
        </>
      )}
    </Card>
  );
}

function Task({ done, label }: { done?: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${done ? "bg-verde-100 text-verde-700" : "border border-dashed border-line text-muted"}`}
      >
        {done ? "✓" : ""}
      </span>
      <span className={done ? "text-navy-900" : "text-muted"}>{label}</span>
    </li>
  );
}

function WhoRow({ layer, owner }: { layer: string; owner: string }) {
  return (
    <tr>
      <Td>{layer}</Td>
      <Td className={owner === "Seneschal" ? "font-medium text-navy-900" : "font-medium text-verde-700"}>{owner}</Td>
    </tr>
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

function deltaOnCurrent(rent: number, current: number): string {
  if (!(current > 0)) return "";
  const pct = Math.round((rent / current - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% on current`;
}

/** The decision signature: where current rent, the offers on the table, and the
 *  Decree 43 ceiling estimate sit on one axis — the negotiating room, at a glance. */
function CeilingScale({
  current,
  ceiling,
  bandPct,
  markers,
}: {
  current: number;
  ceiling: number;
  bandPct: number;
  markers: { label: string; value: number; party: "LANDLORD" | "TENANT" }[];
}) {
  if (bandPct === 0 || ceiling <= current) {
    return (
      <div className="rounded-lg border border-line bg-white/60 p-4 text-sm text-navy-700">
        No estimated permissible increase applies this renewal — the rent already sits within the top market band.
      </div>
    );
  }
  const span = ceiling - current;
  const at = (v: number) => Math.min(100, Math.max(0, ((v - current) / span) * 100));
  return (
    <div className="px-1 pt-8 pb-1">
      <div className="relative h-2 rounded-full bg-gradient-to-r from-verde-100 to-gold-100">
        {/* ceiling-estimate cap */}
        <div className="absolute right-0 -top-1.5 h-5 w-0.5 bg-claret-500" />
        {markers.map((m, i) => (
          <div key={i} className="absolute top-1/2" style={{ left: `${at(m.value)}%` }}>
            <span
              className={`figure absolute -top-7 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold ${m.party === "TENANT" ? "text-gold-700" : "text-navy-900"}`}
            >
              {m.label}
            </span>
            <span
              className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${m.party === "TENANT" ? "bg-gold-500" : "bg-navy-900"}`}
            />
          </div>
        ))}
      </div>
      <div className="figure mt-3 flex justify-between text-[11px] text-muted">
        <span>current · AED {current.toLocaleString("en-AE")}</span>
        <span className="text-claret-700">ceiling estimate · AED {ceiling.toLocaleString("en-AE")}</span>
      </div>
      {markers.length > 0 && (
        <div className="mt-2 flex gap-4 text-[10px] text-muted">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-navy-900" /> landlord</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gold-500" /> tenant</span>
        </div>
      )}
    </div>
  );
}
