import { redirect } from "next/navigation";
import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { getListing } from "@/server/services/listings";
import { listListingOffers } from "@/server/services/offers";
import { listContractPacks, getContractPackUrl } from "@/server/services/contractPack";
import { listingReadiness } from "@/server/calculators/listingReadiness";
import { Badge, Card, DubaiDate, EmptyState, Field, inputClass, Money, PageHeader, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import {
  acceptOfferAction,
  archiveListingAction,
  generateContractPackAction,
  proposeOfferAction,
  publishListingAction,
  sendContractPackAction,
  signContractPackAction,
  updateListingAction,
} from "../actions";
import { ShareListing } from "../ShareListing";

function dateValue(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}
function propertyLabel(p: { community: string; building: string | null; unitNo: string | null }): string {
  return [p.building, p.unitNo ? `Unit ${p.unitNo}` : null, p.community].filter(Boolean).join(" · ");
}

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (ctx.role !== "LANDLORD") redirect("/portal");
  const { id } = await params;
  const listing = await getListing(ctx, id);
  const readiness = listingReadiness({
    askingRent: listing.askingRent != null ? Number(listing.askingRent) : null,
    availableFrom: listing.availableFrom,
    furnished: listing.furnished,
    description: listing.description,
    permitRef: listing.permitRef,
    bedrooms: listing.property.bedrooms,
    sizeSqft: listing.property.sizeSqft,
  });
  const canPublish = readiness.canPublish && listing.status !== "PUBLISHED";
  const offers = await listListingOffers(ctx, listing.id);
  const acceptedOffer = offers.find((o) => o.status === "ACCEPTED");
  const decided = !!acceptedOffer;
  const packs = await listContractPacks(ctx, listing.id);
  const packLinks = await Promise.all(
    packs.map(async (p) => ({ pack: p, url: (await getContractPackUrl(ctx, p.id)).url })),
  );

  return (
    <>
      <Link href="/portal/listings" className="mb-2 inline-block text-sm text-muted hover:underline">← Listings</Link>
      <PageHeader
        eyebrow="Listing"
        title={propertyLabel(listing.property)}
        subtitle={listing.headline ?? undefined}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Readiness + lifecycle */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg text-navy-900">Readiness</h2>
            <Badge value={listing.status} />
          </div>
          <div className="figure mb-4 text-3xl text-navy-900">{readiness.score}/100</div>
          <ul className="space-y-1.5 text-sm">
            {readiness.checks.map((c) => (
              <li key={c.key} className="flex items-center gap-2">
                <span className={c.ok ? "text-verde-700" : "text-claret-700"}>{c.ok ? "✓" : "✗"}</span>
                <span className={c.ok ? "text-navy-900" : "text-muted"}>
                  {c.label}
                  {c.required ? <span className="text-claret-700"> *</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">* required to publish · advertising a unit requires a valid RERA permit</p>

          <div className="mt-5 flex flex-wrap gap-2">
            {canPublish ? (
              <form action={publishListingAction}>
                <input type="hidden" name="id" value={listing.id} />
                <SubmitButton pendingLabel="Publishing…">Publish</SubmitButton>
              </form>
            ) : listing.status !== "PUBLISHED" ? (
              <span className="text-sm text-muted">Complete the required items to publish.</span>
            ) : null}
            {listing.status !== "ARCHIVED" ? (
              <form action={archiveListingAction}>
                <input type="hidden" name="id" value={listing.id} />
                <SubmitButton variant="secondary" pendingLabel="Archiving…">Archive</SubmitButton>
              </form>
            ) : null}
          </div>

          {listing.status === "PUBLISHED" && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 text-sm font-medium text-navy-900">Public link</div>
              <p className="mb-2 text-xs text-muted">Anyone with the link can view this listing — no account needed. The link is shown once.</p>
              <ShareListing listingId={listing.id} />
            </div>
          )}
        </Card>

        {/* Edit */}
        <div className="lg:col-span-2">
          <Card>
            <h2 className="font-display mb-3 text-lg text-navy-900">Listing details</h2>
            <form action={updateListingAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="id" value={listing.id} />
              <div className="sm:col-span-2">
                <Field label="Headline">
                  <input name="headline" defaultValue={listing.headline ?? ""} className={inputClass} />
                </Field>
              </div>
              <Field label="Asking rent (AED / year)">
                <input name="askingRent" type="number" min="0" defaultValue={listing.askingRent != null ? String(listing.askingRent) : ""} className={inputClass} />
              </Field>
              <Field label="Available from">
                <input name="availableFrom" type="date" defaultValue={dateValue(listing.availableFrom)} className={inputClass} />
              </Field>
              <Field label="Furnishing">
                <select name="furnished" defaultValue={listing.furnished == null ? "" : String(listing.furnished)} className={inputClass}>
                  <option value="">Unspecified</option>
                  <option value="true">Furnished</option>
                  <option value="false">Unfurnished</option>
                </select>
              </Field>
              <Field label="RERA permit ref">
                <input name="permitRef" defaultValue={listing.permitRef ?? ""} className={inputClass} placeholder="RERA-7781234" />
              </Field>
              <Field label="Permit expiry">
                <input name="permitExpiry" type="date" defaultValue={dateValue(listing.permitExpiry)} className={inputClass} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Description">
                  <textarea name="description" rows={3} defaultValue={listing.description ?? ""} className={inputClass} placeholder="40+ characters describing the unit, view, parking, fit-out…" />
                </Field>
              </div>
              <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
                {listing.askingRent != null ? (
                  <span className="text-sm text-muted">Current asking <Money amount={String(listing.askingRent)} /></span>
                ) : null}
                {listing.availableFrom ? (
                  <span className="text-sm text-muted">· available <DubaiDate value={listing.availableFrom} /></span>
                ) : null}
              </div>
            </form>
          </Card>

          <Card className="mt-6">
            <h2 className="font-display mb-3 text-lg text-navy-900">Offers</h2>
            {offers.length === 0 ? (
              <EmptyState title="No offers yet" message="Record a prospect's offer or propose your terms." />
            ) : (
              <Table stack headers={["v", "Party", "Annual rent", "Payment", "Status", ""]}>
                {offers.map((o) => (
                  <tr key={o.id}>
                    <Td label="v" className="figure">{o.version}</Td>
                    <Td label="Party">{o.party}</Td>
                    <Td label="Annual rent"><Money amount={String(o.annualRent)} /></Td>
                    <Td label="Payment">{o.paymentSchedule}</Td>
                    <Td label="Status"><Badge value={o.status} /></Td>
                    <Td>
                      {!decided && (o.status === "SENT" || o.status === "COUNTERED") ? (
                        <form action={acceptOfferAction}>
                          <input type="hidden" name="offerId" value={o.id} />
                          <input type="hidden" name="listingId" value={listing.id} />
                          <SubmitButton variant="secondary" pendingLabel="Accepting…">Accept</SubmitButton>
                        </form>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}

            {!decided && listing.status !== "ARCHIVED" && (
              <form action={proposeOfferAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="listingId" value={listing.id} />
                <Field label="From">
                  <select name="party" className={inputClass}>
                    <option value="LANDLORD">You (landlord terms)</option>
                    <option value="TENANT">A prospect&apos;s offer</option>
                  </select>
                </Field>
                <Field label="Annual rent (AED)">
                  <input name="annualRent" type="number" min="0" required className={inputClass} />
                </Field>
                <Field label="Payment">
                  <input name="paymentSchedule" className={inputClass} placeholder="4 cheques" />
                </Field>
                <Field label="Note">
                  <input name="note" className={inputClass} />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton pendingLabel="Recording…">Record offer</SubmitButton>
                </div>
              </form>
            )}
          </Card>

          {decided && (
            <Card className="mt-6">
              <h2 className="font-display mb-3 text-lg text-navy-900">Contract pack</h2>
              {packLinks.length === 0 ? (
                <p className="text-sm text-muted">An offer is accepted. Generate the summary pack of agreed terms for signature.</p>
              ) : (
                <div className="mb-3 space-y-3">
                  {packLinks.map(({ pack, url }) => (
                    <div key={pack.id} className="rounded-md border border-line p-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span>Pack · <DubaiDate value={pack.createdAt} /> · <Badge value={pack.status} /></span>
                        <a href={url} target="_blank" rel="noreferrer" className="text-gold-700 hover:underline">View PDF</a>
                      </div>
                      {pack.eSignRef ? <div className="mt-1 text-xs text-muted figure">e-sign ref: {pack.eSignRef}</div> : null}
                      {pack.status !== "SIGNED" && (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <input name="eSignRef" form={`esign-${pack.id}`} className={inputClass + " max-w-[14rem]"} placeholder="e-sign provider ref (optional)" />
                          {pack.status === "GENERATED" && (
                            <form id={`esign-${pack.id}`} action={sendContractPackAction}>
                              <input type="hidden" name="packId" value={pack.id} />
                              <input type="hidden" name="listingId" value={listing.id} />
                              <SubmitButton variant="secondary" pendingLabel="Saving…">Mark sent for signature</SubmitButton>
                            </form>
                          )}
                          <form action={signContractPackAction}>
                            <input type="hidden" name="packId" value={pack.id} />
                            <input type="hidden" name="listingId" value={listing.id} />
                            <SubmitButton variant="secondary" pendingLabel="Saving…">Mark signed</SubmitButton>
                          </form>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <form action={generateContractPackAction}>
                <input type="hidden" name="offerId" value={acceptedOffer!.id} />
                <input type="hidden" name="listingId" value={listing.id} />
                <SubmitButton variant="secondary" pendingLabel="Generating…">Generate contract pack</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
