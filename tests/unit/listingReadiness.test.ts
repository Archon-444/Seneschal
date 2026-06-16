import { describe, expect, it } from "vitest";
import { listingReadiness, PUBLISH_THRESHOLD } from "@/server/calculators/listingReadiness";

// Deterministic readiness calculator (1B). Asserts the score math, the citation
// envelope, and the mandatory-check gate (no permit / no rent ⇒ cannot publish
// regardless of total score).

const complete = {
  askingRent: 95000,
  availableFrom: new Date("2026-07-01"),
  furnished: true,
  description: "Bright two-bed with full Marina view, upgraded kitchen and covered parking.",
  permitRef: "RERA-7781234",
  bedrooms: 2,
  sizeSqft: 1180,
};

describe("listingReadiness", () => {
  it("scores a fully-populated listing at 100 and allows publish", () => {
    const r = listingReadiness(complete);
    expect(r.score).toBe(100);
    expect(r.canPublish).toBe(true);
    expect(r.checks.every((c) => c.ok)).toBe(true);
  });

  it("carries a { rule, version, inputs } citation envelope", () => {
    const r = listingReadiness(complete);
    expect(r.rule).toBe("listing_readiness");
    expect(r.version).toBe("v1");
    expect(r.inputs.permitRef).toBe(true);
    expect(r.inputs.askingRent).toBe(95000);
  });

  it("blocks publish when a REQUIRED check fails even if score is high", () => {
    const noPermit = listingReadiness({ ...complete, permitRef: null });
    expect(noPermit.canPublish).toBe(false);
    expect(noPermit.checks.find((c) => c.key === "permitRef")!.ok).toBe(false);

    const noRent = listingReadiness({ ...complete, askingRent: null });
    expect(noRent.canPublish).toBe(false);
  });

  it("blocks publish when score is below the threshold", () => {
    // Only the two required checks pass (permit + rent = 45/100) → below threshold.
    const sparse = listingReadiness({
      askingRent: 80000,
      availableFrom: null,
      furnished: null,
      description: null,
      permitRef: "RERA-1",
      bedrooms: null,
      sizeSqft: null,
    });
    expect(sparse.score).toBeLessThan(PUBLISH_THRESHOLD);
    expect(sparse.canPublish).toBe(false);
  });

  it("treats a too-short description as incomplete", () => {
    const r = listingReadiness({ ...complete, description: "Nice flat" });
    expect(r.checks.find((c) => c.key === "description")!.ok).toBe(false);
    expect(r.score).toBeLessThan(100);
  });
});
