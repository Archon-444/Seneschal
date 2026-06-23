# Seneschal

Portfolio oversight and tenancy evidence platform for Dubai real estate.

**Know what is due. Know who owns it. Keep the proof.**

Owners, fiduciaries and licensed operators keep one trusted record of
properties, leases, cheques, deadlines, documents and proof — without replacing
licensed execution or holding funds. Evidence-first, workflow-second, AI-third:
AI never writes trusted records; every extracted field passes human review.

## Stack

Next.js (App Router) · TypeScript · Tailwind · Prisma + PostgreSQL · email OTP
auth · private object storage with signed expiring URLs · Resend email gateway
(WhatsApp adapter stubbed for 1B) · Outbox + in-process job runner · Vitest.

## Setup

```bash
pnpm install
cp .env.example .env            # set APP_SECRET (openssl rand -hex 32)
createdb seneschal && createdb seneschal_test   # postgres 16
pnpm exec prisma migrate deploy # apply migrations
pnpm db:seed                    # idempotent fixture workspace
pnpm fixtures:render            # render fixture PDFs for the harness
pnpm dev                        # app on :3000
pnpm worker                     # outbox runner + daily jobs (separate shell)
```

Sign in as `operator@example.com` — with `EMAIL_PROVIDER=console` the OTP is
printed by whichever process flushes the outbox (the dev server flushes
immediately after you request the code; check its terminal).

`pnpm db:seed` prints a **live external proof-upload link** (`/link/<token>`);
open it in a private window or on a phone — no login involved.

## Tests

```bash
pnpm test              # everything (needs seneschal_test db)
pnpm test:unit         # calculators, capability matrix, crypto
pnpm test:integration  # scoping ⛔, imports ⛔, proofs, payments, documents, extraction ⛔
```

160 tests. The cross-workspace suite (T1.4), import machinery (T6.1), secure
links (T7.2), upload pipeline (T5.1/2) and the extraction harness vs
`fixtures/ground-truth.json` (T6.3/4) are release gates and run in CI.

## Architecture notes

- **Authorization**: every service function takes an `AuthzContext` produced by
  the single `authz()` helper (`src/server/authz.ts`). No Prisma outside
  `src/server` — an ESLint rule fails the build if `src/app` imports the db.
  CLIENT_VIEWER contexts are pinned to one ClientPrincipal.
- **Calculators decide** (`src/server/calculators/dates.ts`): pure, versioned;
  every Deadline row stores `{rule, version, inputs}`. Computed for the
  Asia/Dubai calendar, stored UTC.
- **Append-only evidence**: `EvidenceEvent`, `AuditEvent`, `DocumentAccessLog`
  are insert-only — enforced in the app layer *and* by DB triggers
  (migration `insert_only_guards`). All writes go through `recordEvidence()` /
  `recordAudit()`.
- **Outbox** (`src/server/outbox`): request handlers enqueue side effects; the
  runner dispatches with retry/backoff and runs the daily jobs (late cheques,
  overdue proofs, risk re-evaluation, alert ladders).
- **Documents**: SHA-256 at ingest, verified again on every download; no public
  URLs — only HMAC-signed expiring links served by `/api/v1/files/[id]`, every
  access logged.
- **Secure links**: raw token shown once; only the hash is stored; expiry,
  maxUses and audited revocation.
- **Intake**: OCR (`ExtractionJob` → review screen → confirm) and Excel/CSV both
  commit through the same `ImportBatch` machinery. Conflicts block the row, not
  the batch; commit is atomic; rollback archives via `createdRecordRefs`.
- **Risk rules** (deterministic 1A set): MISSING_EJARI, MISSING_END_DATE,
  CHEQUE_TOTAL_MISMATCH, NOTICE_GATE_WITHIN_30D, PROOF_OVERDUE, PAYMENT_LATE,
  TENANCY_OVERLAP. One open flag per code per scope; raise/clear write evidence.
- **Schema**: `prisma/schema.prisma` is the provided v1.0 schema with two
  declared adjustments — enums expanded to Prisma's multi-line syntax, and
  `AuthOtp`/`Session` tables appended for the OTP auth abstraction.

## Stage 1A acceptance walkthrough (T11.2)

Scripted pass proving the P1 exit criteria, on a seeded database with `pnpm dev`
and `pnpm worker` running:

1. **Onboard via OCR** — Imports → "Extract from document", upload
   `fixtures/pdf/fixture-1-contract-marina.pdf` with *Extract fields* checked
   (`EXTRACTION_PROVIDER=mock` replays the recorded output). The review screen
   shows every field with confidence and source snippet. Correct any field,
   then *Confirm & commit*. A property, tenancy, 4 cheques and 7 deadlines
   appear; evidence shows FIELD_EXTRACTED → FIELD_CONFIRMED → IMPORT_COMMITTED.
   Repeat with fixture 2 (Bayview): commit raises **MISSING_EJARI** and the
   60-day override puts the notice gate at 01 Sep 2026. (Manual path: add the
   three seeded properties by hand — already present from `pnpm db:seed`.)
2. **Tenancies + schedules** — property detail → tenancy tab shows term, rent,
   notice gate with rule citation; payments tab shows the cheque schedule.
3. **Calendar** — `/calendar` renders the month grid plus upcoming/overdue
   lists, Dubai-local dates; NOTICE_GATE/CHEQUE_DUE rows present.
4. **Cheque lifecycle** — payments tab: Mark received → deposited → cleared.
   Each step writes CHEQUE_* evidence (visible on the evidence tab). An
   out-of-order transition (e.g. clear before deposit) is rejected.
5. **Proof fulfilled by an external party without an account** — Proofs → new
   request assigned to Samir Khan → "Create & send secure link" (email visible
   in the worker/console log, link inside). Open the link in a private window,
   upload a photo, see the consent notice. The request flips to SUBMITTED;
   approve it. Evidence shows PROOF_REQUESTED → PROOF_UPLOADED →
   CONSENT_GRANTED → PROOF_APPROVED.
6. **Evidence timeline complete** — `/evidence` lists the full chronology with
   taxonomy labels and payloads.
7. **Document access logged** — `/vault` → any document → access log shows
   UPLOADED/VIEWED/DOWNLOADED rows; downloads only via the signed 5-minute URL.
8. **Email alerts recorded** — the worker's daily pass runs the notice-gate and
   cheque ladders; `/admin` (staff) → notification log shows REMINDER_SENT
   rows; each send is also a REMINDER_SENT evidence event.
9. **Monthly report** — Clients → Generate for Al Noor Family Office →
   printable report (browser print → PDF) + CSV export; REPORT_GENERATED /
   REPORT_EXPORTED evidence written.
10. **Security suite green** — `pnpm test:integration` (T1.4 cross-workspace
    suite + the rest) and `pnpm test` all green; CI runs the same.

## Stage 2 renewal acceptance walkthrough

Scripted pass proving the renewal loop end-to-end, on a seeded database with
`pnpm dev` and `pnpm worker` running. It drives one tenancy from a verified
landlord record to a minted successor; each step names the evidence it must
emit. The automated form of this checklist is the renewal integration suite
(`tests/integration/renewalWalkthrough.test.ts`, `renewalStage2.test.ts`,
`renewalConcurrency.test.ts`), which runs in CI.

1. **Open the renewal assessment** — `/renewals` lists units inside the renewal
   window with their notice gate and estimated uplift. Open one (e.g. the seeded
   Marina lease) → `/renewals/[tenancyId]` → **Open renewal case**. The case opens
   in ASSESSING; evidence shows `RENEWAL_ASSESSMENT_CREATED`.
2. **Capture the index figure** — in the Decree-43 position card, capture a
   market-rent average (source = DLD Smart Rental Index, with a source reference).
   The lawful ceiling and value-at-risk compute from `decree_43_v1`; evidence shows
   `INDEX_CAPTURED`. A bare capture is labelled a provisional concierge estimate,
   never DLD-sourced, and stays distinct from an official figure.
3. **Serve the change notice (prepare → approve → serve)** — the notice card walks
   three states: generate, approve, then serve with a method, delivery reference
   and proof document. Each transition is a single evidence row, in order:
   `NOTICE_GENERATED` → `NOTICE_APPROVED` → `NOTICE_SERVED`. Serving clears any
   `RENEWAL_NOTICE_WINDOW_MISSED` flag; out-of-order transitions are rejected.
4. **Propose terms** — in the negotiation workspace, add terms (party = landlord,
   annual rent at or below the ceiling, payment schedule). The offer freezes
   `permittedMaxSnapshot` and a self-contained index citation at send time;
   evidence shows `OFFER_PROPOSED`. An offer above the ceiling raises
   `PROPOSED_INCREASE_ABOVE_INDEX_BAND` (visible on `/risk`) from the frozen
   snapshot — later index captures do not move it.
5. **Send the offer to the tenant** — **Send to tenant** mints a single-use
   `TENANT_OFFER` secure link (raw token shown once; only the hash is stored).
6. **Tenant acknowledges via the secure link** — open `/link/<token>` in a private
   window (no login). The tenant sees the proposed terms against the index average
   and can Accept, Counter or Ask. Accept records consent and moves the case to
   AGREED; evidence shows `TENANT_ACKNOWLEDGED` → `OFFER_ACCEPTED`. (A counter
   writes `OFFER_COUNTERED` and keeps the case negotiating.)
7. **Mint the successor tenancy** — with the case AGREED, `mintRenewedTenancy`
   creates the successor in one transaction: it carries `renewsFromTenancyId`, the
   predecessor flips to RENEWED, the case flips to RENEWED with `renewedTenancyId`
   set, and exactly one `RENEWAL_COMPLETED` row is written — prior events are *not*
   back-filled, so the timeline stays truthful. Concurrent mints collapse to one
   successor and the loser gets a clean 409. *UI status: this final step is
   currently a service-layer action with no button yet (driven by the seed/worker
   and covered by `renewalWalkthrough.test.ts`).*
8. **Evidence + risk timeline** — `/evidence` shows the full chronology with
   strictly-monotonic timestamps (no batch-stamp at mint); `/risk` shows the
   renewal flags raised and cleared by the nightly sweep (`evaluateWorkspaceRisk`,
   invoked by the authenticated `/api/v1/jobs/run` cron).

## Deploy (Vercel)

The repo is serverless-ready: `vercel-build` runs `prisma migrate deploy` before
`next build`, `vercel.json` schedules the daily job pass at 03:00 UTC (07:00
Dubai) against `/api/v1/jobs/run`, and user-facing sends (OTP, proof links) flush
the outbox inline with the cron as retry backstop. `pnpm worker` remains the
local-dev runner.

| Env var | Value |
| --- | --- |
| `DATABASE_URL` | from the Neon (Vercel marketplace) integration |
| `APP_SECRET` | `openssl rand -hex 32` |
| `APP_BASE_URL` | `https://<your-domain>` (used in emails + secure links) |
| `EMAIL_PROVIDER` / `RESEND_API_KEY` / `EMAIL_FROM` | `resend` + your key + verified sender |
| `STORAGE_DRIVER` / `BLOB_READ_WRITE_TOKEN` | `blob` + token from the attached Blob store |
| `CRON_SECRET` | `openssl rand -hex 32` (auth for the cron route) |
| `EXTRACTION_PROVIDER` | `mock`, or `gemini` + `GEMINI_API_KEY`, or `anthropic` + `ANTHROPIC_API_KEY` |

After the first deploy, seed once from any machine:
`DATABASE_URL=<neon-url> APP_BASE_URL=<https-url> pnpm db:seed` — idempotent, and
it prints the live external proof-upload link.

**Storage:** the Vercel Blob store is **private** — bytes are reachable only via the
SDK with `BLOB_READ_WRITE_TOKEN`, the stored url is not publicly fetchable, and client
downloads go exclusively through the signed, logged `/api/v1/files` route with the
SHA-256 re-verified. An S3/Supabase driver remains an optional alternative behind the
same `StorageDriver` interface.

## Non-goals (1A)

No marketplace/listings/brokerage flows, no payment processing or custody (the
payments/DDS rail is the future **Phase 2** — Seneschal stays record-keeping
only), no legal advice, no contractor dispatch, no live WhatsApp (see
`docs/whatsapp-readiness.md`), no anomaly AI. (The **Stage 2 renewal engine** is
built and migrated — it is no longer a non-goal; see the renewal acceptance
walkthrough above.)

## Stage 1B hooks &amp; terminology

`TODO` markers only: WhatsApp adapter swap (Stage 1B), maintenance UI (schema
live). The **Stage 2 renewal engine is built and migrated** — RenewalCase,
RentIndexCapture, Offer and Notice ship across the renewal migrations, with the
full service layer in `src/server/services/renewals.ts` and the loop proven by
the integration suite (`tests/integration/renewal*.test.ts`).

**Terminology:** "Stage 2 / S2" is the renewal engine (shipped). **"Phase 2" is
reserved for the future payments/DDS rail** (still a non-goal — Seneschal never
holds funds) and must not be read as the Stage-2 renewal work.
