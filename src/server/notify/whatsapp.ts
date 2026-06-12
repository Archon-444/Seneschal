import type { ProviderAdapter } from "./index";

// TODO [Stage 1B]: WhatsApp live sending. Meta business verification and the
// EN/AR template catalogue are ops tasks tracked in /docs/whatsapp-readiness.md.
// This stub satisfies the gateway interface so 1B only swaps this module.

export function whatsappAdapter(): ProviderAdapter {
  return {
    async send({ to }) {
      console.log(`[whatsapp:stub] would send to=${to} (1B — not enabled in 1A)`);
      return { providerRef: null };
    },
  };
}
