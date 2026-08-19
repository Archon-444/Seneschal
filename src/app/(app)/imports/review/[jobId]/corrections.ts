import type { ExtractionFields } from "@/server/services/extraction";
import type { ImportPartyFields, ImportRowData } from "@/server/services/imports";

// Pure diff, deliberately NOT in actions.ts: a "use server" module may only
// export async server actions, and this needs to be unit-testable in isolation.

/** Extraction keys for a party's sub-fields, mapped to the reviewed shape. */
const PARTY_SUBFIELDS: { prefix: "landlord" | "tenant"; key: keyof ImportPartyFields }[] = (
  ["landlord", "tenant"] as const
).flatMap((prefix) =>
  (
    ["emiratesId", "email", "phone", "nationality", "company", "licenseNo", "licensingAuthority"] as const
  ).map((key) => ({ prefix, key })),
);

const SCALAR_KEYS: (keyof ImportRowData)[] = [
  "community", "building", "unitNo", "propertyType", "bedrooms", "usage", "ejariNo",
  "startDate", "endDate", "annualRent", "depositAmount", "noticePeriodDays",
  "landlordName", "tenantName", "plotNo", "makaniNo", "dewaPremiseNo", "sizeSqm",
  "paymentTermsNote",
];

function same(a: unknown, b: unknown): boolean {
  return String(a ?? "") === String(b ?? "");
}

/**
 * Every reviewer change becomes a FIELD_CORRECTED evidence event.
 *
 * This used to be an allowlist of 14 scalars, which silently excluded the party
 * sub-fields and every payment item — so after the review screen made cheque
 * amounts and due dates editable, a reviewer could change AED 36,000 to AED
 * 3,600 and the trail would show only FIELD_CONFIRMED. On a product whose whole
 * claim is the record, the correction is exactly what has to be recorded.
 */
export function diffCorrections(
  original: ExtractionFields,
  reviewed: ImportRowData,
): Record<string, { from: unknown; to: unknown }> {
  const corrections: Record<string, { from: unknown; to: unknown }> = {};

  for (const key of SCALAR_KEYS) {
    const before = original[key]?.value ?? null;
    const after = reviewed[key] ?? null;
    if (!same(before, after)) corrections[key] = { from: before, to: after };
  }

  for (const { prefix, key } of PARTY_SUBFIELDS) {
    // extraction emits landlordEmiratesId; the reviewed row nests it under landlord
    const extractionKey = `${prefix}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
    const before = original[extractionKey]?.value ?? null;
    const after = reviewed[prefix]?.[key] ?? null;
    if (!same(before, after)) corrections[extractionKey] = { from: before, to: after };
  }

  const beforeItems = (original.paymentItems?.value ?? []) as Record<string, unknown>[];
  const afterItems = reviewed.paymentItems ?? [];
  const seqs = new Set<number>([
    ...beforeItems.map((i) => Number(i.seq)),
    ...afterItems.map((i) => Number(i.seq)),
  ]);
  for (const seq of [...seqs].sort((a, b) => a - b)) {
    const b = beforeItems.find((i) => Number(i.seq) === seq);
    const a = afterItems.find((i) => Number(i.seq) === seq);
    if (!b || !a) {
      corrections[`paymentItems.${seq}`] = { from: b ?? null, to: a ?? null };
      continue;
    }
    for (const field of ["dueDate", "amount", "instrument", "chequeNo", "bank"] as const) {
      if (!same(b[field], a[field])) {
        corrections[`paymentItems.${seq}.${field}`] = { from: b[field] ?? null, to: a[field] ?? null };
      }
    }
  }

  return corrections;
}
