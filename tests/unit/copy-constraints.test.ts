import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Gate 2 (seneschal-build-handoff.md): production copy must never present the
// Decree-43 / index figures as legally binding. These terms are banned in any
// shipped UI string. Notification bodies are swept separately in alerts.test.ts.
// Permanent guard — eyeballing failed once already (the renewal desk shipped
// "Lawful position" / "lawful ceiling" before this existed). Use the constraint-
// safe phrasing instead: "estimated permissible increase", "index-based ceiling
// estimate", "based on supplied data", "review before action".

// Word-boundary patterns so legitimate copy is not tripped: "lawyer",
// "legal adviser", and "not legal advice" must all pass.
const BANNED: RegExp[] = [/\blawful\b/i, /\bby law\b/i, /\benforceable\b/i, /legal band/i];

// User-facing source roots (pages, the public tenant link, shared components).
const ROOTS = ["src/app/(app)", "src/app/link", "src/components"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("copy constraints (Gate 2)", () => {
  it("does not trip on legitimate near-misses", () => {
    for (const sample of ["lawyer", "legal adviser", "not legal advice", "by lawyer"]) {
      expect(BANNED.some((p) => p.test(sample))).toBe(false);
    }
  });

  it("no shipped UI string uses a banned legal term", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const text = readFileSync(file, "utf8");
        for (const pat of BANNED) {
          const m = text.match(pat);
          if (m) offenders.push(`${file}: "${m[0]}"`);
        }
      }
    }
    expect(offenders, `banned legal terms found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
