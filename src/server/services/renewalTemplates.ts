// Renewal-facing copy templates (PR6c). Each rendered string runs through
// assertRenewalCopyCompliant before it's returned to a caller — the spec §0
// gate. New renewal templates MUST be registered here so the test in
// renewalCopy.test.ts catches a non-compliant addition before it ships.

import { assertRenewalCopyCompliant } from "./renewalCopy";

export interface NoticeTemplateInput {
  unit: string;
  currentRent: number;
  proposedRent: number;
  indexIndicatedMaximum: number;
  effectiveFrom: string; // ISO date-only
}

function aed(n: number): string {
  return `AED ${n.toLocaleString("en-AE")}`;
}

/**
 * Renewal-change notice — the formal landlord notice of intended rent change.
 * The figure is framed as the index-indicated maximum (an approved framing)
 * and never as a binding-law ceiling — see renewalCopy.ts for the rejected
 * phrase list.
 */
export function renderRenewalChangeNotice(input: NoticeTemplateInput): string {
  const body =
    `Notice of proposed renewal terms — ${input.unit}\n\n` +
    `Current annual rent: ${aed(input.currentRent)}.\n` +
    `Proposed annual rent from ${input.effectiveFrom}: ${aed(input.proposedRent)}.\n` +
    `For reference, the index-indicated maximum derived from the Decree 43 band ` +
    `against the current capture is ${aed(input.indexIndicatedMaximum)}.\n\n` +
    `Seneschal is a technology platform, not a broker or legal adviser. ` +
    `Any figure above is for reference only.`;
  assertRenewalCopyCompliant(body);
  return body;
}

export interface OfferLinkSummaryInput {
  unit: string;
  proposedRent: number;
  indexIndicatedMaximum: number | null;
}

/**
 * The "permitted figure" copy shown to the tenant on the offer page next to
 * the proposed figure. Skips gracefully when no live capture exists.
 */
export function renderTenantOfferSummary(input: OfferLinkSummaryInput): string {
  const ref =
    input.indexIndicatedMaximum != null
      ? `For reference, the index-indicated maximum derived from the Decree 43 band ` +
        `is ${aed(input.indexIndicatedMaximum)}.`
      : `The Decree 43 band reference figure is not currently captured against this unit.`;
  const body =
    `Renewal proposal for ${input.unit}\n\n` +
    `Proposed annual rent: ${aed(input.proposedRent)}.\n` +
    `${ref}\n\n` +
    `Seneschal records your response on the owner's behalf; it is not legal advice.`;
  assertRenewalCopyCompliant(body);
  return body;
}

/** Registry used by the compliance test — every template fixture rendered here
 *  is checked against the gate. */
export const RENEWAL_TEMPLATE_RENDERERS = [
  {
    code: "renewal_change_notice_v1",
    render: () =>
      renderRenewalChangeNotice({
        unit: "Marina Heights · Unit 1204",
        currentRent: 80_000,
        proposedRent: 84_000,
        indexIndicatedMaximum: 84_000,
        effectiveFrom: "2026-09-01",
      }),
  },
  {
    code: "tenant_offer_summary_v1",
    render: () =>
      renderTenantOfferSummary({
        unit: "Marina Heights · Unit 1204",
        proposedRent: 84_000,
        indexIndicatedMaximum: 84_000,
      }),
  },
] as const;
