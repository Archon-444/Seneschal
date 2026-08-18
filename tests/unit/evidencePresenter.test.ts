import { describe, expect, it } from "vitest";
import {
  APPROVED_EVIDENCE_TYPES,
  EVIDENCE_CATEGORIES,
  evidenceTypesForCategory,
  presentEvidenceEvent,
  titleForEvidenceType,
  type EvidenceEventForPresentation,
} from "@/server/services/evidencePresenter";

const createdAt = new Date("2026-08-18T08:15:00.000Z");

function event(overrides: Partial<EvidenceEventForPresentation> = {}): EvidenceEventForPresentation {
  return {
    id: "event-1",
    type: "INDEX_CAPTURED",
    actorType: "USER",
    actorId: "user-1",
    onBehalfOfId: null,
    scopeType: "TENANCY",
    scopeId: "tenancy-1",
    propertyId: "property-1",
    tenancyId: "tenancy-1",
    payload: { source: "DLD Smart Rental Index", calculatorVersion: "v1", provisional: false },
    payloadHash: "hash-1",
    supersedesId: null,
    createdAt,
    ...overrides,
  };
}

describe("evidence presenter", () => {
  it("has a human title for every current EvidenceType", () => {
    expect(APPROVED_EVIDENCE_TYPES.length).toBeGreaterThan(60);
    for (const type of APPROVED_EVIDENCE_TYPES) {
      const title = titleForEvidenceType(type);
      expect(title).toBeTruthy();
      expect(title).not.toBe(type);
      expect(presentEvidenceEvent(event({ type })).fallback).toBe(false);
    }
  });

  it("keeps the stable category taxonomy complete", () => {
    const categorized = EVIDENCE_CATEGORIES.flatMap((category) => evidenceTypesForCategory(category.value) ?? []);
    expect(new Set(categorized)).toEqual(new Set(APPROVED_EVIDENCE_TYPES));
    expect(categorized).toHaveLength(APPROVED_EVIDENCE_TYPES.length);
  });

  it("falls back without inventing meaning for a future type", () => {
    const presented = presentEvidenceEvent(event({ type: "FUTURE_EVENT" }));
    expect(presented.fallback).toBe(true);
    expect(presented.title).toBe("Unrecognized evidence event");
    expect(presented.summary).toMatch(/no meaning has been inferred/i);
    expect(presented.technicalDetails.type).toBe("FUTURE_EVENT");
  });

  it("presents actor, on-behalf-of, scope and document context without changing the event", () => {
    const source = event({ onBehalfOfId: "principal-1" });
    const before = JSON.stringify(source);
    const presented = presentEvidenceEvent(source, {
      actorLabel: "Maya · manager",
      onBehalfOfLabel: "Al Noor Holdings",
      scopeLabel: "Dubai Marina · Unit 1204",
      scopeHref: "/properties/property-1",
      relatedLinks: [{ label: "notice.pdf", detail: "Document · SHA-256 abc" }],
    });
    expect(presented.actorLabel).toBe("Maya · manager");
    expect(presented.onBehalfOfLabel).toBe("Al Noor Holdings");
    expect(presented.scopeHref).toBe("/properties/property-1");
    expect(presented.relatedLinks[0].detail).toContain("SHA-256");
    expect(JSON.stringify(source)).toBe(before);
  });

  it("surfaces provisional/source/rule/calculator provenance", () => {
    const presented = presentEvidenceEvent(event({
      payload: {
        source: "Manual concierge estimate (awaiting verification)",
        indexSource: "MANUAL_CONCIERGE",
        sourceRef: { screenshotId: "shot-1" },
        calculatorVersion: "decree43-v1",
        ruleVersion: "1a.1",
      },
    }));
    expect(presented.summary).toMatch(/awaiting verification/i);
    expect(presented.provenance.join(" ")).toMatch(/calculator version/i);
    expect(presented.provenance.join(" ")).toMatch(/rule version/i);
    expect(presented.provenance.join(" ")).toMatch(/source reference/i);
  });

  it("keeps both sides of correction lineage visible", () => {
    const correction = presentEvidenceEvent(event({ id: "event-2", type: "FIELD_CORRECTED", supersedesId: "event-1" }), {
      supersedesTitle: "Fields confirmed",
    });
    expect(correction.correctionState[0]).toMatchObject({ kind: "CORRECTION_TO", eventIds: ["event-1"] });

    const original = presentEvidenceEvent(event(), {
      correctedBy: [{ id: "event-2", title: "Recorded field corrected" }],
    });
    expect(original.correctionState[0]).toMatchObject({ kind: "CORRECTED_BY", eventIds: ["event-2"] });
  });

  it("uses neutral unavailable labels and retains the stored UTC timestamp", () => {
    const presented = presentEvidenceEvent(event(), { unavailableRelatedRecord: true });
    expect(presented.scopeLabel).toBe("Related record unavailable");
    expect(presented.scopeHref).toBeNull();
    expect(presented.occurredAt).toBe(createdAt);
    expect(presented.technicalDetails.storedUtc).toBe("2026-08-18T08:15:00.000Z");
  });
});
