import { describe, expect, it } from "vitest";
import {
  RENEWAL_COPY_TEST_FIXTURES,
  RenewalCopyComplianceError,
  assertRenewalCopyCompliant,
} from "@/server/services/renewalCopy";
import { RENEWAL_TEMPLATE_RENDERERS } from "@/server/services/renewalTemplates";

// PR6c — compliance copy gate. Build-time risk the plan called out: Seneschal
// is a platform, not a broker or legal adviser, and prior copy reviews have let
// "lawful ceiling" / "by law" slip through. The gate makes that mechanical.

describe("assertRenewalCopyCompliant — prohibited phrases", () => {
  // Match the fail-on-first-hit behaviour by isolating each phrase in an
  // otherwise-compliant body (so the failure isn't a missing framing).
  for (const banned of RENEWAL_COPY_TEST_FIXTURES.PROHIBITED_PHRASES) {
    it(`rejects "${banned}" (case-insensitive)`, () => {
      const body = `Proposed renewal — see the ${banned} below. Decree 43 band applies.`;
      expect(() => assertRenewalCopyCompliant(body)).toThrow(RenewalCopyComplianceError);
    });

    it(`rejects "${banned}" with mixed case`, () => {
      const mixed = banned.replace(/^\w/, (c) => c.toUpperCase());
      const body = `Notice: ${mixed} reference. Decree 43 band applies.`;
      expect(() => assertRenewalCopyCompliant(body)).toThrow(RenewalCopyComplianceError);
    });
  }

  it("does NOT reject the framing 'lawful' inside an unrelated word boundary", () => {
    // Word-boundary check: a phrase like "unlawfulness" must not trigger
    // "by law" or similar; substring matching here would be wrong. The body also
    // carries the required framing cues so it fails only if "lawfulness" trips.
    expect(() =>
      assertRenewalCopyCompliant(
        "This is a Decree 43 band note, based on landlord-provided data and an index captured on " +
          "2026-06-01, about lawfulness historically. For reference only; not legal advice.",
      ),
    ).not.toThrow();
  });
});

describe("assertRenewalCopyCompliant — required framing", () => {
  it("rejects copy that drops every approved framing", () => {
    expect(() =>
      assertRenewalCopyCompliant("Proposed renewal annual rent is AED 84,000. Please respond."),
    ).toThrow(RenewalCopyComplianceError);
  });

  it("rejects copy that has a framing but omits the supplied-data / capture / review cues", () => {
    expect(() => assertRenewalCopyCompliant("Reference: Decree 43 band of AED 84,000.")).toThrow(
      RenewalCopyComplianceError,
    );
  });

  for (const framing of RENEWAL_COPY_TEST_FIXTURES.APPROVED_FRAMINGS) {
    it(`accepts copy that uses the framing "${framing}"`, () => {
      expect(() =>
        assertRenewalCopyCompliant(
          `Reference: ${framing} of AED 84,000, based on landlord-provided data and an index ` +
            `captured on 2026-06-01. Proposed: AED 82,000. For reference only; not legal advice.`,
        ),
      ).not.toThrow();
    });
  }
});

describe("every registered renewal template passes the gate", () => {
  // If a new renewal template is added without registering it here, the next
  // engineer who follows the pattern in renewalTemplates.ts gets caught by
  // the gate itself; this test catches the registration coverage.
  for (const t of RENEWAL_TEMPLATE_RENDERERS) {
    it(`template ${t.code} renders compliant copy`, () => {
      const out = t.render();
      // The render function calls the gate; this re-assertion makes the test
      // fail loudly with the prohibited phrase if a future edit slips one in.
      expect(() => assertRenewalCopyCompliant(out)).not.toThrow();
    });
  }
});
