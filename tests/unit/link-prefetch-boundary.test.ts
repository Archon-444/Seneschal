import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// next/link prefetches every href it is given. Pointed at an /api/ route that
// serves a file (the evidence pack, a CSV export), the router fetches it as an
// RSC payload, which that route cannot serve — it 500s on every render of the
// page holding the link, and clicking it asks the client router to navigate to
// something it cannot render.
//
// This was live on four pages (renewal, property, client, report) via the
// shared LinkButton. Downloads must use a plain anchor. This guard is static so
// the boundary cannot be re-crossed by a new caller.

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, acc);
    else if (full.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

/** Opening tags of next/link elements, e.g. `<Link href={...} className="...">`. */
function linkOpeningTags(src: string): string[] {
  return src.match(/<Link\b[^>]*>/gs) ?? [];
}

describe("download routes never go through next/link", () => {
  const files = tsxFiles(join(process.cwd(), "src"));

  it("finds tsx sources to scan", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no <Link> points at an /api/ route", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const tag of linkOpeningTags(readFileSync(file, "utf8"))) {
        if (tag.includes("/api/")) offenders.push(`${file.replace(process.cwd() + "/", "")}: ${tag.slice(0, 100)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("LinkButton renders a plain anchor for /api/ hrefs", () => {
    const src = readFileSync(join(process.cwd(), "src/components/ui.tsx"), "utf8");
    const body = src.slice(src.indexOf("export function LinkButton"));
    expect(body).toContain('href.startsWith("/api/")');
    // the anchor branch must come before the Link fallback
    expect(body.indexOf("<a href={href}")).toBeGreaterThan(-1);
    expect(body.indexOf("<a href={href}")).toBeLessThan(body.indexOf("<Link href={href}"));
  });
});
