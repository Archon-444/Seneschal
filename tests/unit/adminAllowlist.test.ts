import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// F-Admin §5 / §8.3 — the admin module graph imports NO confidential service. A structural
// gate (mirrors scripts/scope-audit.mjs), not a convention: the platform plane may import only
// infra (db/crypto/audit/authz) and sibling admin modules. Importing any @/server/services/*
// data service — or @/server/evidence — from the admin plane fails CI. Delete the strip and
// have the console import a staff data read again, and this goes red.

const ROOTS = ["src/server/admin", "src/app/(staff)"];

// Any import whose path resolves into a data service dir, or the evidence reader.
const FORBIDDEN = /from\s+["'][^"']*\/(services(\/[^"']+)?|evidence)["']/;

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

describe("admin plane import allowlist", () => {
  it("self-check: the matcher flags a confidential import and passes infra", () => {
    expect(FORBIDDEN.test('import { getTenancy } from "@/server/services/tenancies";')).toBe(true);
    expect(FORBIDDEN.test('import { assignClient } from "@/server/services/assignments";')).toBe(true);
    expect(FORBIDDEN.test('import { recordEvidence } from "@/server/evidence";')).toBe(true);
    expect(FORBIDDEN.test('import { platformStats } from "@/server/admin/platformStats";')).toBe(false);
    expect(FORBIDDEN.test('import { prisma } from "@/server/db";')).toBe(false);
    expect(FORBIDDEN.test('import { recordAudit } from "@/server/audit";')).toBe(false);
  });

  it("no admin module or /admin route imports a confidential service", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        for (const line of readFileSync(file, "utf8").split("\n")) {
          if (FORBIDDEN.test(line)) offenders.push(`${file}  →  ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
