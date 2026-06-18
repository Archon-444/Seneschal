// Deterministic rent-position calculator (Renewal Risk Desk). Like the date
// calculators, results carry { rule, version, inputs } so every renewal report
// can cite its math. Estimates only — Seneschal is not a broker or legal adviser.
//
// Decree No. (43) of 2013 caps the increase a landlord may apply at renewal by
// how far the current rent sits below the average market rent (the captured DLD
// Smart Rental Index figure):
//   ≤10% below  → 0%   ·  >10–20% → 5%  ·  >20–30% → 10%
//   >30–40%     → 15%  ·  >40%     → 20%

export interface RentPositionResult {
  currentRent: number;
  marketRentAvg: number;
  /** Fraction the current rent sits below market (0..1, clamped at 0). */
  gapPct: number;
  /** Estimated permissible increase band as a whole percentage: 0 | 5 | 10 | 15 | 20. */
  bandPct: number;
  /** Index-based ceiling estimate = currentRent × (1 + bandPct/100). */
  ceiling: number;
  /** Annual uplift forgone if no valid notice is served = ceiling − currentRent. */
  valueAtRisk: number;
  rule: string;
  version: string;
  inputs: Record<string, unknown>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Decree 43 estimated permissible increase band, ceiling and value-at-risk for a renewal. */
export function decree43(currentRent: number, marketRentAvg: number): RentPositionResult {
  if (!(currentRent > 0) || !(marketRentAvg > 0)) {
    throw new Error("decree43 requires positive currentRent and marketRentAvg");
  }
  // How far current rent is below the market average (negative if at/above market → 0).
  const gapPct = Math.max(0, (marketRentAvg - currentRent) / marketRentAvg);

  let bandPct: number;
  if (gapPct <= 0.1) bandPct = 0;
  else if (gapPct <= 0.2) bandPct = 5;
  else if (gapPct <= 0.3) bandPct = 10;
  else if (gapPct <= 0.4) bandPct = 15;
  else bandPct = 20;

  const ceiling = round2(currentRent * (1 + bandPct / 100));
  const valueAtRisk = round2(ceiling - currentRent);

  return {
    currentRent,
    marketRentAvg,
    gapPct,
    bandPct,
    ceiling,
    valueAtRisk,
    rule: "decree_43",
    version: "v1",
    inputs: { currentRent, marketRentAvg },
  };
}

/** The provenance label PR6 captures persist with their computed fields, so
 *  every backfilled-vs-contemporaneous comparison reads the same string. */
export const DECREE_43_CALCULATOR_VERSION = "decree_43_v1";
