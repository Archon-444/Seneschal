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
pnpm db:seed                    # idempotent Farina fixture workspace
pnpm fixtures:render            # render fixture PDFs for the harness
pnpm dev                        # app on :3000
pnpm worker                     # outbox runner + daily jobs (separate shell)
```

Sign in as `farina@example.com` — with `EMAIL_PROVIDER=console` the OTP is
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
| `EXTRACTION_PROVIDER` | `mock` (or `anthropic` + `ANTHROPIC_API_KEY`) |

After the first deploy, seed once from any machine:
`DATABASE_URL=<neon-url> APP_BASE_URL=<https-url> pnpm db:seed` — idempotent, and
it prints the live external proof-upload link.

**Storage caveat (pilot):** Vercel Blob URLs are public-but-unguessable. The URL
lives only in `Document.storageKey` and is never rendered; client downloads go
exclusively through the signed, logged `/api/v1/files` route with the SHA-256
re-verified. A strictly private bucket driver (S3/Supabase) is the 1B upgrade.

## Non-goals (1A)

No marketplace/listings/brokerage flows, no payment processing or custody, no
legal advice, no contractor dispatch, no renewal workflow (schema enums
reserved), no live WhatsApp (see `docs/whatsapp-readiness.md`), no anomaly AI.

## Stage 1B / 2 hooks

`TODO` markers only: WhatsApp adapter swap, maintenance UI (schema live),
renewal tables (deliberately not migrated — see end of `schema.prisma`).
