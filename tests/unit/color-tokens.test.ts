import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Static guard (cf. tests/copyConstraints.ts, quarantine-boundary.test.ts).
// Tailwind silently drops a class whose color token is undefined — e.g.
// `text-verde` when only verde-100/500/700 exist — so the element renders
// unstyled. That bug is invisible in a markup-only diff and uncatchable at
// runtime, so we catch it statically: every custom color utility must reference
// a token defined in globals.css.

const FAMILIES = ["ivory", "navy", "gold", "verde", "amber", "claret"];
const PREFIXES = [
  "text", "bg", "border", "ring", "ring-offset", "from", "to", "via",
  "divide", "outline", "fill", "stroke", "decoration", "accent", "caret", "shadow",
];

function definedTokens(): Set<string> {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const set = new Set<string>();
  for (const m of css.matchAll(/--color-([a-z]+(?:-\d+)?)\s*:/g)) set.add(m[1]);
  return set;
}

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) tsxFiles(p, acc);
    else if (p.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

describe("color tokens — every custom color utility resolves to a defined token", () => {
  it("has no undefined color tokens in src/**/*.tsx", () => {
    const defined = definedTokens();
    const re = new RegExp(
      `\\b(?:${PREFIXES.join("|")})-(${FAMILIES.join("|")})(-\\d+)?(?![\\w-])`,
      "g",
    );
    const offenders: string[] = [];
    for (const file of tsxFiles(join(process.cwd(), "src"))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(re)) {
        const token = m[1] + (m[2] ?? "");
        if (!defined.has(token)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")}: "${m[0]}" → token "${token}" not defined`);
        }
      }
    }
    expect(offenders, `Undefined color tokens:\n${offenders.join("\n")}`).toEqual([]);
  });
});
