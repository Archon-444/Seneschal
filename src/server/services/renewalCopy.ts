// Renewal compliance copy gate (PR6c — spec §0 enforcement).
//
// Every code path that surfaces renewal-facing language MUST run its text
// through assertRenewalCopyCompliant() before send/render. This includes:
//   - Notice document templates (renewal/non-renewal notice bodies)
//   - The tenant offer page's "permitted figure" copy
//   - System-generated email/WhatsApp bodies for renewal events
//
// Two checks:
//
//   1. Prohibited phrasing — words/phrases that overstate Seneschal's role
//      (Seneschal is a platform, NOT a broker or legal adviser). These
//      assert binding-law positions and have bitten before; rejecting them
//      mechanically is cheaper than a copy review every time a template
//      ships.
//
//   2. Required framing — at least one of the approved framings MUST
//      appear, so a template that drops every framing reference (and so
//      could read as a legal claim) is also rejected.
//
// Throws a compliance error (intentionally not just a warning) so a
// non-compliant template fails the test / the request, not silently leaks
// into prod.

const PROHIBITED_PHRASES: readonly string[] = [
  "lawful ceiling",
  "legal maximum",
  "legally entitled",
  "legal band",
  "entitled to",
  "by law",
  "enforceable",
  "lawful increase",
  "legal rent",
];

const APPROVED_FRAMINGS: readonly string[] = [
  "Decree 43 band",
  "index-indicated maximum",
  "RERA calculator figure",
];

// Required framing cues (spec §0): renewal copy that cites a figure must make four
// things explicit so it can never read as a binding-law claim — the rule-based
// basis (an approved framing), that the figure rests on SUPPLIED data, the
// source-CAPTURE reference, and a REVIEW / not-legal-advice note. Each group is
// satisfied by any one of its phrases.
const REQUIRED_CUES: readonly { readonly label: string; readonly any: readonly string[] }[] = [
  { label: "an approved rule-based framing", any: APPROVED_FRAMINGS },
  {
    label: "the supplied-data basis",
    any: ["landlord-provided data", "owner's behalf", "based on supplied data", "landlord-supplied"],
  },
  { label: "the source-capture reference", any: ["captured", "capture date", "index capture"] },
  {
    label: "the review / not-legal-advice note",
    any: ["not legal advice", "for reference only", "seek independent advice", "review official sources", "not a broker or legal adviser"],
  },
];

export class RenewalCopyComplianceError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "RenewalCopyComplianceError";
  }
}

function wordBoundaryHit(text: string, needle: string): boolean {
  // Word-boundary, case-insensitive. Build a regex per call (small list).
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `\b` won't anchor on phrases starting/ending in non-word chars; use lookarounds
  // around the whole phrase so multi-word matches don't slip out.
  const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "i");
  return re.test(text);
}

/**
 * Assert that `text` is safe to render/send for a renewal-facing surface.
 * Throws RenewalCopyComplianceError on the first prohibited hit, or if no
 * approved framing is present.
 */
export function assertRenewalCopyCompliant(text: string): void {
  for (const banned of PROHIBITED_PHRASES) {
    if (wordBoundaryHit(text, banned)) {
      throw new RenewalCopyComplianceError(
        `Renewal copy contains prohibited phrase "${banned}". ` +
          `Seneschal is a platform, not a broker or legal adviser — use an approved framing ` +
          `(${APPROVED_FRAMINGS.join(", ")}) instead.`,
      );
    }
  }
  for (const cue of REQUIRED_CUES) {
    if (!cue.any.some((c) => wordBoundaryHit(text, c))) {
      throw new RenewalCopyComplianceError(
        `Renewal copy must include ${cue.label} (one of: ${cue.any.join(", ")}).`,
      );
    }
  }
}

export const RENEWAL_COPY_TEST_FIXTURES = {
  PROHIBITED_PHRASES,
  APPROVED_FRAMINGS,
  REQUIRED_CUES,
} as const;
