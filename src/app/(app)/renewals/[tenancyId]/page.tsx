import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/request";
import { getRenewalWorkspace } from "@/server/services/renewalWorkspace";
import type { RenewalRisk } from "@/server/services/renewals";
import { daysBetween, formatDubaiDate, formatDubaiDateTime, isoDate } from "@/server/calculators/dates";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormActions,
  inputClass,
  LinkButton,
  Money,
  PageHeader,
  Table,
  Td,
} from "@/components/ui";
import { RenewalTaskPath } from "@/components/renewals/RenewalTaskPath";
import { EvidenceEventCard } from "@/components/evidence/EvidenceEventCard";
import { SubmitButton } from "@/components/SubmitButton";
import { InfoTooltip } from "@/components/Tooltip";
import {
  acceptOfferAction,
  captureIndexAction,
  confirmNoticeServiceAction,
  mintRenewedTenancyAction,
  openRenewalCaseAction,
  proposeOfferAction,
  sendOfferToTenantAction,
  serveNoticeAction,
} from "../../actions";
import { RequestOwnerApprovalForm } from "./RequestOwnerApprovalForm";

type WorkspaceView = "case" | "terms" | "evidence" | "details";

const VIEWS: { value: WorkspaceView; label: string }[] = [
  { value: "case", label: "Case" },
  { value: "terms", label: "Terms" },
  { value: "evidence", label: "Evidence" },
  { value: "details", label: "Details" },
];

const TERMS_ACTIONS = new Set([
  "PREPARE_TERMS",
  "SEND_OFFER",
  "AWAIT_TENANT",
  "REVIEW_COUNTER",
  "COMPLETE_RENEWAL",
]);

export default async function RenewalWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenancyId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { tenancyId } = await params;
  const query = await searchParams;
  const ctx = await requireCtx();

  let workspace;
  try {
    workspace = await getRenewalWorkspace(ctx, tenancyId);
  } catch {
    notFound();
  }

  const view = VIEWS.some((candidate) => candidate.value === query.view)
    ? (query.view as WorkspaceView)
    : "case";
  const { risk, tasks, events, successor, capabilities } = workspace!;
  const t = risk.tenancy;
  const property = t.property;
  const unit = [property.community, property.building, property.unitNo].filter(Boolean).join(" · ") || "Unit";
  const acceptedOffer = risk.offers.find((offer) => offer.status === "ACCEPTED") ?? null;
  const latestOffer = risk.offers.at(-1) ?? null;
  const evidenceState = risk.currentNotice?.status === "SERVICE_RECORDED_PENDING_EVIDENCE"
    ? "Awaiting service proof"
    : risk.latestIndex?.provisional
      ? "Provisional source"
      : !risk.latestIndex
        ? "No verified source"
        : successor
          ? "Completion recorded"
          : "Evidence accumulating";
  const actionView = TERMS_ACTIONS.has(risk.nextAction.code)
    ? "terms"
    : risk.nextAction.code === "REVIEW_COMPLETED_CASE" || risk.nextAction.code === "NO_ACTION"
      ? "evidence"
      : "case";

  return (
    <>
      <Link href="/renewals" className="mb-4 inline-block text-sm text-muted hover:text-navy-900">
        ← All renewals
      </Link>
      <PageHeader
        eyebrow="Renewal case workspace"
        title={unit}
        subtitle={`Contract ${formatDubaiDate(t.startDate)} → ${formatDubaiDate(t.endDate)}${t.ejariNo ? ` · Ejari ${t.ejariNo}` : ""}`}
        actions={
          <>
            {capabilities.canExportEvidence && (
              <LinkButton href={`/api/v1/tenancies/${tenancyId}/evidence-pack.pdf`}>Download evidence pack</LinkButton>
            )}
            <Badge value={risk.renewalCase?.status ?? "CASE NOT OPEN"} />
          </>
        }
      />

      <Card className="z-10 mb-4 lg:sticky lg:top-3">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] lg:items-center">
          <div>
            <div className="mb-1 text-[12px] font-medium text-muted">Next action</div>
            <h2 className="text-base font-semibold">{risk.nextAction.label}</h2>
            <p className="mt-1 text-[13px] text-muted">{risk.nextAction.reason}</p>
          </div>
          <SummaryFact
            label="Notice gate"
            value={risk.gatePassed ? "Gate passed" : `${risk.daysToGate} days`}
            note={formatDubaiDate(risk.noticeGateAt)}
          />
          <SummaryFact
            label="Responsible"
            value={risk.nextAction.responsibleLayer ?? "Review owner"}
            note={risk.nextAction.urgency === "NONE" ? "No active urgency" : `${risk.nextAction.urgency.toLowerCase()} priority`}
          />
          <SummaryFact
            label="Evidence state"
            value={evidenceState}
            note={
              acceptedOffer
                ? `Accepted rent AED ${acceptedOffer.annualRent.toLocaleString("en-AE")}`
                : latestOffer
                  ? `Latest terms AED ${latestOffer.annualRent.toLocaleString("en-AE")}`
                  : "No terms recorded"
            }
          />
          <div className="flex flex-wrap gap-2 lg:flex-col">
            <Link
              href={`/renewals/${tenancyId}?view=${actionView}${actionView === "case" ? "#active-task" : ""}`}
              className="inline-flex h-8 items-center justify-center rounded border border-navy-900 bg-navy-900 px-3 text-[13px] font-medium text-white hover:bg-navy-800"
            >
              Go to current task
            </Link>
            <Link href={`/renewals/${tenancyId}?view=evidence`} className="text-center text-xs text-navy-700 hover:underline">
              View case evidence
            </Link>
          </div>
        </div>
      </Card>

      <nav aria-label="Renewal workspace views" className="mb-6 flex flex-wrap gap-2">
        {VIEWS.map((candidate) => {
          const active = candidate.value === view;
          return (
            <Link
              key={candidate.value}
              href={`/renewals/${tenancyId}?view=${candidate.value}`}
              aria-current={active ? "page" : undefined}
              className={`rounded border px-3 py-1.5 text-[13px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 ${
                active ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-white text-navy-700 hover:bg-ivory-100"
              }`}
            >
              {candidate.label}
            </Link>
          );
        })}
      </nav>

      {view === "case" && (
        <div className="space-y-6">
          <RenewalTaskPath tasks={tasks} tenancyId={tenancyId} />
          <div className="scroll-mt-32" id="active-task">
          <Card>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="mb-1 text-[12px] font-medium text-muted">Current task</div>
                <h2 className="text-base font-semibold text-navy-900">{risk.nextAction.label}</h2>
                <p className="mt-1 max-w-2xl text-sm text-muted">{risk.nextAction.reason}</p>
              </div>
              {risk.nextAction.urgency !== "NONE" && <Badge value={risk.nextAction.urgency} />}
            </div>
            <ActiveTask
              risk={risk}
              tenancyId={tenancyId}
              canWrite={capabilities.canWrite}
              canDecide={capabilities.canDecide}
            />
          </Card>
          </div>
        </div>
      )}

      {view === "terms" && (
        <TermsView
          risk={risk}
          tenancyId={tenancyId}
          canWrite={capabilities.canWrite}
          canDecide={capabilities.canDecide}
        />
      )}

      {view === "evidence" && (
        <EvidenceView
          events={events}
          successor={successor}
          tenancyId={tenancyId}
          canReadEvidence={capabilities.canReadEvidence}
          canExportEvidence={capabilities.canExportEvidence}
        />
      )}

      {view === "details" && <DetailsView risk={risk} successor={successor} />}

      <p className="mt-8 text-xs text-muted">
        Decree No. (43) of 2013 figures are estimates anchored to a recorded source. Seneschal provides software and a
        record — it is not a broker or legal adviser. Review official sources before acting.
      </p>
    </>
  );
}

function SummaryFact({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="border-l border-line pl-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold text-navy-900">{value}</div>
      <div className="mt-0.5 text-[11.5px] text-muted">{note}</div>
    </div>
  );
}

function ActiveTask({
  risk,
  tenancyId,
  canWrite,
  canDecide,
}: {
  risk: RenewalRisk;
  tenancyId: string;
  canWrite: boolean;
  canDecide: boolean;
}) {
  switch (risk.nextAction.code) {
    case "CAPTURE_INDEX":
    case "VERIFY_INDEX_SOURCE":
      return canWrite ? (
        <CaptureIndexForm tenancyId={tenancyId} currentRent={Number(risk.tenancy.annualRent)} />
      ) : (
        <ReadOnlyNote>Index sources are captured by an authorized renewal operator. The current source and estimate remain visible under Details.</ReadOnlyNote>
      );
    case "OPEN_CASE":
      return canWrite ? (
        <form action={openRenewalCaseAction}>
          <input type="hidden" name="tenancyId" value={tenancyId} />
          <Button type="submit">Open renewal case</Button>
        </form>
      ) : (
        <ReadOnlyNote>An authorized renewal operator opens the case. You can continue to review the source and dates.</ReadOnlyNote>
      );
    case "SERVE_NOTICE":
    case "ADD_SERVICE_EVIDENCE":
      return risk.renewalCase ? (
        <NoticeServiceCard
          renewalCaseId={risk.renewalCase.id}
          tenancyId={tenancyId}
          notice={risk.currentNotice}
          canDecide={canDecide}
          embedded
        />
      ) : (
        <ReadOnlyNote>The renewal case must be opened before notice service can be recorded.</ReadOnlyNote>
      );
    case "PREPARE_TERMS":
    case "SEND_OFFER":
    case "AWAIT_TENANT":
    case "REVIEW_COUNTER":
    case "COMPLETE_RENEWAL":
      return <LinkButton href={`/renewals/${tenancyId}?view=terms`}>Open terms workspace</LinkButton>;
    case "REVIEW_COMPLETED_CASE":
    case "NO_ACTION":
      return <LinkButton href={`/renewals/${tenancyId}?view=evidence`}>Review case evidence</LinkButton>;
    default:
      return (
        <ReadOnlyNote>
          This case needs fiduciary review. The system will not infer a legal or operational action from an unexpected record combination.
        </ReadOnlyNote>
      );
  }
}

function CaptureIndexForm({ tenancyId, currentRent }: { tenancyId: string; currentRent: number }) {
  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        Current rent <Money amount={currentRent} />/yr. An official DLD/RERA source requires a source reference; otherwise
        the figure remains a provisional concierge estimate.
      </p>
      <form action={captureIndexAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tenancyId" value={tenancyId} />
        <Field label="Index average market rent (AED/yr)">
          <input name="marketRentAvg" type="number" min="1" step="1" required className={inputClass} placeholder="e.g. 96000" />
        </Field>
        <Field label="Captured on"><input name="capturedAt" type="date" className={inputClass} /></Field>
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
    </div>
  );
}

function TermsView({
  risk,
  tenancyId,
  canWrite,
  canDecide,
}: {
  risk: RenewalRisk;
  tenancyId: string;
  canWrite: boolean;
  canDecide: boolean;
}) {
  if (!risk.renewalCase) {
    return <EmptyState title="No renewal case" message="Open the case from the Case view before recording terms." action={<LinkButton href={`/renewals/${tenancyId}?view=case`}>Back to case</LinkButton>} />;
  }

  const t = risk.tenancy;
  const property = t.property;
  const ownerContactId = t.landlordContactId ?? property.ownerContactId;
  const acceptedOffer = risk.offers.find((offer) => offer.status === "ACCEPTED") ?? null;
  const latestOffer = risk.offers.at(-1) ?? null;
  const canPropose = canWrite && ["PREPARE_TERMS", "REVIEW_COUNTER"].includes(risk.nextAction.code);
  const canSend = canWrite && risk.nextAction.code === "SEND_OFFER";
  const canAccept = canDecide && risk.nextAction.code === "REVIEW_COUNTER";

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-navy-900">Versioned terms history</h2>
            <p className="mt-1 text-sm text-muted">
              Current rent, frozen source ceiling estimate, proposed rent, and accepted rent remain separate records.
            </p>
          </div>
          <Badge value={risk.nextAction.label} />
        </div>
        {risk.offers.length === 0 ? (
          <EmptyState message="No renewal terms are recorded yet." />
        ) : (
          <Table stack headers={["Version", "Party", "Annual rent", "Delivery / status", "Frozen source", "Action"]}>
            {risk.offers.map((offer) => {
              const current = latestOffer?.id === offer.id;
              return (
                <tr key={offer.id} className={offer.status === "ACCEPTED" ? "bg-verde-100/40" : current ? "bg-navy-50/60" : ""}>
                  <Td label="Version" className="figure">
                    v{offer.version}
                    {current && <div className="text-[11px] font-medium text-muted">current version</div>}
                  </Td>
                  <Td label="Party"><Badge value={offer.party} /></Td>
                  <Td label="Annual rent">
                    <Money amount={offer.annualRent} />
                    <div className="text-[11px] text-muted">{deltaOnCurrent(offer.annualRent, Number(t.annualRent))}</div>
                    {offer.status === "ACCEPTED" && <div className="text-[11px] font-semibold text-verde-700">accepted rent</div>}
                  </Td>
                  <Td label="Delivery / status">
                    <Badge value={offer.status} />
                    <div className="mt-1 text-[11px] text-muted">
                      {offer.sentToTenantAt
                        ? `Sent ${formatDubaiDateTime(offer.sentToTenantAt)}`
                        : offer.party === "LANDLORD" && offer.status === "SENT"
                          ? "Prepared · not sent to tenant"
                          : `Recorded ${formatDubaiDateTime(offer.createdAt)}`}
                    </div>
                  </Td>
                  <Td label="Frozen source" className="text-xs">
                    {offer.permittedMaxSnapshot != null ? (
                      <>
                        <div>Ceiling estimate <Money amount={offer.permittedMaxSnapshot} /></div>
                        <div className={offer.annualRent > offer.permittedMaxSnapshot ? "mt-1 font-semibold text-claret-700" : "mt-1 text-muted"}>
                          {offer.annualRent > offer.permittedMaxSnapshot
                            ? "Proposal above frozen estimate · review required"
                            : "Proposal at or below frozen estimate"}
                        </div>
                        {offer.indexCitation?.source && <div className="mt-1 text-muted">{offer.indexCitation.source}</div>}
                        {offer.indexCitation?.provisional && <div className="mt-1 font-semibold text-amber-700">Provisional source</div>}
                      </>
                    ) : (
                      <span className="text-muted">No frozen citation</span>
                    )}
                  </Td>
                  <Td label="Action">
                    <div className="flex flex-col items-start gap-2">
                      {current && canAccept && offer.status === "COUNTERED" && (
                        <form action={acceptOfferAction}>
                          <input type="hidden" name="offerId" value={offer.id} />
                          <input type="hidden" name="tenancyId" value={tenancyId} />
                          <button className="text-xs font-semibold text-navy-500 hover:underline">Accept counter</button>
                        </form>
                      )}
                      {current && canSend && offer.party === "LANDLORD" && offer.status === "SENT" && !offer.sentToTenant && (
                        <form action={sendOfferToTenantAction}>
                          <input type="hidden" name="offerId" value={offer.id} />
                          <input type="hidden" name="tenancyId" value={tenancyId} />
                          <button className="text-xs font-semibold text-navy-500 hover:underline">Send to tenant</button>
                        </form>
                      )}
                      {current && ownerContactId && canDecide && ["SEND_OFFER", "REVIEW_COUNTER"].includes(risk.nextAction.code) && (
                        <RequestOwnerApprovalForm offerId={offer.id} tenancyId={tenancyId} contactId={ownerContactId} />
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {canPropose ? (
        <Card>
          <h2 className="text-[15px] font-semibold text-navy-900">
            {risk.nextAction.code === "REVIEW_COUNTER" ? "Respond to tenant counter" : "Prepare renewal terms"}
          </h2>
          <p className="mb-4 mt-1 text-xs text-muted">Adding terms creates a new immutable version and supersedes the prior open version.</p>
          <form action={proposeOfferAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="renewalCaseId" value={risk.renewalCase.id} />
            <input type="hidden" name="tenancyId" value={tenancyId} />
            <Field label="Party">
              <select name="party" className={inputClass} defaultValue={risk.nextAction.code === "REVIEW_COUNTER" ? "LANDLORD" : "LANDLORD"}>
                <option value="LANDLORD">Landlord proposal</option>
                <option value="TENANT">Tenant counter</option>
              </select>
            </Field>
            <Field label="Annual rent (AED)"><input name="annualRent" type="number" min="1" step="1" required className={inputClass} /></Field>
            <Field label="Payment schedule"><input name="paymentSchedule" required className={inputClass} placeholder="4 cheques" /></Field>
            <Field label="Method"><input name="paymentMethod" className={inputClass} placeholder="Cheque" /></Field>
            <Button type="submit">Add terms version</Button>
          </form>
        </Card>
      ) : !canWrite && risk.nextAction.code === "PREPARE_TERMS" ? (
        <ReadOnlyNote>Renewal terms are prepared by an authorized renewal operator. You can review every persisted version above.</ReadOnlyNote>
      ) : null}

      {risk.nextAction.code === "AWAIT_TENANT" && (
        <Card className="border-amber-500/40 bg-amber-100/30">
          <h2 className="text-[15px] font-semibold text-navy-900">Awaiting tenant response</h2>
          <p className="mt-1 text-sm text-muted">The current proposal was delivered. This is a waiting state, not an operator mutation.</p>
        </Card>
      )}

      {risk.nextAction.code === "COMPLETE_RENEWAL" && acceptedOffer && (
        canDecide ? (
          <CompleteRenewalForm risk={risk} tenancyId={tenancyId} acceptedOffer={acceptedOffer} />
        ) : (
          <ReadOnlyNote>Terms are accepted. A fiduciary or manager creates the successor tenancy and completion record.</ReadOnlyNote>
        )
      )}
    </div>
  );
}

function CompleteRenewalForm({ risk, tenancyId, acceptedOffer }: { risk: RenewalRisk; tenancyId: string; acceptedOffer: RenewalRisk["offers"][number] }) {
  const t = risk.tenancy;
  const successorStart = new Date(t.endDate.getTime() + 86_400_000);
  const successorEnd = new Date(Date.UTC(successorStart.getUTCFullYear() + 1, successorStart.getUTCMonth(), successorStart.getUTCDate()));
  const match = acceptedOffer.paymentSchedule.match(/\d+/);
  const chequeCount = match && Number(match[0]) <= 12 ? match[0] : "";
  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-navy-900">Complete renewal</h2>
      <p className="mb-4 mt-1 text-xs text-muted">
        Accepted rent <Money amount={acceptedOffer.annualRent} /> is a persisted agreement, separate from the calculated ceiling estimate.
      </p>
      <form action={mintRenewedTenancyAction} className="space-y-3">
        <input type="hidden" name="renewalCaseId" value={risk.renewalCase!.id} />
        <input type="hidden" name="tenancyId" value={tenancyId} />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Successor start" required><input name="startDate" type="date" required defaultValue={isoDate(successorStart)} className={inputClass} /></Field>
          <Field label="Successor end" required><input name="endDate" type="date" required defaultValue={isoDate(successorEnd)} className={inputClass} /></Field>
          <Field label="Accepted annual rent (AED)" required><input name="annualRent" type="number" min="1" step="1" required defaultValue={acceptedOffer.annualRent} className={inputClass} /></Field>
          <Field label="Payment terms (optional)"><input name="paymentTermsNote" className={inputClass} placeholder="e.g. 4 cheques" /></Field>
          <Field label="Generate cheques (count)"><input name="chequeCount" type="number" min="0" max="12" defaultValue={chequeCount} className={inputClass} /></Field>
        </div>
        <FormActions note="Creates one successor tenancy and one renewal-completed evidence event. Existing service and concurrency guards remain authoritative.">
          <SubmitButton pendingLabel="Completing…">Create successor tenancy</SubmitButton>
        </FormActions>
      </form>
    </Card>
  );
}

function EvidenceView({
  events,
  successor,
  tenancyId,
  canReadEvidence,
  canExportEvidence,
}: {
  events: Awaited<ReturnType<typeof getRenewalWorkspace>>["events"];
  successor: Awaited<ReturnType<typeof getRenewalWorkspace>>["successor"];
  tenancyId: string;
  canReadEvidence: boolean;
  canExportEvidence: boolean;
}) {
  return (
    <div className="space-y-6">
      {successor && (
        <Card className="border-verde-100 bg-verde-100/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-navy-900">Renewal complete</h2>
              <p className="mt-1 text-sm text-muted">
                Successor term {formatDubaiDate(successor.startDate)} → {formatDubaiDate(successor.endDate)} · <Money amount={successor.annualRent} />/yr
              </p>
            </div>
            <LinkButton href={successor.href}>Open successor tenancy</LinkButton>
          </div>
        </Card>
      )}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-navy-900">Case evidence receipts</h2>
            <p className="mt-1 text-sm text-muted">Append-only events created by the existing renewal services. This view writes nothing.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canReadEvidence && <LinkButton href={`/evidence?tenancy=${tenancyId}&category=renewals&print=1`}>Print activity record</LinkButton>}
            {canExportEvidence && <LinkButton href={`/api/v1/tenancies/${tenancyId}/evidence-pack.pdf`}>Download evidence pack</LinkButton>}
          </div>
        </div>
      </Card>
      {!canReadEvidence ? (
        <EmptyState title="Evidence detail is restricted" message="Your role can review the case status and task receipts, but the full evidence timeline requires evidence-read access." />
      ) : events.length === 0 ? (
        <EmptyState title="No case evidence yet" message="Receipts appear as trusted renewal actions are recorded." />
      ) : (
        <ol className="space-y-3">
          {events.map((event) => <li key={event.id}><EvidenceEventCard event={event} /></li>)}
        </ol>
      )}
    </div>
  );
}

function DetailsView({
  risk,
  successor,
}: {
  risk: RenewalRisk;
  successor: Awaited<ReturnType<typeof getRenewalWorkspace>>["successor"];
}) {
  const t = risk.tenancy;
  const position = risk.position;
  const total = Math.max(1, daysBetween(t.startDate, t.endDate));
  const gateLeft = Math.min(100, Math.max(0, (daysBetween(t.startDate, risk.noticeGateAt) / total) * 100));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KeyDate label="Last day to serve a change notice" value={formatDubaiDate(risk.noticeGateAt)} note={`${t.noticePeriodDays} days before expiry`} hot={!risk.gatePassed && risk.daysToGate <= 30} />
        <KeyDate label="Contract expiry" value={formatDubaiDate(risk.expiresAt)} note="review recorded notice and terms" />
        <KeyDate label="Renewal date" value={formatDubaiDate(risk.renewalDate)} note="new term begins" />
        <KeyDate label="Window remaining" value={risk.gatePassed ? "Gate passed" : `${risk.daysToGate} days`} note="to the recorded notice gate" hot={!risk.gatePassed && risk.daysToGate <= 30} />
      </div>

      <Card>
        <h2 className="mb-4 text-[15px] font-semibold text-navy-900">Contract timeline</h2>
        <div className="relative h-3 rounded-full bg-verde-100">
          <div className="absolute inset-y-0 right-0 rounded-r-full bg-claret-100" style={{ width: `${100 - gateLeft}%` }} />
          <div className="absolute -top-1 bottom-[-4px] w-0.5 bg-navy-900" style={{ left: `${gateLeft}%` }} />
        </div>
        <div className="mt-2 flex justify-between gap-3 text-xs text-muted">
          <span>{formatDubaiDate(t.startDate)} · start</span>
          <span className="text-center text-navy-900">notice gate · {formatDubaiDate(risk.noticeGateAt)}</span>
          <span className="text-right">{formatDubaiDate(t.endDate)} · expiry</span>
        </div>
      </Card>

      <Card className="border-line bg-ivory-100">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-navy-900">Index-based position · Decree 43</h2>
          {risk.latestIndex && (
            <span className="figure text-xs text-muted">
              {risk.latestIndex.source} · captured {formatDubaiDate(risk.latestIndex.capturedAt)}
              {risk.latestIndex.provisional && <span className="ml-2 font-semibold text-amber-700">awaiting verification</span>}
            </span>
          )}
        </div>
        {position ? (
          <>
            <CeilingScale
              current={position.currentRent}
              ceiling={position.ceiling}
              bandPct={position.bandPct}
              markers={risk.offers.filter((offer) => ["SENT", "COUNTERED", "ACCEPTED"].includes(offer.status)).map((offer) => ({ label: `AED ${offer.annualRent.toLocaleString("en-AE")}`, value: offer.annualRent, party: offer.party }))}
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="Current rent" value={<Money amount={position.currentRent} />} info="The annual rent recorded on the current tenancy." />
              <Fact label="Index average market rent" value={<Money amount={position.marketRentAvg} />} info="The captured source figure used for this estimate." />
              <Fact label="Calculated ceiling estimate" value={<Money amount={position.ceiling} />} info="A rule-based upper-bound estimate, not an entitlement or proposed rent." />
              <Fact label="Estimated uplift / yr" value={<Money amount={position.valueAtRisk} />} info="The difference between current rent and the calculated estimate." />
            </div>
            <p className="mt-4 rounded bg-white/70 p-3 text-sm text-navy-700">
              The calculation produces an estimated band of <b>{position.bandPct}%</b>. Proposed and accepted rents are separate human decisions retained under Terms.
            </p>
          </>
        ) : (
          <EmptyState title="No index position" message="No source figure is recorded for this renewal assessment." />
        )}
      </Card>

      <Card>
        <h2 className="text-[15px] font-semibold text-navy-900">Responsibility boundary</h2>
        <p className="mb-4 mt-1 text-xs text-muted">Seneschal owns the software, workflow, and record. Regulated execution remains with an appropriately authorized party.</p>
        <Table headers={["Layer", "Responsible"]}>
          <WhoRow layer="Source capture and rule-based estimate" owner="Authorized renewal operator" />
          <WhoRow layer="Workflow, documents, and evidence record" owner="Seneschal" />
          <WhoRow layer="Notice decision and service" owner="Decision-authorized fiduciary / manager" />
          <WhoRow layer="Legal or regulated execution" owner="Appropriately licensed partner where required" />
        </Table>
      </Card>

      {successor && (
        <Card className="border-verde-100 bg-verde-100/30">
          <h2 className="text-[15px] font-semibold text-navy-900">Successor tenancy</h2>
          <p className="mt-1 text-sm text-muted">{formatDubaiDate(successor.startDate)} → {formatDubaiDate(successor.endDate)} · <Money amount={successor.annualRent} />/yr</p>
          <div className="mt-3"><LinkButton href={successor.href}>Open successor tenancy</LinkButton></div>
        </Card>
      )}
    </div>
  );
}

const SERVICE_METHODS = ["EMAIL", "COURIER", "IN_PERSON", "REGISTERED_POST", "OTHER"] as const;

function NoticeServiceCard({
  renewalCaseId,
  tenancyId,
  notice,
  canDecide,
  embedded = false,
}: {
  renewalCaseId: string;
  tenancyId: string;
  notice: RenewalRisk["currentNotice"];
  canDecide: boolean;
  embedded?: boolean;
}) {
  const served = notice?.status === "SERVED";
  const pending = notice?.status === "SERVICE_RECORDED_PENDING_EVIDENCE";
  const label = (method: string) => method.replace(/_/g, " ").toLowerCase();
  const content = (
    <>
      <p className="mb-3 text-xs text-muted">
        A notice is recorded as served only with a delivery reference, service document, or signed attestation.
      </p>
      {served ? (
        <div className="rounded border border-verde-100 bg-verde-100/40 p-3 text-sm text-verde-700">
          Notice served{notice.serviceMethod ? ` via ${label(notice.serviceMethod)}` : ""}, with evidence on file.
        </div>
      ) : canDecide ? (
        <>
          {pending && <div className="mb-3 rounded border border-amber-500/40 bg-amber-100/50 p-3 text-sm text-amber-700">Service is recorded but remains awaiting proof. The case has not advanced to served.</div>}
          <form action={pending ? confirmNoticeServiceAction : serveNoticeAction} className="space-y-3">
            <input type="hidden" name="renewalCaseId" value={renewalCaseId} />
            <input type="hidden" name="tenancyId" value={tenancyId} />
            {pending && <input type="hidden" name="noticeId" value={notice!.id} />}
            <Field label="Service method">
              <select name="serviceMethod" defaultValue={notice?.serviceMethod ?? "EMAIL"} className={inputClass}>
                {SERVICE_METHODS.map((method) => <option key={method} value={method}>{label(method)}</option>)}
              </select>
            </Field>
            <fieldset className="space-y-3 rounded border border-line bg-ivory-100/60 p-3">
              <legend className="t-label px-1 text-muted">Proof of service — provide at least one</legend>
              <Field label="Delivery reference" hint="Courier tracking no., registered-post ref, or inbox reference.">
                <input name="serviceRef" className={inputClass} placeholder="courier / inbox ref" />
              </Field>
              <Field label="Service document" hint="A delivery receipt, signed copy, or similar.">
                <input type="file" name="file" className="text-sm" />
              </Field>
              <label className="flex items-center gap-2 text-sm text-navy-700"><input type="checkbox" name="attest" value="yes" /> I attest this notice was served as recorded</label>
              <Field label="Attested by (name)"><input name="attestedBy" className={inputClass} /></Field>
            </fieldset>
            <FormActions note={pending ? "Proof is required to move the notice to served." : "Without proof, service remains recorded but awaiting evidence."}>
              <Button type="submit" variant="secondary">{pending ? "Confirm service with evidence" : "Record notice service"}</Button>
            </FormActions>
          </form>
        </>
      ) : (
        <ReadOnlyNote>Notice service and proof are recorded by a decision-authorized fiduciary or manager.</ReadOnlyNote>
      )}
    </>
  );
  return embedded ? content : <Card>{content}</Card>;
}

function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-line bg-ivory-100 p-3 text-sm text-muted">{children}</p>;
}

function WhoRow({ layer, owner }: { layer: string; owner: string }) {
  return <tr><Td>{layer}</Td><Td className="font-medium text-navy-900">{owner}</Td></tr>;
}

function KeyDate({ label, value, note, hot = false }: { label: string; value: string; note: string; hot?: boolean }) {
  return (
    <div className={`rounded border p-3 ${hot ? "border-claret-100 bg-claret-100/40" : "border-line bg-ivory-100"}`}>
      <div className="text-[12px] text-muted">{label}</div>
      <div className={`figure mt-1 text-lg font-semibold ${hot ? "text-claret-700" : "text-navy-900"}`}>{value}</div>
      <div className="text-[11px] text-muted">{note}</div>
    </div>
  );
}

function Fact({ label, value, info }: { label: string; value: React.ReactNode; info?: string }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[12px] text-muted">{label}{info && <InfoTooltip text={info} />}</div>
      <div className="figure mt-0.5 text-lg text-navy-900">{value}</div>
    </div>
  );
}

function deltaOnCurrent(rent: number, current: number): string {
  if (!(current > 0)) return "";
  const pct = Math.round((rent / current - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% on current`;
}

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
    return <div className="rounded border border-line bg-white/60 p-4 text-sm text-navy-700">The rule-based calculation produces no estimated permissible increase. Review the captured source before action.</div>;
  }
  const span = ceiling - current;
  const at = (value: number) => Math.min(100, Math.max(0, ((value - current) / span) * 100));
  return (
    <div className="px-1 pb-1 pt-8">
      <div className="relative h-2 rounded-full bg-gradient-to-r from-verde-100 to-amber-100">
        <div className="absolute -top-1.5 right-0 h-5 w-0.5 bg-claret-500" />
        {markers.map((marker, index) => (
          <div key={`${marker.label}-${index}`} className="absolute top-1/2" style={{ left: `${at(marker.value)}%` }}>
            <span className={`figure absolute -top-7 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold ${marker.party === "TENANT" ? "text-amber-700" : "text-navy-900"}`}>{marker.label}</span>
            <span className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${marker.party === "TENANT" ? "bg-amber-500" : "bg-navy-900"}`} />
          </div>
        ))}
      </div>
      <div className="figure mt-3 flex justify-between text-[11px] text-muted">
        <span>current · AED {current.toLocaleString("en-AE")}</span>
        <span className="text-claret-700">ceiling estimate · AED {ceiling.toLocaleString("en-AE")}</span>
      </div>
    </div>
  );
}
