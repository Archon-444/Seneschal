// Copy for the public secure-link pages, in English and Arabic.
//
// Dubai tenancy paperwork (tenancy contracts, Ejari certificates) is bilingual,
// so the link pages default to showing both languages; `?lang=en` or `?lang=ar`
// narrows to one. Every string is a pair so the two languages can't drift apart
// in structure. The Arabic still needs a native speaker's review before it is
// relied on in a dispute; the English stays the reference text.
//
// Renewal figure wording is not here: it goes through the compliance gate in
// src/server/services/renewalTemplates.ts.

import { MAX_FILES_PER_REQUEST, MAX_UPLOAD_TOTAL_LABEL } from "./uploadLimits";

export type LinkLang = "en" | "ar" | "both";
export type Locale = "en" | "ar";
export type Pair = { en: string; ar: string };

export function parseLinkLang(value: unknown): LinkLang {
  return value === "en" || value === "ar" ? value : "both";
}

/** Languages to render, primary first. */
export function localesFor(lang: LinkLang): Locale[] {
  return lang === "both" ? ["en", "ar"] : [lang];
}

/** Wrap Latin text (a unit name, "14 MB") in a Unicode first-strong isolate so
 *  it keeps its own direction inside an Arabic sentence instead of reordering
 *  the punctuation around it. */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}

/** Arabic count nouns agree with the number: 1, 2, 3–10 and 11+ each differ. */
function arabicCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

export const monthsLabel = (n: number): Pair => ({
  en: n === 1 ? "1 month" : `${n} months`,
  ar: arabicCount(n, "شهر واحد", "شهران", "أشهر", "شهراً"),
});

export const COPY = {
  brand: { en: "Seneschal", ar: "Seneschal" },
  language: { en: "Language", ar: "اللغة" },
  langBoth: { en: "Both", ar: "كلاهما" },
  langEn: { en: "English", ar: "الإنجليزية" },
  langAr: { en: "Arabic", ar: "العربية" },
  keepsRecords: {
    en: "Seneschal keeps records. It is not a broker or legal adviser.",
    ar: "Seneschal منصة لحفظ السجلات، وليست وسيطاً عقارياً ولا مستشاراً قانونياً.",
  },
  recorded: {
    en: "What you do on this page is recorded.",
    ar: "يتم تسجيل ما تقوم به على هذه الصفحة.",
  },
  worksUntil: (date: Pair): Pair => ({
    en: `This link works until ${date.en}.`,
    ar: `يعمل هذا الرابط حتى ${date.ar}.`,
  }),

  unavailableTitle: { en: "This link is no longer available", ar: "هذا الرابط لم يعد متاحاً" },
  unavailableBody: {
    en: "The link may have expired, been used already, or been withdrawn. Please contact the person who sent it to request a new one.",
    ar: "ربما انتهت صلاحية الرابط، أو استُخدم من قبل، أو تم سحبه. يرجى التواصل مع الشخص الذي أرسله لطلب رابط جديد.",
  },

  offerTitle: { en: "Renewal offer", ar: "عرض تجديد عقد الإيجار" },
  offerStamp: (version: number, date: Pair): Pair => ({
    en: `Offer v${version} · ${date.en}`,
    ar: `العرض ${version} · ${date.ar}`,
  }),
  offerIntro: (unit: string): Pair => ({
    en: `The managing office, on behalf of your landlord, offers to renew your tenancy of ${unit}.`,
    ar: `يعرض مكتب الإدارة، نيابةً عن المالك، تجديد عقد إيجارك للوحدة ${isolate(unit)}.`,
  }),
  proposedRent: { en: "Proposed annual rent", ar: "الإيجار السنوي المقترح" },
  currentRent: { en: "Current annual rent", ar: "الإيجار السنوي الحالي" },
  change: { en: "Change", ar: "التغيير" },
  newTerm: { en: "New term", ar: "مدة العقد الجديد" },
  payment: { en: "Payment", ar: "طريقة الدفع" },
  indexMaximum: { en: "Index-indicated maximum", ar: "الحد الأقصى الاسترشادي وفق المؤشر" },
  indexAverage: { en: "Index average for comparison", ar: "متوسط المؤشر للمقارنة" },
  officeMessage: { en: "Message from the managing office", ar: "رسالة من مكتب الإدارة" },

  yourAnswer: { en: "Your answer", ar: "ردّك" },
  yourDecision: { en: "Your decision", ar: "قرارك" },
  noChange: { en: "No change", ar: "بدون تغيير" },
  // Arabic states the direction in words: a leading "+" or "−" reorders
  // unpredictably next to an Arabic currency word.
  increaseWord: "زيادة",
  decreaseWord: "انخفاض",
  from: (date: Pair): Pair => ({ en: `from ${date.en}`, ar: `ابتداءً من ${date.ar}` }),
  accept: { en: "Accept offer", ar: "قبول العرض" },
  counter: { en: "Propose other terms", ar: "اقتراح شروط أخرى" },
  ask: { en: "Ask a question", ar: "طرح سؤال" },
  sendCounter: { en: "Send my terms", ar: "إرسال شروطي" },
  sendQuestion: { en: "Send question", ar: "إرسال السؤال" },
  back: { en: "Back", ar: "رجوع" },
  sending: { en: "Sending…", ar: "جارٍ الإرسال…" },
  counterRent: { en: "Your proposed annual rent (AED)", ar: "الإيجار السنوي الذي تقترحه (درهم)" },
  paymentSchedule: { en: "Payment schedule", ar: "جدول الدفع" },
  paymentPlaceholder: { en: "e.g. 2 cheques", ar: "مثال: شيكان" },
  noteOptional: { en: "Note (optional)", ar: "ملاحظة (اختياري)" },
  yourQuestion: { en: "Your question", ar: "سؤالك" },
  whatsappOptIn: {
    en: "You may contact me on WhatsApp about this renewal.",
    ar: "أوافق على التواصل معي عبر واتساب بخصوص هذا التجديد.",
  },

  afterTitle: { en: "What happens after you answer", ar: "ماذا يحدث بعد ردّك" },
  afterSteps: [
    {
      en: "Your answer goes to the managing office with the time and the version of the offer you answered. You see a receipt on this page.",
      ar: "يصل ردّك إلى مكتب الإدارة مع وقت الرد ونسخة العرض التي رددت عليها، ويظهر لك إيصال على هذه الصفحة.",
    },
    {
      en: "If you propose other terms or ask a question, the office replies before anything changes.",
      ar: "إذا اقترحت شروطاً أخرى أو طرحت سؤالاً، سيرد عليك المكتب قبل أي تغيير.",
    },
    {
      en: "If you accept, the office contacts you to sign the new tenancy contract and register it with Ejari.",
      ar: "إذا قبلت، سيتواصل معك المكتب لتوقيع عقد الإيجار الجديد وتسجيله في نظام إيجاري.",
    },
  ] as Pair[],

  receiptTitle: { en: "Receipt", ar: "إيصال" },
  receiptAnswer: { en: "Answer", ar: "الرد" },
  receiptOffer: { en: "Offer", ar: "العرض" },
  receiptRecorded: { en: "Recorded", ar: "وقت التسجيل" },
  receiptProposed: { en: "You proposed", ar: "اقترحت" },
  receiptNote: { en: "Your note", ar: "ملاحظتك" },
  receiptKeep: {
    en: "Keep this page or take a screenshot for your records.",
    ar: "احتفظ بهذه الصفحة أو التقط صورة للشاشة لسجلاتك.",
  },
  acceptedTitle: { en: "Your acceptance has been recorded.", ar: "تم تسجيل قبولك للعرض." },
  counteredTitle: {
    en: "Your proposed terms have been sent and recorded.",
    ar: "تم إرسال الشروط التي اقترحتها وتسجيلها.",
  },
  askedTitle: {
    en: "Your question has been sent to the managing office.",
    ar: "تم إرسال سؤالك إلى مكتب الإدارة.",
  },
  answerAccepted: { en: "Accepted", ar: "قبول" },
  answerCountered: { en: "Proposed other terms", ar: "اقتراح شروط أخرى" },
  answerAsked: { en: "Asked a question", ar: "طرح سؤال" },
  afterAccept: {
    en: "The managing office will be in touch to finalise.",
    ar: "سيتواصل معك مكتب الإدارة لإتمام الإجراءات.",
  },
  afterOther: {
    en: "The managing office will come back to you on this.",
    ar: "سيعود إليك مكتب الإدارة بخصوص ذلك.",
  },

  approvalTitle: { en: "Owner sign-off", ar: "موافقة المالك" },
  approvalIntro: (unit: string): Pair => ({
    en: `Proposed renewal terms for ${unit}.`,
    ar: `شروط التجديد المقترحة للوحدة ${isolate(unit)}.`,
  }),
  party: { en: "Party", ar: "الطرف" },
  partyLandlord: { en: "Landlord proposal", ar: "عرض المالك" },
  partyTenant: { en: "Tenant counter", ar: "عرض مقابل من المستأجر" },
  version: { en: "Version", ar: "النسخة" },
  approve: { en: "Approve", ar: "موافقة" },
  reject: { en: "Reject", ar: "رفض" },
  recording: { en: "Recording…", ar: "جارٍ التسجيل…" },
  approvedTitle: { en: "Your approval has been recorded.", ar: "تم تسجيل موافقتك." },
  rejectedTitle: { en: "Your decision to reject has been recorded.", ar: "تم تسجيل قرارك بالرفض." },
  approvalAfter: {
    en: "The managing office will see this on the record. You can close this page.",
    ar: "سيطّلع مكتب الإدارة على ذلك في السجل. يمكنك إغلاق هذه الصفحة.",
  },
  approvalAbout: {
    en: "This is a recorded sign-off on the terms shown, based on supplied data. Review before action.",
    ar: "هذه موافقة مسجّلة على الشروط المعروضة، بناءً على البيانات المقدّمة. يرجى المراجعة قبل اتخاذ أي إجراء.",
  },

  requestedBy: (date: Pair): Pair => ({ en: `Requested by ${date.en}`, ar: `مطلوب قبل ${date.ar}` }),
  photoOrDocument: { en: "Photo or document", ar: "صورة أو مستند" },
  uploadHint: (files: number, size: string): Pair => ({
    en: `Up to ${files} files, ${size} combined. Images or PDF.`,
    ar: `حتى ${arabicCount(files, "ملف واحد", "ملفين", "ملفات", "ملفاً")}، بحجم إجمالي ${isolate(size)}. صور أو ملفات PDF.`,
  }),
  tooLarge: (size: string): Pair => ({
    en: `Selected files total more than ${size}. Remove some before submitting.`,
    ar: `يتجاوز حجم الملفات المحددة ${isolate(size)}. يرجى إزالة بعضها قبل الإرسال.`,
  }),
  submitProof: { en: "Submit proof", ar: "إرسال الإثبات" },
  uploading: { en: "Uploading…", ar: "جارٍ الرفع…" },
  filesReceived: (n: number): Pair => ({
    en: n === 1 ? "Your file was received and recorded." : `Your ${n} files were received and recorded.`,
    ar:
      n === 1
        ? "تم استلام ملفك وتسجيله."
        : n === 2
          ? "تم استلام ملفيك وتسجيلهما."
          : `تم استلام ${arabicCount(n, "ملف واحد", "ملفين", "ملفات", "ملفاً")} وتسجيلها.`,
  }),
  andMore: (n: number): Pair => ({ en: `and ${n} more`, ar: `و${n} غيرها` }),
  canClose: { en: "You can close this page.", ar: "يمكنك إغلاق هذه الصفحة." },
  privacyTitle: { en: "Privacy notice (v1)", ar: "إشعار الخصوصية (الإصدار 1)" },
  privacyBody: {
    en: "Files you upload here are stored privately and shared only with the workspace that requested them, to evidence this specific request. Your interaction with this link is recorded. By uploading you consent to this processing. Questions? Reply to the email that brought you here.",
    ar: "تُحفظ الملفات التي ترفعها هنا بشكل خاص، ولا تُشارك إلا مع الجهة التي طلبتها، لإثبات هذا الطلب تحديداً. يتم تسجيل تفاعلك مع هذا الرابط. برفعك للملفات فإنك توافق على هذه المعالجة. لديك سؤال؟ ردّ على البريد الإلكتروني الذي أوصلك إلى هنا.",
  },
} as const;

/** The index a citation came from, by its recorded IndexSource. Unknown kinds
 *  get a generic name rather than the operator's free-text label, which feeds
 *  the compliance-gated note and must not be able to fail it. */
export function indexSourceName(kind: string | null): Pair {
  if (kind === "SMART_RENTAL_INDEX_2025") return { en: "Smart Rental Index", ar: "مؤشر الإيجارات الذكي" };
  if (kind === "RERA_INDEX_LEGACY") return { en: "RERA rental index", ar: "مؤشر إيجارات ريرا" };
  return { en: "rental index", ar: "مؤشر الإيجارات" };
}

// Fixed server-action messages. Anything not listed (per-file limits naming a
// file) stays in English only.
const ERROR_AR: Record<string, string> = {
  [`Please upload at most ${MAX_FILES_PER_REQUEST} files at a time.`]: `يرجى رفع ${MAX_FILES_PER_REQUEST} ملفات كحد أقصى في كل مرة.`,
  [`Those files total more than ${MAX_UPLOAD_TOTAL_LABEL}. Please upload them in smaller batches.`]: `يتجاوز حجم هذه الملفات ${isolate(MAX_UPLOAD_TOTAL_LABEL)}. يرجى رفعها على دفعات أصغر.`,
  "This link is no longer available.": "هذا الرابط لم يعد متاحاً.",
  "Choose accept, counter, or ask.": "اختر القبول أو اقتراح شروط أخرى أو طرح سؤال.",
  "Too many attempts. Please wait a few minutes and try again.":
    "محاولات كثيرة. يرجى الانتظار بضع دقائق ثم المحاولة مجدداً.",
  "This decision has already been recorded.": "تم تسجيل هذا القرار من قبل.",
  "Choose approve or reject.": "اختر الموافقة أو الرفض.",
  "Choose at least one file.": "اختر ملفاً واحداً على الأقل.",
  "Could not record your response.": "تعذّر تسجيل ردّك.",
};

export function errorPair(message: string): Pair {
  return { en: message, ar: ERROR_AR[message] ?? message };
}
