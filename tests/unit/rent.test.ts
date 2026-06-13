import { describe, expect, it } from "vitest";
import { decree43 } from "@/server/calculators/rent";

// Decree No. (43) of 2013 bands, verified against the Renewal Risk Desk mock.

describe("decree43 lawful position", () => {
  it("reproduces the mock's Marina figure (25% below → 10% → +7,200)", () => {
    const r = decree43(72_000, 96_000);
    expect(r.gapPct).toBeCloseTo(0.25, 5);
    expect(r.bandPct).toBe(10);
    expect(r.ceiling).toBe(79_200);
    expect(r.valueAtRisk).toBe(7_200);
    expect(r.rule).toBe("decree_43");
    expect(r.version).toBe("v1");
  });

  it("reproduces the mock's Bayview ceiling (24% below → 10% → 121,000)", () => {
    const r = decree43(110_000, 145_000);
    expect(r.bandPct).toBe(10);
    expect(r.ceiling).toBe(121_000);
    expect(r.valueAtRisk).toBe(11_000);
  });

  it("applies the band boundaries", () => {
    expect(decree43(90_000, 100_000).bandPct).toBe(0); // exactly 10% below
    expect(decree43(89_000, 100_000).bandPct).toBe(5); // just over 10%
    expect(decree43(80_000, 100_000).bandPct).toBe(5); // exactly 20%
    expect(decree43(79_000, 100_000).bandPct).toBe(10); // just over 20%
    expect(decree43(70_000, 100_000).bandPct).toBe(10); // exactly 30%
    expect(decree43(69_000, 100_000).bandPct).toBe(15); // just over 30%
    expect(decree43(60_000, 100_000).bandPct).toBe(15); // exactly 40%
    expect(decree43(59_000, 100_000).bandPct).toBe(20); // just over 40%
  });

  it("gives no increase when rent is at or above market", () => {
    const r = decree43(100_000, 90_000);
    expect(r.gapPct).toBe(0);
    expect(r.bandPct).toBe(0);
    expect(r.ceiling).toBe(100_000);
    expect(r.valueAtRisk).toBe(0);
  });

  it("rejects non-positive inputs", () => {
    expect(() => decree43(0, 100_000)).toThrow();
    expect(() => decree43(72_000, 0)).toThrow();
  });
});
