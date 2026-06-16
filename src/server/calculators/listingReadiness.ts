// Deterministic listing-readiness calculator (1B). Like the rent and date
// calculators, the result carries { rule, version, inputs } so every listing can
// cite why its score is what it is. A listing may only be PUBLISHED once it clears
// the readiness gate — advertising a Dubai unit requires a valid RERA/Trakheesi
// (Madmoun) permit, so that check is mandatory, not just weighted.

export interface ListingReadinessInput {
  askingRent: number | null;
  availableFrom: Date | null;
  furnished: boolean | null;
  description: string | null;
  permitRef: string | null;
  /** Denormalized from the owning Property — completeness signals for buyers. */
  bedrooms: number | null;
  sizeSqft: number | null;
}

export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  weight: number;
  /** Mandatory checks gate publication regardless of total score. */
  required?: boolean;
}

export interface ListingReadinessResult {
  /** 0..100, weighted fraction of checks passed. */
  score: number;
  checks: ReadinessCheck[];
  /** True only when every required check passes AND score ≥ PUBLISH_THRESHOLD. */
  canPublish: boolean;
  rule: string;
  version: string;
  inputs: Record<string, unknown>;
}

export const PUBLISH_THRESHOLD = 70;
const MIN_DESCRIPTION_LEN = 40;

/** Score a listing's marketing-readiness and whether it may be published. */
export function listingReadiness(input: ListingReadinessInput): ListingReadinessResult {
  const checks: ReadinessCheck[] = [
    { key: "permitRef", label: "RERA permit recorded", ok: !!input.permitRef?.trim(), weight: 25, required: true },
    { key: "askingRent", label: "Asking rent set", ok: (input.askingRent ?? 0) > 0, weight: 20, required: true },
    { key: "availableFrom", label: "Availability date set", ok: input.availableFrom != null, weight: 15 },
    {
      key: "description",
      label: "Description (40+ characters)",
      ok: (input.description?.trim().length ?? 0) >= MIN_DESCRIPTION_LEN,
      weight: 15,
    },
    { key: "furnished", label: "Furnishing specified", ok: input.furnished != null, weight: 5 },
    { key: "bedrooms", label: "Bedrooms recorded", ok: input.bedrooms != null, weight: 10 },
    { key: "sizeSqft", label: "Size recorded", ok: input.sizeSqft != null, weight: 10 },
  ];

  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const earned = checks.reduce((sum, c) => sum + (c.ok ? c.weight : 0), 0);
  const score = Math.round((earned / total) * 100);
  const requiredOk = checks.every((c) => !c.required || c.ok);

  return {
    score,
    checks,
    canPublish: requiredOk && score >= PUBLISH_THRESHOLD,
    rule: "listing_readiness",
    version: "v1",
    inputs: {
      askingRent: input.askingRent,
      availableFrom: input.availableFrom?.toISOString().slice(0, 10) ?? null,
      furnished: input.furnished,
      hasDescription: (input.description?.trim().length ?? 0) >= MIN_DESCRIPTION_LEN,
      permitRef: input.permitRef ? true : false,
      bedrooms: input.bedrooms,
      sizeSqft: input.sizeSqft,
    },
  };
}
