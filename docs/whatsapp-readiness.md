# WhatsApp readiness — Stage 1B ops tracking (T9.3)

WhatsApp live sending ships in Stage 1B. Stage 1A carries **zero code
dependency** on WhatsApp: the adapter in `src/server/notify/whatsapp.ts` is a
stub behind the same `notify()` gateway as email, so 1B swaps one module.

## Ops checklist (no code involved)

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

## Architecture note (1B intake)

Inbound WhatsApp proof submission will reuse the email-intake path: provider
webhook → Outbox → same `submitProofViaLink`-equivalent pipeline keyed by the
tokenized conversation reference. No webhook executes business logic inline (§7).
