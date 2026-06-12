import type { ProviderAdapter } from "./index";

// Email provider adapter. EMAIL_PROVIDER=console logs (dev/test);
// EMAIL_PROVIDER=resend sends via Resend's HTTP API.

export function emailAdapter(): ProviderAdapter {
  return process.env.EMAIL_PROVIDER === "resend" ? resendAdapter() : consoleAdapter();
}

function consoleAdapter(): ProviderAdapter {
  return {
    async send({ to, subject }) {
      console.log(`[email:console] to=${to} subject=${subject ?? "(none)"}`);
      return { providerRef: `console-${Date.now()}` };
    },
  };
}

function resendAdapter(): ProviderAdapter {
  return {
    async send({ to, subject, body }) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
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
