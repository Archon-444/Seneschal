import { describe, expect, it } from "vitest";
import { redactLinkTokens } from "@/server/notify/email";

// The console email adapter logs message bodies outside production so the builder can retrieve
// seeded OTP codes. Secure-link tokens are bearer credentials and must be stripped from that log.
describe("redactLinkTokens", () => {
  it("redacts a /link/<token> URL", () => {
    const out = redactLinkTokens("Open https://app.example/link/abc-123_DEF to respond.");
    expect(out).not.toContain("abc-123_DEF");
    expect(out).toContain("/link/[redacted]");
  });

  it("redacts a proof+<token>@ intake address", () => {
    const out = redactLinkTokens("Reply to proof+abc-123_DEF@intake.example with the file.");
    expect(out).not.toContain("abc-123_DEF");
    expect(out).toContain("proof+[redacted]@");
  });

  it("redacts both forms when a body carries the token twice", () => {
    const token = "Zt9_kQ-7Lm";
    const out = redactLinkTokens(
      `Upload at https://app.example/link/${token} or email proof+${token}@intake.example`,
    );
    expect(out).not.toContain(token);
  });

  it("leaves a 6-digit OTP code intact (dev sign-in retrieval still works)", () => {
    const out = redactLinkTokens("Your sign-in code is 424242. It expires in 10 minutes.");
    expect(out).toContain("424242");
  });
});
