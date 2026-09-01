# Seneschal

Portfolio oversight and tenancy evidence platform for Dubai real estate.

**Know what is due. Know who owns it. Keep the proof.**

Owners, fiduciaries and licensed operators keep one trusted record of
properties, leases, cheques, deadlines, documents and proof — without replacing
licensed execution or holding funds. Evidence-first, workflow-second, AI-third:
AI never writes trusted records; every extracted field passes human review.

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Prisma 6 + PostgreSQL ·
email + password auth (scrypt; hashed `Session` cookie) · private object storage
with signed expiring URLs · Resend email gateway (WhatsApp Meta Cloud API
adapter built, off by default) · Outbox + in-process job runner · Vitest +
Playwright.

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

Sign in at `/login` as `operator@example.com` / `seneschal-dev` (or
`SEED_DEMO_PASSWORD` if you set one). The seed also seats `farina@example.com`
(FIDUCIARY), `owner@example.com` (`/portal`), `managing-agent@example.com`
(delegate), `absentee-owner@example.com` (CLIENT_VIEWER), and
`staff@seneschal.example` (platform console at `/admin` — data-blind). Forgot-
password and invite mails log to the terminal when `EMAIL_PROVIDER=console`
(the default); set `EMAIL_PROVIDER=resend` plus `RESEND_API_KEY` to send for
real. There is no SMTP/Mailpit adapter.

Production seed does not apply a shared password unless `SEED_DEMO_PASSWORD`
is set — first login is via the forgot-password reset mail.

`pnpm db:seed` prints three blocks: workspaces, **member logins with their
landing route**, and **link-party URLs** (tenant offer, tenant ID proof, absentee
owner `APPROVAL` sign-off, agent proof-upload). Open a `/link/<token>` URL in a
private window — no login involved. The tenant is a link-party, not a member.

## Auth

Users sign in with email + password. Policy is ≥10 characters (`MIN_PASSWORD_LENGTH`).
Five failed guesses lock the account for 15 minutes — even the correct password
is refused until then, and unknown emails / wrong passwords / lockouts share one
message. Invite-accept (`/invite/[token]`) and forgot-password
(`/login/forgot` → `/login/reset/[token]`) are the only writers of `passwordHash`.
Tenants and one-shot counterparties stay on SecureLink — they never get a
password. Never log passwords or raw reset tokens.

`AuthOtp` remains in the catalog unused (OTP login was removed). `Session` and
`PasswordReset` are live. `generateOtp()` in `src/server/crypto.ts` is leftover
and must not be wired back up.

## Access (as built)

Two provisionable licences (`src/lib/licences.ts`): **Landlord** (`OWNER`) and
**Fiduciary** (`FIDUCIARY`). `OPERATOR` / `INTERNAL` are demo shells in the seed;
`provisionWorkspace` refuses them. Workspace type is a licence, not a UI
layout — navigation is role-driven via `homePathFor`. The platform admin is
data-blind (no membership). Detail: `docs/architect-vs-workspace-admin.md`.

**Invite by seat**, never by Role enum or capability bundle (`src/lib/seats.ts`,
`/members`):

| Seat (UI) | Role stored | Notes |
| --- | --- | --- |
| Office admin | `ORG_ADMIN` | People/config only; cannot open a tenancy |
| Staff | `MANAGER` | Day-to-day portfolio work. `FIDUCIARY` is not a second invite seat |
| Agent | `MANAGING_AGENT` | Empty book signs in to empty lists |
| Owner | `LANDLORD` + OWNER contact | Fiduciary workspaces only |

Workspace admin is seat-zero (provisioning), not invited from `/members`. Additive
grants honor **only** `ORG_ADMIN` (`GRANT_HONORED_BUNDLES`) — data shapes come from
the base role, because a grant carries no scope.

**Agent book:** one responsible `MANAGING_AGENT` per property via
`PropertyAssignment` (`/members/assignments`). Vacant sibling units stay invisible
until assigned. An empty book is a valid login.

## Tests

```bash
pnpm test              # Vitest unit + integration (needs seneschal_test db)
pnpm test:unit         # calculators, capability matrix, crypto, seats, licences
pnpm test:integration  # scoping, imports, proofs, payments, documents, extraction,
                       # auth, members, assignments, renewals, platform plane
pnpm test:e2e          # Playwright: renewal walkthrough, secure links, a11y,
                       # role routes, action visibility, visual contracts
```

CI (`.github/workflows/ci.yml`) runs lint, `scope-audit`, typecheck, migrate,
fixtures, `pnpm test`, `pnpm build`, then Playwright Chromium including visual
baselines. Local tests: `service postgresql start`, then
`DATABASE_URL=postgresql://seneschal:seneschal@localhost:5432/seneschal_test`.

The cross-workspace suite (T1.4), import machinery (T6.1), secure links (T7.2),
upload pipeline (T5.1/2) and the extraction harness vs `fixtures/ground-truth.json`
(T6.3/4) are release gates and run in CI.

## Architecture notes

- **Authorization**: every service function takes an `AuthzContext` from
  `authz()` (`src/server/authz.ts`). No Prisma from `src/app` — an ESLint rule
  fails the build if a route imports `@/server/db` or `@prisma/client`. Writers
  live under `src/server` (services, auth, audit, evidence, outbox, notify,
  admin, seed). CLIENT_VIEWER contexts are pinned to one ClientPrincipal; persona
  roles pin `subjectContactId`; `MANAGING_AGENT` is confined to
  `delegatePropertyIds`. Capability matrix: `src/server/capabilities.ts`.
- **Calculators decide** (`src/server/calculators/dates.ts`, `rent.ts`): pure,
  versioned; every Deadline row stores `{rule, version, inputs}`. Computed for
  the Asia/Dubai calendar, stored UTC.
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
  maxUses and audited revocation. Purposes in the live product include
  `PROOF_UPLOAD`, `TENANT_OFFER`, and `APPROVAL`.
- **Intake**: OCR (`ExtractionJob` → review screen → confirm) and Excel/CSV both
  commit through the same `ImportBatch` machinery. Conflicts block the row, not
  the batch; commit is atomic; rollback archives via `createdRecordRefs`.
- **Risk rules**: one open flag per code per scope; raise/clear write evidence.
  **Evaluated** by `src/server/services/risk.ts`: `MISSING_EJARI`,
  `MISSING_END_DATE`, `CHEQUE_TOTAL_MISMATCH`, `NOTICE_GATE_WITHIN_30D`,
  `PROOF_OVERDUE`, `PAYMENT_LATE`, `TENANCY_OVERLAP`, plus Stage 2
  `PROPOSED_INCREASE_ABOVE_INDEX_BAND` and `RENEWAL_NOTICE_WINDOW_MISSED`.
  **Reserved** (reason strings only; no raise path yet — maintenance UI is
  schema-only): `AGENT_UNRESPONSIVE`, `INVOICE_WITHOUT_QUOTE`,
  `MAINTENANCE_DONE_WITHOUT_TENANT_CONFIRMATION`, `DOCUMENT_EXPIRED`,
  `APPROVAL_PENDING_TOO_LONG`.
- **Schema**: `prisma/schema.prisma` is the v1.0 schema with Prisma multi-line
  enums, password-auth tables (`Session` / `PasswordReset`; leftover `AuthOtp`
  unused), and Stage 2 renewal models (shipped — not deferred). Non-polymorphic
  trust refs (`Tenancy` parties, `Property` client/owner/agent, plus
  `PropertyAssignment`) are real FKs (`docs/trust-references.md`). The renewal
  loop is mapped in `docs/renewal-loop.md`.

## Operator surfaces

Capability-filtered nav (`src/components/shell/nav.ts`): Overview, Renewals,
Properties, Clients, Payments, Evidence; under More — Calendar, Risk, Proofs,
Vault, Contacts, Reports, Import & extract; Manage — Members & access
(`/members`, assignments at `/members/assignments`). Creates live in the header
“+ New” menu (onboard tenancy, property). Settings and notifications are on the
user menu (`/settings`, `/notifications`). Marketplace routes (`/enquiries`,
`/viewings`, portal passport/listings) are quarantined — see `QUARANTINE.md`.

## Stage 1A acceptance walkthrough (T11.2)

Scripted pass proving the P1 exit criteria, on a seeded database with `pnpm dev`
and `pnpm worker` running:

1. **Onboard via OCR** — Imports → "Extract from document", upload
   `fixtures/pdf/fixture-1-contract-marina.pdf` (`EXTRACTION_PROVIDER=mock`
   replays the recorded output; extract is on by default). The review screen
   shows landlord, tenant, asset and term — each with confidence and the source
   snippet. Match an existing contact or leave “create new”. Correct any field,
   then *Confirm & create tenancy*. A property, landlord, tenant, tenancy,
   4 cheques and deadlines appear, and the contract is attached to the tenancy;
   evidence shows FIELD_EXTRACTED → FIELD_CONFIRMED → IMPORT_COMMITTED.
   Repeat with fixture 2 (Bayview): commit raises **MISSING_EJARI** and the
   60-day override puts the notice gate at 01 Sep 2026. (Manual path: `/onboarding/new`
   types the same records without a scan.)
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
   cheque ladders; `/notifications` shows the in-app feed, and `/evidence` shows
   REMINDER_SENT events. (Platform `/admin` is data-blind scalars only — it is
   not a notification log.)
9. **Monthly report** — Clients → Generate for Al Noor Family Office →
   printable report (browser print → PDF) + CSV export; REPORT_GENERATED /
   REPORT_EXPORTED evidence written.
10. **Security suite green** — `pnpm test:integration` (T1.4 cross-workspace
    suite + the rest) and `pnpm test` all green; CI runs the same plus Playwright.

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
7. **Mint the successor tenancy** — with the case AGREED, **Create successor
   tenancy** on the renewal workspace runs `mintRenewedTenancy` in one transaction:
   it carries `renewsFromTenancyId`, the predecessor flips to RENEWED, the case
   flips to RENEWED with `renewedTenancyId` set, and exactly one `RENEWAL_COMPLETED`
   row is written — prior events are *not* back-filled, so the timeline stays
   truthful. Concurrent mints collapse to one successor and the loser gets a clean
   409. (Covered by `renewalWalkthrough.test.ts` and the Playwright renewal journey.)
8. **Evidence + risk timeline** — `/evidence` shows the full chronology with
   strictly-monotonic timestamps (no batch-stamp at mint); `/risk` shows the
   renewal flags raised and cleared by the nightly sweep (`evaluateWorkspaceRisk`,
   invoked by the authenticated `/api/v1/jobs/run` cron).

## Deploy (Vercel)

The repo is serverless-ready: `vercel-build` runs `prisma migrate deploy` before
`next build`, `vercel.json` schedules the daily job pass at 03:00 UTC (07:00
Dubai) against `/api/v1/jobs/run`, and user-facing sends (reset, invite, proof links) flush
the outbox inline with the cron as retry backstop. `pnpm worker` remains the
local-dev runner. Production boots fail closed if required env is missing
(`src/server/config/env.ts`, `scripts/check-deploy-env.mjs`).

| Env var | Value |
| --- | --- |
| `DATABASE_URL` | from the Neon (Vercel marketplace) integration |
| `APP_SECRET` | `openssl rand -hex 32` (≥32 chars in production) |
| `APP_BASE_URL` | `https://<your-domain>` (used in emails + secure links) |
| `EMAIL_PROVIDER` / `RESEND_API_KEY` / `EMAIL_FROM` | `resend` + your key + verified sender |
| `STORAGE_DRIVER` / blob auth | `blob`. Create a **private** Blob store (Project → Storage) and connect it to Production. Auth is `BLOB_READ_WRITE_TOKEN` (static) and/or `BLOB_STORE_ID` (OIDC; `VERCEL_OIDC_TOKEN` is runtime-only and must not be required at build) |
| `CRON_SECRET` | `openssl rand -hex 32` (auth for the cron route) |
| `SEED_API_ENABLED` | leave unset. Only set to `true` while bootstrapping via `POST /api/v1/jobs/seed`, then unset — the route is default-deny on this flag *and* `CRON_SECRET` |
| `SEED_ON_DEPLOY` / `SEED_ADMIN_EMAIL` | optional bootstrap; the email is seated as **workspace admin**, not FIDUCIARY |
| `SEED_DEMO_PASSWORD` | optional; production seed does not set a shared password unless this is set |
| `EXTRACTION_PROVIDER` | `mock`, or `gemini` + `GEMINI_API_KEY`, or `anthropic` + `ANTHROPIC_API_KEY` |
| `WHATSAPP_PROVIDER` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_VERIFY_TOKEN` / `WHATSAPP_APP_SECRET` | optional. Unset = console no-op. All five required to go live (`docs/whatsapp-readiness.md`) |

After the first deploy, seed once from any machine:
`DATABASE_URL=<neon-url> APP_BASE_URL=<https-url> pnpm db:seed` — idempotent, and
it prints the live member logins and link-party URLs.

Two alternatives to running it from your own machine, both default-deny:

- `SEED_ON_DEPLOY=true` runs the same idempotent seed during `vercel-build`. In
  production the build log deliberately withholds the proof-upload link (it is a
  live bearer credential and build logs are a passive record) — open it from the
  proof request in the app instead.
- `POST /api/v1/jobs/seed` with `Authorization: Bearer $CRON_SECRET` runs it
  inside the deployment, so no database credential leaves the project. It
  requires `SEED_API_ENABLED=true` **as well as** the secret; unset the flag once
  you are done.

**Storage:** the Vercel Blob store is **private**. Create it under Storage, set
access to Private, and connect Production (and Preview if you use it). The SDK
authenticates with `BLOB_READ_WRITE_TOKEN` or OIDC (`BLOB_STORE_ID` +
`VERCEL_OIDC_TOKEN`). The stored url is not publicly fetchable; client downloads go
exclusively through the signed, logged `/api/v1/files` route with the SHA-256
re-verified. An S3/Supabase driver remains an optional alternative behind the same
`StorageDriver` interface.

## Non-goals (1A)

No marketplace/listings/brokerage flows, no payment processing or custody (the
payments/DDS rail is the future **Phase 2** — Seneschal stays record-keeping
only), no legal advice, no contractor dispatch, no anomaly AI. WhatsApp delivery
is wired but **off by default** — the Meta Cloud API adapter ships behind the
`notify()` gateway and stays a console no-op until `WHATSAPP_PROVIDER=meta` plus
credentials are set; the remaining work is ops/approvals, not code (see
`docs/whatsapp-readiness.md`). (The **Stage 2 renewal engine** is
built and migrated — it is no longer a non-goal; see the renewal acceptance
walkthrough above.)

## Stage 1B hooks &amp; terminology

`TODO` markers only: maintenance UI (schema live — `MaintenanceCase` / `Quote` /
`Invoice`; no `/maintenance` routes; reserved risk codes above have no raise
path). WhatsApp is no longer a hook — the Meta Cloud API adapter and
signature-verifying webhook (`src/app/api/v1/webhooks/whatsapp/route.ts`) are
implemented and tested; going live is an ops/approval step, not a code swap. The
**Stage 2 renewal engine is built and migrated** — RenewalCase,
RentIndexCapture, Offer and Notice ship across the renewal migrations, with the
full service layer in `src/server/services/renewals.ts` and the loop proven by
the integration suite (`tests/integration/renewal*.test.ts`).

**Terminology:** "Stage 2 / S2" is the renewal engine (shipped). **"Phase 2" is
reserved for the future payments/DDS rail** (still a non-goal — Seneschal never
holds funds) and must not be read as the Stage-2 renewal work.

## Documentation map

| Note | What it is |
| --- | --- |
| `docs/architect-vs-workspace-admin.md` | Member vs link-party, licences, seats, data-blind platform admin |
| `docs/renewal-loop.md` | Stage 2 renewal implementation map |
| `docs/trust-references.md` | Relational FKs vs polymorphic `scopeId` strings |
| `docs/whatsapp-readiness.md` | WhatsApp adapter status + ops checklist |
| `QUARANTINE.md` | Passport + listings fail-closed (out of product scope) |
| `CLAUDE.md` | Agent working notes (design language, non-negotiables) |
