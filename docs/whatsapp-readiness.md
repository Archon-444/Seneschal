# WhatsApp readiness — ops tracking (T9.3)

**Code status: built, off by default.** The Meta Cloud API adapter
(`src/server/notify/whatsapp.ts`) and the signature-verifying webhook
(`src/app/api/v1/webhooks/whatsapp/route.ts`) are implemented and covered by the
integration suite (`tests/integration/whatsapp.test.ts`). They sit behind the
same `notify()` gateway as email and stay a **safe console no-op** until
`WHATSAPP_PROVIDER=meta` plus credentials are set — nothing leaves the system
without configuration, and the webhook returns 404 (and fails closed without
`WHATSAPP_APP_SECRET`) while the provider is unset.

Going live is therefore **an ops/approval step, not a code change.** The
remaining work is the Meta Business approvals, template catalogue, sender number
and opt-in flow tracked below.

## Ops checklist (no code involved — gates going live)

| Item | Owner | Status |
| --- | --- | --- |
| Meta Business Manager account verified | ops | ☐ not started |
| WhatsApp Business Platform (Cloud API) app created | ops | ☐ not started |
| Display name + business profile approved | ops | ☐ not started |
| Dedicated sender number provisioned (UAE) | ops | ☐ not started |
| Template catalogue drafted EN | product | ☐ draft below |
| Template catalogue translated AR | product | ☐ not started |
| Templates submitted for Meta approval | ops | ☐ blocked on above |
| Opt-in capture flow agreed (append-only ConsentRecord, contacts + users) | product | ☐ not started |

## Draft template catalogue (EN — AR translation pending)

1. `notice_gate_reminder` — "Reminder: the notice window for {{property}} closes on {{date}}. Review before action."
2. `cheque_due_reminder` — "Cheque {{chequeNo}} for {{property}} is due {{date}}. Record-keeping reminder only."
3. `cheque_followup` — "Cheque {{chequeNo}} for {{property}} was due {{date}} and is not yet recorded as received."
4. `proof_request` — "{{workspace}} requests evidence: {{title}}. Upload securely (no account needed): {{link}}"
5. `proof_received_ack` — "Thank you — your upload for {{title}} was received and recorded."

Copy constraints apply (no "by law"/"enforceable"/"lawful" phrasing; always
"review before action", "based on supplied data").

## Architecture note

**Outbound (built):** sends route through `notify()` → `whatsappAdapter()`. With
`WHATSAPP_PROVIDER=meta` the adapter POSTs to the Meta Graph API, passing the
outbox `idempotencyKey` as `biz_opaque_callback_data` so a crashed-after-accept
retry isn't a second send.

**Webhook (built):** `GET` is the verify-token handshake; `POST` verifies a
raw-body HMAC (`x-hub-signature-256`) with `timingSafeEqual` before parsing, then
defers to the Outbox (`whatsapp.status`) and returns 200 fast — no business logic
runs inline (§7). It is inert (404) unless `WHATSAPP_PROVIDER=meta`, and fails
closed (500) if `WHATSAPP_APP_SECRET` is unset rather than trusting an
empty-string HMAC key.

**Inbound proof submission (not yet built):** when added it will reuse the
email-intake path — provider webhook → Outbox → the same
`submitProofViaLink`-equivalent pipeline keyed by the tokenized conversation
reference. The current webhook handles delivery-status callbacks only.
