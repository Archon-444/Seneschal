import type { ProviderAdapter } from "./index";

// WhatsApp provider adapter. Mirrors email.ts's console/resend split:
// WHATSAPP_PROVIDER=meta sends via the Meta Cloud API; anything else is a safe
// no-op console log (default — nothing leaves the system without credentials).

/** True only when the Meta provider is fully configured. */
export function whatsappConfigured(): boolean {
  return (
    process.env.WHATSAPP_PROVIDER === "meta" &&
    !!process.env.WHATSAPP_PHONE_NUMBER_ID &&
    !!process.env.WHATSAPP_ACCESS_TOKEN
  );
}

export function whatsappAdapter(): ProviderAdapter {
  return process.env.WHATSAPP_PROVIDER === "meta" ? metaAdapter() : consoleAdapter();
}

function consoleAdapter(): ProviderAdapter {
  return {
    async send({ to }) {
      console.log(`[whatsapp:console] to=${to} (provider not configured — no-op)`);
      return { providerRef: null };
    },
  };
}

function metaAdapter(): ProviderAdapter {
  return {
    async send({ to, body }) {
      const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body },
        }),
      });
      if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${await res.text()}`);
      const data = (await res.json()) as { messages?: { id?: string }[] };
      return { providerRef: data.messages?.[0]?.id ?? null };
    },
  };
}
