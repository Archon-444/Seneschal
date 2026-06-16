import { redirect } from "next/navigation";
import Link from "next/link";
import { requireCtx } from "@/server/auth/request";
import { getListing } from "@/server/services/listings";
import { listingReadiness } from "@/server/calculators/listingReadiness";
import { formatDubaiDate } from "@/server/calculators/dates";
import { Badge, Button, Card, Field, inputClass, Money, PageHeader } from "@/components/ui";
import { archiveListingAction, publishListingAction, updateListingAction } from "../actions";

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
                <span className={c.ok ? "text-verde" : "text-claret"}>{c.ok ? "✓" : "✗"}</span>
                <span className={c.ok ? "text-navy-900" : "text-muted"}>
                  {c.label}
                  {c.required ? <span className="text-claret"> *</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">* required to publish · advertising a unit requires a valid RERA permit</p>

          <div className="mt-5 flex flex-wrap gap-2">
            {canPublish ? (
              <form action={publishListingAction}>
                <input type="hidden" name="id" value={listing.id} />
                <Button type="submit">Publish</Button>
              </form>
            ) : listing.status !== "PUBLISHED" ? (
              <span className="text-sm text-muted">Complete the required items to publish.</span>
            ) : null}
            {listing.status !== "ARCHIVED" ? (
              <form action={archiveListingAction}>
                <input type="hidden" name="id" value={listing.id} />
                <Button type="submit" variant="secondary">Archive</Button>
              </form>
            ) : null}
          </div>
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
              <div className="sm:col-span-2 flex items-center gap-3">
                <Button type="submit">Save</Button>
                {listing.askingRent != null ? (
                  <span className="text-sm text-muted">Current asking <Money amount={String(listing.askingRent)} /></span>
                ) : null}
                {listing.availableFrom ? (
                  <span className="text-sm text-muted">· available {formatDubaiDate(listing.availableFrom)}</span>
                ) : null}
              </div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
