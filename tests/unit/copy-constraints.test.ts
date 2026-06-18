import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BANNED_COPY, findBannedCopy } from "../copyConstraints";

// Gate 2 (seneschal-build-handoff.md): production copy must never present the
// Decree-43 / index figures as legally binding. These terms are banned in any
// shipped string. The same BANNED_COPY patterns sweep the runtime notice-gate
// body in alerts.test.ts — one source of truth, no drift.
// Permanent guard — eyeballing failed once already (the renewal desk shipped
// "Lawful position" / "lawful ceiling" before this existed). Use the constraint-
// safe phrasing instead: "estimated permissible increase", "index-based ceiling
// estimate", "based on supplied data", "review before action".

// User-facing source roots: pages, the public tenant link, shared components,
// and the server layer (notification bodies, reports, link-page server text).
const ROOTS = ["src/app/(app)", "src/app/link", "src/components", "src/server"];

// Files that DEFINE the banned phrases (as data, for their own gate to reject)
// — including them here would be circular. PR6c's renewalCopy.ts is the renewal
// compliance gate's own definition file; it ships the banned strings exactly so
// it can detect and refuse them at render time. That is the opposite of leaking
// banned copy to users.
const EXCLUDED = new Set(["src/server/services/renewalCopy.ts"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if ((full.endsWith(".tsx") || full.endsWith(".ts")) && !EXCLUDED.has(full)) out.push(full);
  }
  return out;
}

describe("copy constraints (Gate 2)", () => {
  it("does not trip on legitimate near-misses", () => {
    for (const sample of ["lawyer", "legal adviser", "not legal advice", "by lawyer"]) {
      expect(BANNED_COPY.some((p) => p.test(sample))).toBe(false);
    }
  });

  it("no shipped string uses a banned legal term", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const found = findBannedCopy(readFileSync(file, "utf8"));
        if (found) offenders.push(`${file}: "${found}"`);
      }
    }
    expect(offenders, `banned legal terms found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
