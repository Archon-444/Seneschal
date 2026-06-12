import { describe, expect, it } from "vitest";
import { normalizeAdminEmail } from "@/server/seed";

// Codex P2 on PR #6: a blank adminEmail must never become a login-capable
// FIDUCIARY user with an empty email address.

describe("normalizeAdminEmail", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeAdminEmail("  Pilot@Example.COM ")).toBe("pilot@example.com");
  });

  it("rejects blank and whitespace-only values", () => {
    expect(() => normalizeAdminEmail("")).toThrow(/not a valid email/);
    expect(() => normalizeAdminEmail("   ")).toThrow(/not a valid email/);
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["nope", "a@b", "@example.com", "user@", "a b@example.com"]) {
      expect(() => normalizeAdminEmail(bad)).toThrow(/not a valid email/);
    }
  });
});
