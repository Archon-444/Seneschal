import { describe, expect, it } from "vitest";
import {
  assertNotQuarantined,
  isQuarantined,
  QuarantinedFeatureError,
} from "@/server/config/features";

// Pilot quarantine tripwire (see QUARANTINE.md). These assert the surfaces are
// gated *on* — the service-level integration suites (tenantPassport, listings,
// …) stay green in parallel, so the suite simultaneously proves "surface gated"
// and "logic intact". Flipping a flag to revive a feature trips this test,
// forcing the deliberate revival checklist rather than a silent re-exposure.

describe("pilot quarantine flags", () => {
  it("passport and listings are quarantined", () => {
    expect(isQuarantined("passport")).toBe(true);
    expect(isQuarantined("listings")).toBe(true);
  });

  it("assertNotQuarantined throws a 404-typed error for a gated feature", () => {
    try {
      assertNotQuarantined("listings");
      throw new Error("expected assertNotQuarantined to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(QuarantinedFeatureError);
      expect((e as QuarantinedFeatureError).status).toBe(404);
    }
  });

  it("the operator marketplace write actions fail closed while listings is quarantined", async () => {
    // The gate is the FIRST line of each action (before requireCtx), so it throws without a DB or
    // a request context — proving the nav removal is enforcement-backed, not hiding-only.
    const actions = await import("@/app/(app)/actions");
    for (const run of [
      () => actions.setEnquiryStatusAction(new FormData()),
      () => actions.createViewingAction(new FormData()),
      () => actions.setViewingStatusAction(new FormData()),
    ]) {
      await expect(run()).rejects.toBeInstanceOf(QuarantinedFeatureError);
    }
  });
});
