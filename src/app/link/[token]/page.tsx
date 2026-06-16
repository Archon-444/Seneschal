import { validateLinkToken } from "@/server/services/secureLinks";
import { getProofRequestForLink } from "@/server/services/externalProof";
import { getOfferForLink } from "@/server/services/renewals";
import { getListingForLink } from "@/server/services/listings";
import { UploadProofForm } from "./UploadProofForm";
import { TenantOfferForm } from "./TenantOfferForm";

// Screen 13 — external proof upload. Mobile-first, no login. The token lives
// only in the URL; we never log or store it raw.

export default async function ExternalLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const validation = await validateLinkToken(token);

  if (!validation.ok) {
    return (
      <SafeShell>
        <h1 className="font-display text-2xl text-navy-900">This link is no longer available</h1>
        <p className="mt-3 text-sm text-navy-500">
          The link may have expired, been used already, or been withdrawn. Please contact the person
          who sent it to request a new one.
        </p>
      </SafeShell>
    );
  }

  if (validation.link.purpose === "LISTING_VIEW") {
    const listing = await getListingForLink(validation.link);
    if (!listing) {
      return (
        <SafeShell>
          <h1 className="font-display text-2xl text-navy-900">This listing is no longer available</h1>
        </SafeShell>
      );
    }
    const aed = (n: number) => `AED ${n.toLocaleString("en-AE")}`;
    const unit = [listing.building, listing.unitNo ? `Unit ${listing.unitNo}` : null, listing.community]
      .filter(Boolean)
      .join(" · ");
    return (
      <SafeShell>
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-2xl text-navy-900">{listing.headline ?? unit}</h1>
          {listing.ownerVerified && (
            <span className="rounded-full bg-verde/10 px-2.5 py-1 text-xs font-medium text-verde">Verified landlord</span>
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

        <div className="mt-8 rounded-md bg-ivory-100 p-4 text-xs leading-relaxed text-navy-500">
          <p className="font-medium text-navy-700">About this page</p>
          <p className="mt-1">
            Seneschal is a technology platform, not a broker or legal adviser. This listing is shared by the
            managing office on the owner&apos;s behalf. Your interaction with this link is recorded.
          </p>
        </div>
      </SafeShell>
    );
  }

  if (validation.link.purpose === "TENANT_OFFER") {
    const offer = await getOfferForLink(validation.link);
    if (!offer) {
      return (
        <SafeShell>
          <h1 className="font-display text-2xl text-navy-900">This link is no longer available</h1>
        </SafeShell>
      );
    }
    const fmt = (n: number) => `AED ${n.toLocaleString("en-AE")}`;
    return (
      <SafeShell>
        <h1 className="font-display text-2xl text-navy-900">Renewal proposal</h1>
        <p className="mt-1 text-sm text-navy-500">{offer.unit} · from your landlord via the managing office</p>

        <dl className="mt-5 divide-y divide-ivory-200 rounded-md border border-ivory-300">
          <Row label="Proposed annual rent" value={fmt(offer.proposedRent)} />
          <Row label="Payment" value={`${offer.paymentSchedule}${offer.paymentMethod ? ` · ${offer.paymentMethod}` : ""}`} />
          {offer.termMonths != null && <Row label="Term" value={`${offer.termMonths} months`} />}
          <Row label="Your current rent" value={fmt(offer.currentRent)} />
          {offer.marketRentAvg != null && (
            <Row label="Index average (for comparison)" value={fmt(offer.marketRentAvg)} />
          )}
        </dl>
        {offer.note && <p className="mt-3 text-sm text-navy-700">“{offer.note}”</p>}

        <div className="mt-6">
          <TenantOfferForm token={token} />
        </div>
        <div className="mt-8 rounded-md bg-ivory-100 p-4 text-xs leading-relaxed text-navy-500">
          <p className="font-medium text-navy-700">About this page</p>
          <p className="mt-1">
            Seneschal is a technology platform, not a broker or legal adviser. This proposal is based on
            landlord-provided data and, where shown, an official index figure captured on its own date. You
            may seek independent advice before responding. Your interaction with this link is recorded.
          </p>
        </div>
      </SafeShell>
    );
  }

  const request = await getProofRequestForLink(validation.link);
  if (!request) {
    return (
      <SafeShell>
        <h1 className="font-display text-2xl text-navy-900">This link is no longer available</h1>
      </SafeShell>
    );
  }

  return (
    <SafeShell>
      <h1 className="font-display text-2xl text-navy-900">{request.title}</h1>
      <p className="mt-2 text-sm text-navy-700">{request.requiredEvidence}</p>
      {request.dueAt && (
        <p className="figure mt-1 text-xs text-navy-500">
          Requested by {request.dueAt.toISOString().slice(0, 10)}
        </p>
      )}
      <div className="mt-6">
        <UploadProofForm token={token} />
      </div>
      <div className="mt-8 rounded-md bg-ivory-100 p-4 text-xs leading-relaxed text-navy-500">
        <p className="font-medium text-navy-700">Privacy notice (v1)</p>
        <p className="mt-1">
          Files you upload here are stored privately and shared only with the workspace that
          requested them, to evidence this specific request. Your interaction with this link is
          recorded. By uploading you consent to this processing. Questions? Reply to the email that
          brought you here.
        </p>
      </div>
    </SafeShell>
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

function SafeShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-ivory-100 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-lg border border-ivory-300 bg-white p-6 shadow-sm">
        <div className="font-display mb-6 text-lg text-navy-300">Seneschal · secure upload</div>
        {children}
      </div>
    </main>
  );
}
