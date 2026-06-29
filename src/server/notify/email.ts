import type { ProviderAdapter } from "./index";

// Email provider adapter. EMAIL_PROVIDER=console logs (dev/test);
// EMAIL_PROVIDER=resend sends via Resend's HTTP API.

export function emailAdapter(): ProviderAdapter {
  return process.env.EMAIL_PROVIDER === "resend" ? resendAdapter() : consoleAdapter();
}

function consoleAdapter(): ProviderAdapter {
  return {
    async send({ to, subject, body }) {
      // Dev/preview retrieval path: the body (incl. a live OTP code) is logged ONLY outside
      // production, so the builder can sign into seeded demo logins. Secure-link tokens are
      // bearer credentials, not demo codes — redact them so a live /link/<token> (or the
      // proof+<token>@ intake address) never lands in logs even in dev. In production the console
      // adapter is not selected (resend is), and even if it were, the body is withheld.
      const detail =
        process.env.NODE_ENV !== "production" ? ` body=${JSON.stringify(redactLinkTokens(body))}` : "";
      console.log(`[email:console] to=${to} subject=${subject ?? "(none)"}${detail}`);
      return { providerRef: `console-${Date.now()}` };
    },
  };
}

/** Strip secure-link tokens from a body before it is logged — the token is the credential that
 *  gates the public link, so it must not reach a log sink. Leaves OTP codes (6 digits) intact so
 *  the dev sign-in retrieval path still works. */
export function redactLinkTokens(body: string): string {
  return body
    .replace(/\/link\/[A-Za-z0-9_-]+/g, "/link/[redacted]")
    .replace(/proof\+[A-Za-z0-9_-]+@/g, "proof+[redacted]@");
}

function resendAdapter(): ProviderAdapter {
  return {
    async send({ to, subject, body, idempotencyKey }) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      };
      // H1: Resend treats Idempotency-Key as a deduper across retries within
      // 24h. A worker that crashed after Resend accepted will hit the same
      // key on retry and Resend returns the original id instead of resending.
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? "Seneschal <noreply@example.com>",
          to: [to],
          subject: subject ?? "Seneschal notification",
          text: body,
        }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { id?: string };
      return { providerRef: data.id ?? null };
    },
  };
}
