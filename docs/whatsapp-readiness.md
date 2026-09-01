# WhatsApp readiness — ops tracking (T9.3)

**Code status: built, off by default.** The Meta Cloud API adapter
(`src/server/notify/whatsapp.ts`) and the signature-verifying webhook
(`src/app/api/v1/webhooks/whatsapp/route.ts`) are implemented and covered by the
integration suite (`tests/integration/whatsapp.test.ts`). They sit behind the
same `notify()` gateway as email. Outbound stays a **safe console no-op** until
`whatsappConfigured()` (`WHATSAPP_PROVIDER=meta` plus phone-number id and access
token). The webhook is 404 while the provider is unset, and fails closed without
`WHATSAPP_APP_SECRET` once the provider is `meta`. Missing webhook secrets do
**not** keep outbound as a no-op.

Going live is therefore **an ops/approval step, not a code change.** The
remaining work is the Meta Business approvals, template catalogue, sender number
and opt-in flow tracked below.

## Env

Listed in `.env.example`. Two thresholds — do not conflate them.

### Outbound (leaves the console no-op)

`whatsappConfigured()` is true when all three are set. `notify()` may then send
real Meta Cloud API messages **even if the webhook secrets below are missing**.

| Var | Role |
| --- | --- |
| `WHATSAPP_PROVIDER` | `meta` to enable the adapter; anything else is a no-op |
| `WHATSAPP_PHONE_NUMBER_ID` | Graph API sender |
| `WHATSAPP_ACCESS_TOKEN` | Graph API bearer |

### Webhook (delivery-status callbacks)

The route is 404 unless `WHATSAPP_PROVIDER=meta`. These two do **not** gate
outbound send:

| Var | Role |
| --- | --- |
| `WHATSAPP_VERIFY_TOKEN` | webhook `GET` handshake |
| `WHATSAPP_APP_SECRET` | HMAC for `x-hub-signature-256`; fail-closed if unset while provider is `meta` |

A complete live channel (outbound **and** a verified webhook) needs all five.

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
