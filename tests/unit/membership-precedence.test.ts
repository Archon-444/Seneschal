import { describe, expect, it } from "vitest";
import { pickMembership, rolePrecedence } from "@/server/authz";

// F0b — deterministic membership resolution. The @@unique([workspaceId, userId,
// role]) key permits a user to hold more than one role (e.g. an operator who also
// rents). `pickMembership` must resolve that to a single role by precedence, not by
// row order, so persona vs. operator scoping is never an insertion-order accident.

describe("role precedence", () => {
  it("ranks every operator/stakeholder role above the self-service personas", () => {
    const personas = [rolePrecedence("TENANT"), rolePrecedence("LANDLORD")];
    const operators = [
      "WORKSPACE_ADMIN",
      "FIDUCIARY",
      "ORG_ADMIN",
      "MANAGER",
      "CLIENT_VIEWER",
      "AGENT",
      "LICENSED_PARTNER",
      "VENDOR",
      "AUDITOR",
    ].map((r) => rolePrecedence(r as Parameters<typeof rolePrecedence>[0]));
    expect(Math.max(...operators)).toBeLessThan(Math.min(...personas));
  });
});

describe("pickMembership", () => {
  const older = new Date("2024-01-01");
  const newer = new Date("2025-01-01");

  it("returns null for an empty set", () => {
    expect(pickMembership([])).toBeNull();
  });

  it("picks the operator role over a persona even when the persona row is older", () => {
    const picked = pickMembership([
      { role: "TENANT", createdAt: older },
      { role: "FIDUCIARY", createdAt: newer },
    ]);
    expect(picked?.role).toBe("FIDUCIARY");
  });

  it("breaks ties within equal precedence by oldest createdAt", () => {
    const picked = pickMembership([
      { role: "MANAGER", createdAt: newer, tag: "new" },
      { role: "MANAGER", createdAt: older, tag: "old" },
    ]);
    expect(picked?.tag).toBe("old");
  });
});
