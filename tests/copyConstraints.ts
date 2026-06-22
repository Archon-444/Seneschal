// Single source of truth for the Gate-2 banned-legal-term sweep
// (seneschal-build-handoff.md): production copy must never present the
// Decree-43 / index figures as legally binding. Used by both the static
// source scan (unit/copy-constraints.test.ts) and the runtime notice-gate
// body check (integration/alerts.test.ts) so the two can't drift apart.
//
// Word-boundary patterns so legitimate copy is not tripped: "lawyer",
// "legal adviser", "not legal advice", and "by lawyer" must all pass. Use the
// constraint-safe phrasing instead: "estimated permissible increase",
// "index-based ceiling estimate", "based on supplied data", "review before action".
export const BANNED_COPY: RegExp[] = [/\blawful\b/i, /\bby law\b/i, /\benforceable\b/i, /legal band/i, /\bentitled to\b/i];

/** The first banned legal term found in `text`, or null when clean. */
export function findBannedCopy(text: string): string | null {
  for (const pat of BANNED_COPY) {
    const m = text.match(pat);
    if (m) return m[0];
  }
  return null;
}
