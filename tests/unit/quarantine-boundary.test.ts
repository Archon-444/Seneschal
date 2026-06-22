import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// PR-pilot P1-5 — the marketplace / passport modules are archived and out of
// product scope (see QUARANTINE.md). Core renewal / evidence / notice code must not
// grow new dependencies toward them, so pilot-stability work cannot quietly
// recouple to dead concepts. This is a static import-boundary guard.
//
// Note: the TENANT_PASSPORT *scope type* is legitimately referenced by the
// scoping machinery (contactScope.ts); that's a ScopeType enum value, not an
// import of the quarantined tenantPassport service, so it is not in scope here.

const QUARANTINED = ["listings", "enquiries", "viewings", "tenantPassport", "contractPack"];

const IN_SCOPE_FILES = [
  "src/server/services/renewals.ts",
  "src/server/services/notice.ts",
  "src/server/services/risk.ts",
  "src/server/evidence.ts",
  "src/server/services/documents.ts",
];

function importSpecifiers(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  return [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("quarantine boundary — in-scope code must not import archived modules", () => {
  for (const file of IN_SCOPE_FILES) {
    it(`${file} imports no quarantined module`, () => {
      const offenders = importSpecifiers(file).filter((spec) =>
        QUARANTINED.some((q) => spec === `./${q}` || spec.endsWith(`/services/${q}`)),
      );
      expect(offenders, `${file} imports quarantined module(s): ${offenders.join(", ")}`).toEqual([]);
    });
  }
});
