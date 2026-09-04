# Seneschal — working notes for coding agents

Dubai real-estate portfolio-oversight & tenancy-evidence platform.
Next.js 15 (App Router, server components) · TypeScript · Prisma 6 · PostgreSQL · Tailwind v4 · deployed on Vercel.

## Design language (modern ERP register — not a marketing site, not a generic dashboard)

Calm, dense, document-grade. Think NetSuite / Odoo 17 / Fiori Horizon, not a SaaS landing page.
Use the **`frontend-design`** skill (`.claude/skills/frontend-design`) when building or reshaping UI, and
check the result against the rules below before shipping.

- **Fonts** (`next/font`, self-hosted): one sans, Public Sans, for everything; IBM Plex Mono for money & dates
  (`.figure`). There is no display serif. Money and dates are **always** mono.
- **Palette** (Tailwind `@theme` tokens in `src/app/globals.css`):
  - Surfaces: `ivory-50` (app bg, near-neutral) · `ivory-100` (table heads, hover, inputs) · `white` (panels) · `line` (hairlines)
  - Ink: `navy-900` (primary, sidebar, primary button) · `navy-700` / `navy-500` (secondary) · `muted` (labels, captions)
  - Semantic: `verde` = good · `amber` = in-progress/warn · `claret` = risk/danger
  - `gold` is the brand mark and the keyboard focus ring **only**. Never a text colour, tint, or panel accent.
- **Shape**: 1px borders, 4px radii (`rounded`), **no shadows** except floating layers (menus, dialogs, toasts).
  No eyebrows, no letter-spaced uppercase labels, no pills — status is a small square chip (`Badge`), filters are a
  `Segmented` control, figures sit in a `StatStrip`, tables are 34px single-line rows inside a `Panel`.
- **Copy**: page subtitles are facts (a count, a date range, a reference), never taglines. Legal or scope notes go
  in a `Footnote`, not a card.
- **Reuse the kit** in `src/components/ui.tsx` (`PageHeader`, `Panel`, `StatStrip`/`Stat`, `Segmented`, `Card`,
  `Badge`, `Table`/`Td`, `Money`, `Field`, `inputClass`, `SearchForm`, `Footnote`…) and `formatDubaiDate` /
  `todayInDubai` from `src/server/calculators/dates.ts`. Don't hand-roll a second money or date formatter.

## Engineering non-negotiables (the parts that actually have to be right)

- **Authz**: every service fn takes `AuthzContext`; gate with `require_(ctx, capability)` and filter with `scope(ctx)`. No Prisma from `src/app` (ESLint). Writers live under `src/server` (services, auth, audit, evidence, outbox, notify, admin, seed). CLIENT_VIEWER is scoped to one client — for scope-polymorphic tables use `resolveClientScopeIds` (see `listDeadlines` / `listRenewalPipeline`). Capability matrix is the single source of truth (`src/server/capabilities.ts`); update its test when you add one.
- **Seats**: invite from `/members` by seat (Office admin / Staff / Agent / Owner), never by Role enum or capability bundle. Owner seats (`LANDLORD` + OWNER contact) exist only on FIDUCIARY workspaces. Agent books are `PropertyAssignment` rows (one responsible `MANAGING_AGENT` per property); empty book is a valid login. Additive grants honor only `ORG_ADMIN`.
- **Evidence & audit are insert-only**: write via `recordEvidence` / `recordAudit` only (corrections are new events via `supersedesId`). Never write `EvidenceEvent`/`AuditEvent` directly.
- **Payments are record-keeping only** — Seneschal never holds funds. Say so in payment UI.
- **Dates are date-only, reasoned in Asia/Dubai** (UTC+4, no DST): store UTC midnight via `toUtcDateOnly`; never `new Date()`-compare contract dates. Calculators carry `{rule, version, inputs}` so every derived row cites its math (`dates.ts`, `rent.ts`).
- **Secure links**: raw token returned once; only the hash is stored; never log tokens. Public token routes live under `src/app/link/[token]`.
- **Auth**: email + password for Users (scrypt hash; hashed `Session` cookie). Invite-accept and forgot-password set the hash. Tenants stay on SecureLink — they never get a password. Never log passwords or raw reset tokens.

## Dev workflow

- Develop on the assigned feature branch → commit → **PR to `main`** → CI green → merge. Never push to `main` directly.
- Local tests need Postgres: `service postgresql start`, then run with `DATABASE_URL=postgresql://seneschal:seneschal@localhost:5432/seneschal_test`. Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- Migrations: `pnpm exec prisma migrate dev --name <name>` (prod runs `migrate deploy` in `vercel-build`).

## A caution

A design skill makes screens *look* right — which is seductive because Seneschal's risky parts are invisible: client scoping, evidence integrity, the OCR review gate, consent records. Use `frontend-design` for polish, but the **acceptance walkthrough and the integration/security suite are what tell you it works**. A pretty proof-upload page is not proof the consent record and evidence event actually wrote — confirm that.

## gstack (optional review tooling)

[gstack](https://github.com/garrytan/gstack) is an external, MIT-licensed Claude Code skill pack. We adopt only its **review-and-safety** subset here — not its full opinionated workflow, and **not** its browsing-routing rule (we keep our own browser/MCP tooling). The skills below are available **only if** gstack is installed in `~/.claude/skills/gstack` (prerequisite: Bun v1.0+, then `git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup`). If they don't resolve, gstack isn't installed — skip them, don't guess.

- `/review` — production-bug-focused code review of a diff.
- `/codex` — second-opinion review via an alternate model.
- `/investigate` — root-cause a bug or failing test before changing code.
- `/careful` — extra-rigorous mode for high-stakes edits (use around authz, evidence/audit, and secure-link code per the non-negotiables above).
- `/freeze` — snapshot/guard known-good state before a risky change.

These complement, not replace, the Seneschal gates (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`) and the integration/security suite.
