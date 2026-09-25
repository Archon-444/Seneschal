import { validateLinkToken } from "@/server/services/secureLinks";
import { isQuarantined } from "@/server/config/features";
import { getProofRequestForLink } from "@/server/services/externalProof";
import { getOfferForLink } from "@/server/services/renewals";
import { getApprovalForLink } from "@/server/services/approvals";
import { getListingForLink } from "@/server/services/listings";
import { getPassportForLink } from "@/server/services/tenantPassport";
import { renderTenantOfferPositionNote } from "@/server/services/renewalTemplates";
import { formatDubaiDate, renewalDate, todayInDubai } from "@/server/calculators/dates";
import { COPY, indexSourceName, monthsLabel, parseLinkLang, type LinkLang, type Pair } from "@/lib/linkCopy";
import { formatAed } from "@/lib/money";
import { UploadProofForm } from "./UploadProofForm";
import { TenantOfferForm } from "./TenantOfferForm";
import { ApprovalForm } from "./ApprovalForm";
import { EnquiryForm } from "./EnquiryForm";
import { Bi, BiLine, LinkShell, Sheet, Stamp, TermRow, valueLocale } from "./parts";

// Public secure-link pages: tenant renewal offers, owner sign-offs, external
// proof uploads. No login; the token lives only in the URL and is never logged
// or stored raw. Pages are bilingual (English and Arabic) by default, like
// Dubai tenancy paperwork; ?lang=en or ?lang=ar narrows to one language.

/** A date-only value in both languages. */
function dates(d: Date): Pair {
  return { en: formatDubaiDate(d), ar: formatDubaiDate(d, "ar") };
}

/** One of a pair, for values set in a single language (money, dates). */
function one(pair: Pair, lang: LinkLang): string {
  return lang === "ar" ? pair.ar : pair.en;
}

export default async function ExternalLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const { token } = await params;
  const lang = parseLinkLang((await searchParams).lang);
  const validation = await validateLinkToken(token);

  if (!validation.ok) return <Unavailable lang={lang} />;

  // Pilot quarantine (see QUARANTINE.md). Gate on the link PURPOSE at branch
  // dispatch — ahead of consume and any data fetch — so a held PASSPORT_SHARE/
  // LISTING_VIEW token stays dormant (useCount untouched) rather than burned.
  if (
    (validation.link.purpose === "LISTING_VIEW" && isQuarantined("listings")) ||
    (validation.link.purpose === "PASSPORT_SHARE" && isQuarantined("passport"))
  ) {
    return <Unavailable lang={lang} />;
  }

  if (validation.link.purpose === "LISTING_VIEW") {
    const listing = await getListingForLink(validation.link);
    if (!listing) {
      return (
        <DormantShell>
          <h1 className="font-display text-2xl text-navy-900">This listing is no longer available</h1>
        </DormantShell>
      );
    }
    const aed = (n: number) => formatAed(n);
    const unit = [listing.building, listing.unitNo ? `Unit ${listing.unitNo}` : null, listing.community]
      .filter(Boolean)
      .join(" · ");
    return (
      <DormantShell>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl text-navy-900">{listing.headline ?? unit}</h1>
          {listing.ownerVerified && (
            <span className="rounded-full bg-verde-100 px-2.5 py-1 text-xs font-medium text-verde-700">Verified landlord</span>
          )}
        </div>
        <p className="mt-1 text-sm text-navy-500">{unit}</p>

        <dl className="mt-5 divide-y divide-ivory-200 rounded-md border border-ivory-300">
          {listing.askingRent != null && <Row label="Asking rent" value={`${aed(listing.askingRent)} / year`} />}
          {listing.bedrooms != null && <Row label="Bedrooms" value={String(listing.bedrooms)} />}
          {listing.sizeSqft != null && <Row label="Size" value={`${listing.sizeSqft.toLocaleString("en-AE")} sqft`} />}
          {listing.furnished != null && <Row label="Furnishing" value={listing.furnished ? "Furnished" : "Unfurnished"} />}
          {listing.availableFrom && <Row label="Available from" value={listing.availableFrom.toISOString().slice(0, 10)} />}
          {listing.propertyType && <Row label="Type" value={listing.propertyType} />}
        </dl>
        {listing.description && <p className="mt-4 text-sm leading-relaxed text-navy-700">{listing.description}</p>}

        <div className="mt-7 border-t border-ivory-200 pt-5">
          <h2 className="font-display text-lg text-navy-900">Interested?</h2>
          <p className="mb-3 text-sm text-navy-500">Register your interest and the managing office will be in touch.</p>
          <EnquiryForm token={token} />
        </div>

        <div className="mt-8 rounded-md bg-ivory-100 p-4 text-xs leading-relaxed text-navy-500">
          <p className="font-medium text-navy-700">About this page</p>
          <p className="mt-1">
            Seneschal is a technology platform, not a broker or legal adviser. This listing is shared by the
            managing office on the owner&apos;s behalf. Your interaction with this link is recorded.
          </p>
        </div>
      </DormantShell>
    );
  }

  if (validation.link.purpose === "PASSPORT_SHARE") {
    const p = await getPassportForLink(validation.link);
    if (!p) {
      return (
        <DormantShell>
          <h1 className="font-display text-2xl text-navy-900">This passport is no longer available</h1>
        </DormantShell>
      );
    }
    const docLabel = (k: string) => k.replace(/_/g, " ").toLowerCase();
    return (
      <DormantShell>
        <h1 className="font-display text-2xl text-navy-900">{p.tenantName}</h1>
        <p className="mt-1 text-sm text-navy-500">Rental passport · shared with consent</p>

        <dl className="mt-5 divide-y divide-ivory-200 rounded-md border border-ivory-300">
          {p.employer && <Row label="Employer" value={p.employer} />}
          {p.jobTitle && <Row label="Role" value={p.jobTitle} />}
          {p.monthlyIncome != null && <Row label="Monthly income" value={formatAed(p.monthlyIncome)} />}
          {p.nationality && <Row label="Nationality" value={p.nationality} />}
          {p.householdSize != null && <Row label="Household size" value={String(p.householdSize)} />}
          {p.moveInBy && <Row label="Looking to move in by" value={p.moveInBy.toISOString().slice(0, 10)} />}
        </dl>
        {p.summary && <p className="mt-3 text-sm text-navy-700">{p.summary}</p>}

        {p.documentKinds.length > 0 && (
          <div className="mt-5">
            <div className="text-xs font-medium uppercase tracking-wide text-navy-500">Documents provided</div>
            <ul className="mt-1 text-sm text-navy-700">
              {p.documentKinds.map((k) => (
                <li key={k}>✓ {docLabel(k)}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-8 rounded-md bg-ivory-100 p-4 text-xs leading-relaxed text-navy-500">
          <p className="font-medium text-navy-700">About this page</p>
          <p className="mt-1">
            Seneschal is a technology platform, not a broker or legal adviser. This passport was shared by the
            tenant, with their recorded consent, to support a rental enquiry. Your interaction with this link is
            recorded.
          </p>
        </div>
      </DormantShell>
    );
  }

  if (validation.link.purpose === "TENANT_OFFER") {
    const offer = await getOfferForLink(validation.link);
    if (!offer) return <Unavailable lang={lang} />;

    const loc = valueLocale(lang);
    const money = (n: number) => formatAed(n, loc);
    const issued = dates(todayInDubai(validation.link.createdAt));
    const expires = dates(todayInDubai(validation.link.expiresAt));
    const start = offer.proposedStartDate ?? renewalDate(offer.currentEndDate).date;
    const term =
      offer.proposedStartDate && offer.proposedEndDate
        ? `${one(dates(offer.proposedStartDate), lang)} – ${one(dates(offer.proposedEndDate), lang)}`
        : [offer.termMonths != null ? one(monthsLabel(offer.termMonths), lang) : null, one(COPY.from(dates(start)), lang)]
            .filter(Boolean)
            .join(" · ");
    const diff = offer.proposedRent - offer.currentRent;
    const pct = offer.currentRent > 0 ? ((Math.abs(diff) / offer.currentRent) * 100).toFixed(1) : null;
    const hasFigure = offer.permittedMax != null || offer.marketRentAvg != null;
    const position = renderTenantOfferPositionNote({
      proposedRent: offer.proposedRent,
      currentRent: offer.currentRent,
      indexIndicatedMaximum: offer.permittedMax,
      indexAverage: offer.marketRentAvg,
      capturedOn: offer.indexCapturedAt ? dates(offer.indexCapturedAt) : null,
      sourceName: indexSourceName(offer.indexSourceKind),
      provisional: offer.indexProvisional,
    });
    const stamp = COPY.offerStamp(offer.version, issued);

    return (
      <LinkShell lang={lang}>
        <Sheet>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-ink-muted" dir="ltr">
                {offer.unit}
              </p>
              <h1 className="mt-1 font-slab text-[28px] font-semibold leading-tight">
                <Bi pair={COPY.offerTitle} lang={lang} arClassName={lang === "both" ? "mt-1 text-xl" : ""} />
              </h1>
            </div>
            <Stamp rtl={lang === "ar"}>
              {lang === "ar" ? (
                <span lang="ar">{stamp.ar}</span>
              ) : (
                <>
                  Offer v{offer.version}
                  <br />
                  {issued.en}
                </>
              )}
            </Stamp>
          </div>

          <p className="mt-4 text-[15px] leading-relaxed">
            <Bi pair={COPY.offerIntro(offer.unit)} lang={lang} arClassName="mt-1 text-ink-soft" />
          </p>

          <dl className="mt-4">
            <TermRow label={COPY.proposedRent} lang={lang}>
              <span className="figure text-lg font-semibold">{money(offer.proposedRent)}</span>
            </TermRow>
            <TermRow label={COPY.currentRent} lang={lang}>
              <span className="figure">{money(offer.currentRent)}</span>
            </TermRow>
            <TermRow label={COPY.change} lang={lang}>
              {diff === 0 ? (
                one(COPY.noChange, lang)
              ) : lang === "ar" ? (
                <span className="figure">
                  {diff > 0 ? COPY.increaseWord : COPY.decreaseWord} {money(Math.abs(diff))}
                  {pct ? ` (${pct}%)` : ""}
                </span>
              ) : (
                <span className="figure">
                  {diff > 0 ? "+" : "−"}
                  {money(Math.abs(diff))}
                  {pct ? ` (${pct}%)` : ""}
                </span>
              )}
            </TermRow>
            <TermRow label={COPY.newTerm} lang={lang}>
              <span className="figure">{term}</span>
            </TermRow>
            <TermRow label={COPY.payment} lang={lang}>
              <span dir="ltr">
                {offer.paymentSchedule}
                {offer.paymentMethod ? ` · ${offer.paymentMethod}` : ""}
              </span>
            </TermRow>
            {offer.permittedMax != null ? (
              <TermRow label={COPY.indexMaximum} lang={lang}>
                <span className="figure">{money(offer.permittedMax)}</span>
                <sup className="figure ms-0.5 text-[11px] font-semibold text-seal">1</sup>
              </TermRow>
            ) : offer.marketRentAvg != null ? (
              <TermRow label={COPY.indexAverage} lang={lang}>
                <span className="figure">{money(offer.marketRentAvg)}</span>
                <sup className="figure ms-0.5 text-[11px] font-semibold text-seal">1</sup>
              </TermRow>
            ) : null}
          </dl>

          <div className="mt-1 flex gap-2 border-t border-rule pt-3 text-[13px] leading-relaxed text-ink-soft">
            {hasFigure && <sup className="figure mt-2 text-[11px] font-semibold text-seal">1</sup>}
            <div className="space-y-1.5">
              <Bi pair={position} lang={lang} as="p" />
            </div>
          </div>

          {offer.note && (
            <div className="mt-4 rounded-md bg-desk/60 px-4 py-3 text-sm">
              <p className="text-[13px] text-ink-muted">
                <BiLine pair={COPY.officeMessage} lang={lang} />
              </p>
              <p className="mt-1" dir="auto">
                “{offer.note}”
              </p>
            </div>
          )}
        </Sheet>

        <section aria-labelledby="answer-heading" className="mt-7 space-y-3">
          <h2 id="answer-heading" className="font-slab text-xl font-semibold">
            <BiLine pair={COPY.yourAnswer} lang={lang} />
          </h2>
          <p className="text-sm text-ink-muted">
            <Bi pair={COPY.worksUntil(expires)} lang={lang} />
          </p>
          <TenantOfferForm token={token} lang={lang} version={offer.version} />
        </section>

        <section aria-labelledby="after-heading" className="mt-9 space-y-3">
          <h2 id="after-heading" className="font-slab text-lg font-semibold">
            <BiLine pair={COPY.afterTitle} lang={lang} />
          </h2>
          <ol className="space-y-3 text-sm leading-relaxed">
            {COPY.afterSteps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="figure w-4 shrink-0 text-ink-muted">{i + 1}</span>
                <span>
                  <Bi pair={step} lang={lang} arClassName="mt-1 text-ink-soft" />
                </span>
              </li>
            ))}
          </ol>
        </section>

        <Footer lang={lang} />
      </LinkShell>
    );
  }

  if (validation.link.purpose === "APPROVAL") {
    const approval = await getApprovalForLink(validation.link);
    if (!approval) return <Unavailable lang={lang} />;
    const money = (n: number) => formatAed(n, valueLocale(lang));
    return (
      <LinkShell lang={lang}>
        <Sheet>
          <p className="text-[13px] text-ink-muted" dir="ltr">
            {approval.unit}
          </p>
          <h1 className="mt-1 font-slab text-[28px] font-semibold leading-tight">
            <Bi pair={COPY.approvalTitle} lang={lang} arClassName={lang === "both" ? "mt-1 text-xl" : ""} />
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed">
            <Bi pair={COPY.approvalIntro(approval.unit)} lang={lang} arClassName="mt-1 text-ink-soft" />
          </p>
          <dl className="mt-4">
            <TermRow label={COPY.party} lang={lang}>
              {one(approval.party === "LANDLORD" ? COPY.partyLandlord : COPY.partyTenant, lang)}
            </TermRow>
            <TermRow label={COPY.version} lang={lang}>
              <span className="figure">v{approval.version}</span>
            </TermRow>
            <TermRow label={COPY.proposedRent} lang={lang}>
              <span className="figure text-lg font-semibold">{money(approval.annualRent)}</span>
            </TermRow>
            <TermRow label={COPY.payment} lang={lang}>
              <span dir="ltr">
                {approval.paymentSchedule}
                {approval.paymentMethod ? ` · ${approval.paymentMethod}` : ""}
              </span>
            </TermRow>
            {approval.termMonths != null && (
              <TermRow label={COPY.newTerm} lang={lang}>
                {one(monthsLabel(approval.termMonths), lang)}
              </TermRow>
            )}
          </dl>
          <p className="mt-1 border-t border-rule pt-3 text-[13px] leading-relaxed text-ink-soft">
            <Bi pair={COPY.approvalAbout} lang={lang} as="span" />
          </p>
        </Sheet>
        <section aria-labelledby="decision-heading" className="mt-7 space-y-3">
          <h2 id="decision-heading" className="font-slab text-xl font-semibold">
            <BiLine pair={COPY.yourDecision} lang={lang} />
          </h2>
          <ApprovalForm token={token} lang={lang} />
        </section>
        <Footer lang={lang} />
      </LinkShell>
    );
  }

  const request = await getProofRequestForLink(validation.link);
  if (!request) return <Unavailable lang={lang} />;

  return (
    <LinkShell lang={lang}>
      <Sheet>
        <h1 className="font-slab text-[26px] font-semibold leading-tight" dir="auto">
          {request.title}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft" dir="auto">
          {request.requiredEvidence}
        </p>
        {request.dueAt && (
          <p className="figure mt-2 text-[13px] text-ink-muted">
            <Bi pair={COPY.requestedBy(dates(request.dueAt))} lang={lang} />
          </p>
        )}
        <div className="mt-6 border-t border-rule pt-5">
          <UploadProofForm token={token} lang={lang} />
        </div>
      </Sheet>
      <section aria-labelledby="privacy-heading" className="mt-6 rounded-md border border-sheet-line bg-white/60 p-4 text-[13px] leading-relaxed text-ink-soft">
        <h2 id="privacy-heading" className="font-semibold text-ink">
          <BiLine pair={COPY.privacyTitle} lang={lang} />
        </h2>
        <div className="mt-1 space-y-2">
          <Bi pair={COPY.privacyBody} lang={lang} as="p" />
        </div>
      </section>
      <Footer lang={lang} />
    </LinkShell>
  );
}

function Unavailable({ lang }: { lang: LinkLang }) {
  return (
    <LinkShell lang={lang}>
      <Sheet>
        <h1 className="font-slab text-[26px] font-semibold leading-tight">
          <Bi pair={COPY.unavailableTitle} lang={lang} arClassName={lang === "both" ? "mt-1 text-xl" : ""} />
        </h1>
        <div className="mt-3 space-y-2 text-[15px] leading-relaxed text-ink-soft">
          <Bi pair={COPY.unavailableBody} lang={lang} as="p" />
        </div>
      </Sheet>
      <Footer lang={lang} />
    </LinkShell>
  );
}

function Footer({ lang }: { lang: LinkLang }) {
  return (
    <footer className="mt-10 space-y-1.5 text-xs leading-relaxed text-ink-muted">
      <Bi pair={COPY.keepsRecords} lang={lang} as="p" />
      <Bi pair={COPY.recorded} lang={lang} as="p" />
    </footer>
  );
}

// Quarantined purposes (listing, passport) keep their original layout; they
// are unreachable while QUARANTINE.md holds and are not part of the redesign.
function DormantShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-lg rounded-lg border border-ivory-300 bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <dt className="text-navy-500">{label}</dt>
      <dd className="figure font-medium text-navy-900">{value}</dd>
    </div>
  );
}
