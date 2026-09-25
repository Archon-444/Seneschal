// Renewal-facing copy templates (PR6c). Each rendered string runs through
// assertRenewalCopyCompliant before it's returned to a caller — the spec §0
// gate. New renewal templates MUST be registered here so the test in
// renewalCopy.test.ts catches a non-compliant addition before it ships.

import { assertRenewalCopyCompliant } from "./renewalCopy";
import { formatAed } from "@/lib/money";
import type { Pair } from "@/lib/linkCopy";

export interface NoticeTemplateInput {
  unit: string;
  currentRent: number;
  proposedRent: number;
  indexIndicatedMaximum: number;
  effectiveFrom: string; // ISO date-only
  capturedOn?: string; // ISO date-only the index figure was captured on
}

function aed(n: number): string {
  return formatAed(n);
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
    `against the current capture is ${aed(input.indexIndicatedMaximum)}.\n` +
    `This notice is based on landlord-provided data and an index figure captured on ` +
    `${input.capturedOn ?? "the recorded capture date"}.\n\n` +
    `Seneschal is a technology platform, not a broker or legal adviser. ` +
    `Any figure above is for reference only.`;
  assertRenewalCopyCompliant(body);
  return body;
}

export interface OfferLinkSummaryInput {
  unit: string;
  proposedRent: number;
  indexIndicatedMaximum: number | null;
  capturedOn?: string; // ISO date-only the index figure was captured on
}

/**
 * The "permitted figure" copy shown to the tenant on the offer page next to
 * the proposed figure. Skips gracefully when no live capture exists.
 */
export function renderTenantOfferSummary(input: OfferLinkSummaryInput): string {
  const ref =
    input.indexIndicatedMaximum != null
      ? `For reference, the index-indicated maximum derived from the Decree 43 band, ` +
        `from an index captured on ${input.capturedOn ?? "the recorded date"}, ` +
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

export interface TenantOfferPositionInput {
  proposedRent: number;
  currentRent: number;
  /** The offer's frozen permittedMaxSnapshot, or null when none was attached. */
  indexIndicatedMaximum: number | null;
  /** The frozen citation's market average, or null. */
  indexAverage: number | null;
  /** Capture date, already formatted per language. */
  capturedOn: Pair | null;
  /** Source name per language, e.g. "Smart Rental Index". */
  sourceName: Pair;
  /** A manual concierge estimate rather than an official index figure. */
  provisional: boolean;
}

/**
 * The note under the tenant offer's terms: where the offer sits against the
 * index-indicated maximum, what that figure rests on, and the review cue. The
 * English is the reference text and runs through the gate; the Arabic mirrors
 * it sentence for sentence with the same hedges ("استرشادي", "للاسترشاد فقط").
 */
export function renderTenantOfferPositionNote(input: TenantOfferPositionInput): Pair {
  const ar = (n: number) => formatAed(n, "ar");
  const max = input.indexIndicatedMaximum;
  const avg = input.indexAverage;
  const date = input.capturedOn ?? { en: "the recorded date", ar: "التاريخ المسجَّل" };
  const en: string[] = [];
  const arabic: string[] = [];

  if (max != null) {
    const diff = input.proposedRent - max;
    if (diff < 0) {
      en.push(`This offer is ${aed(-diff)} below the index-indicated maximum of ${aed(max)} from the Decree 43 band.`);
      arabic.push(`هذا العرض أقل بمبلغ ${ar(-diff)} من الحد الأقصى الاسترشادي البالغ ${ar(max)} وفق شريحة المرسوم رقم 43.`);
    } else if (diff === 0) {
      en.push(`This offer equals the index-indicated maximum of ${aed(max)} from the Decree 43 band.`);
      arabic.push(`هذا العرض يساوي الحد الأقصى الاسترشادي البالغ ${ar(max)} وفق شريحة المرسوم رقم 43.`);
    } else {
      en.push(
        `This offer is ${aed(diff)} above the index-indicated maximum of ${aed(max)} from the Decree 43 band. ` +
          `You may want to ask about it before you answer.`,
      );
      arabic.push(
        `هذا العرض أعلى بمبلغ ${ar(diff)} من الحد الأقصى الاسترشادي البالغ ${ar(max)} وفق شريحة المرسوم رقم 43. ` +
          `قد ترغب في الاستفسار عن ذلك قبل الرد.`,
      );
    }
    if (avg != null && input.provisional) {
      en.push(
        `That maximum uses a provisional estimate of ${aed(avg)} recorded by the managing office and captured on ${date.en}, not an official index figure.`,
      );
      arabic.push(`يستند هذا الحد إلى تقدير مبدئي بقيمة ${ar(avg)} سجّله مكتب الإدارة بتاريخ ${date.ar}، وليس رقماً رسمياً من المؤشر.`);
    } else if (avg != null) {
      const gap = (avg - input.currentRent) / avg;
      const gapText = (gap * 100).toFixed(1);
      en.push(
        gap > 0
          ? `That maximum uses the ${input.sourceName.en} average of ${aed(avg)}, captured on ${date.en}; your current rent is ${gapText}% below it.`
          : `That maximum uses the ${input.sourceName.en} average of ${aed(avg)}, captured on ${date.en}; your current rent is at or above that average.`,
      );
      arabic.push(
        gap > 0
          ? `يستند هذا الحد إلى متوسط ${input.sourceName.ar} البالغ ${ar(avg)}، المسجَّل بتاريخ ${date.ar}، وإيجارك الحالي أقل منه بنسبة ${gapText}%.`
          : `يستند هذا الحد إلى متوسط ${input.sourceName.ar} البالغ ${ar(avg)}، المسجَّل بتاريخ ${date.ar}، وإيجارك الحالي يساوي هذا المتوسط أو يزيد عليه.`,
      );
    } else {
      en.push(`That maximum comes from an index capture recorded by the managing office.`);
      arabic.push(`يستند هذا الحد إلى رقم من المؤشر سجّله مكتب الإدارة.`);
    }
  } else if (avg != null) {
    en.push(`The Decree 43 band reference figure is not attached to this offer. The index average shown above was captured on ${date.en}.`);
    arabic.push(`لم يُرفق بهذا العرض رقم مرجعي لشريحة المرسوم رقم 43. تم تسجيل متوسط المؤشر المعروض أعلاه بتاريخ ${date.ar}.`);
  } else {
    en.push(`The Decree 43 band reference figure is not attached to this offer, as no index figure was captured for it.`);
    arabic.push(`لم يُرفق بهذا العرض رقم مرجعي لشريحة المرسوم رقم 43، إذ لم يُسجَّل له أي رقم من المؤشر.`);
  }

  en.push(`Based on supplied data and for reference only: review official sources before you answer.`);
  arabic.push(`مبني على البيانات المقدّمة وللاسترشاد فقط: يرجى مراجعة المصادر الرسمية قبل الرد.`);

  const body = en.join(" ");
  assertRenewalCopyCompliant(body);
  return { en: body, ar: arabic.join(" ") };
}

const POSITION_FIXTURE: TenantOfferPositionInput = {
  proposedRent: 78_000,
  currentRent: 72_000,
  indexIndicatedMaximum: 79_200,
  indexAverage: 96_000,
  capturedOn: { en: "28 Aug 2026", ar: "28 أغسطس 2026" },
  sourceName: { en: "Smart Rental Index", ar: "مؤشر الإيجارات الذكي" },
  provisional: false,
};

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
        capturedOn: "2026-06-01",
      }),
  },
  {
    code: "tenant_offer_summary_v1",
    render: () =>
      renderTenantOfferSummary({
        unit: "Marina Heights · Unit 1204",
        proposedRent: 84_000,
        indexIndicatedMaximum: 84_000,
        capturedOn: "2026-06-01",
      }),
  },
  { code: "tenant_offer_position_below_v1", render: () => renderTenantOfferPositionNote(POSITION_FIXTURE).en },
  {
    code: "tenant_offer_position_equal_v1",
    render: () => renderTenantOfferPositionNote({ ...POSITION_FIXTURE, proposedRent: 79_200 }).en,
  },
  {
    code: "tenant_offer_position_above_v1",
    render: () => renderTenantOfferPositionNote({ ...POSITION_FIXTURE, proposedRent: 82_000 }).en,
  },
  {
    code: "tenant_offer_position_provisional_v1",
    render: () => renderTenantOfferPositionNote({ ...POSITION_FIXTURE, provisional: true }).en,
  },
  {
    code: "tenant_offer_position_no_maximum_v1",
    render: () => renderTenantOfferPositionNote({ ...POSITION_FIXTURE, indexIndicatedMaximum: null }).en,
  },
  {
    code: "tenant_offer_position_no_index_v1",
    render: () =>
      renderTenantOfferPositionNote({
        ...POSITION_FIXTURE,
        indexIndicatedMaximum: null,
        indexAverage: null,
        capturedOn: null,
      }).en,
  },
] as const;
