import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTenancyShapedExtraction } from "@/server/services/extraction";
import type { ExtractionFields } from "@/server/services/extraction";

// "Quotes and invoices no longer look like a tenancy commit" is a promise the
// product makes. It is only true if the discriminator actually discriminates,
// so this drives it off the real recorded fixtures rather than a hand-made
// object: whatever the extractor genuinely produces for a quote must not read
// as a lease.

type Fixture = { id: string; documentKind: string; expected: Record<string, unknown> };
const fixtures: Fixture[] = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/ground-truth.json"), "utf8"),
).fixtures;

const asFields = (expected: Record<string, unknown>): ExtractionFields =>
  Object.fromEntries(
    Object.entries(expected).map(([k, v]) => [k, { value: v, confidence: 0.9 }]),
  ) as ExtractionFields;

const TENANCY_KINDS = ["TENANCY_CONTRACT", "EJARI_CERTIFICATE"];

describe("isTenancyShapedExtraction — against the recorded fixtures", () => {
  for (const f of fixtures) {
    const shouldBeTenancy = TENANCY_KINDS.includes(f.documentKind);
    it(`${f.id} (${f.documentKind}) is ${shouldBeTenancy ? "" : "not "}tenancy-shaped`, () => {
      expect(isTenancyShapedExtraction(asFields(f.expected))).toBe(shouldBeTenancy);
    });
  }
});

describe("isTenancyShapedExtraction — the permissive cases it used to accept", () => {
  it("a community alone is not a lease (most maintenance quotes name one)", () => {
    expect(isTenancyShapedExtraction(asFields({ community: "Dubai Marina" }))).toBe(false);
  });

  it("party names alone are not a lease", () => {
    expect(
      isTenancyShapedExtraction(
        asFields({ landlordName: "Al Noor Properties LLC", tenantName: "Ricardo Fernandes" }),
      ),
    ).toBe(false);
  });

  it("a start date with no end date is not a term", () => {
    expect(isTenancyShapedExtraction(asFields({ startDate: "2025-09-16" }))).toBe(false);
  });

  it("a full term is a lease", () => {
    expect(
      isTenancyShapedExtraction(asFields({ startDate: "2025-09-16", endDate: "2026-09-15" })),
    ).toBe(true);
  });

  it("an Ejari number alone is a lease", () => {
    expect(isTenancyShapedExtraction(asFields({ ejariNo: "2025/118402" }))).toBe(true);
  });

  it("blank values do not count as present", () => {
    expect(isTenancyShapedExtraction(asFields({ startDate: "  ", endDate: "", ejariNo: "" }))).toBe(false);
  });
});
