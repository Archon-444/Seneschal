import { describe, expect, it } from "vitest";
import { redactLinkTokens } from "@/server/notify/email";

// Console adapter logs message bodies outside production. Bearer credentials
// (secure-link tokens and password-reset URLs) must be stripped from that log.
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

  it("redacts a /login/reset/<token> URL", () => {
    const token = "Zt9_kQ-7LmReset";
    const out = redactLinkTokens(`Reset at https://app.example/login/reset/${token}`);
    expect(out).not.toContain(token);
    expect(out).toContain("/login/reset/[redacted]");
  });

  it("redacts both forms when a body carries the token twice", () => {
    const token = "Zt9_kQ-7Lm";
    const out = redactLinkTokens(
      `Upload at https://app.example/link/${token} or email proof+${token}@intake.example`,
    );
    expect(out).not.toContain(token);
  });

  it("leaves ordinary prose intact", () => {
    const out = redactLinkTokens("Your password reset link expires in 1 hour.");
    expect(out).toBe("Your password reset link expires in 1 hour.");
  });
});
