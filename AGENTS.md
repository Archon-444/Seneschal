# AGENTS.md

Project overview, design language and engineering non-negotiables live in
[`CLAUDE.md`](./CLAUDE.md); setup, gates and the acceptance walkthroughs live in
[`README.md`](./README.md). Read those first — this file only records
Cursor-Cloud-specific operational notes that aren't obvious from them.

## Cursor Cloud specific instructions

Single Next.js 15 app (App Router) backed by PostgreSQL 16 via Prisma. There is
one runnable product; the only "extra" process is the outbox worker.

### What the startup update script already does

`pnpm install --frozen-lockfile` runs on boot and refreshes dependencies; its
`postinstall` regenerates the Prisma client. Everything below is **not** in the
update script and must be done per session before running the app or tests.

### Postgres is required and is not auto-started

- Start it each session: `sudo service postgresql start` (the package is
  installed in the base image but the daemon does not auto-start).
- Role/DBs (create once; harmless to skip if they already exist):
  `sudo -u postgres psql -c "CREATE ROLE seneschal LOGIN PASSWORD 'seneschal' CREATEDB;"`
  then `createdb seneschal` and `createdb seneschal_test` owned by that role.
- Connection string used everywhere: `postgresql://seneschal:seneschal@localhost:5432/<db>`.

### Env file

`cp .env.example .env` and set `APP_SECRET` (`openssl rand -hex 32`). The default
`.env.example` values (`EMAIL_PROVIDER=console`, `STORAGE_DRIVER=local`,
`EXTRACTION_PROVIDER=mock`) are the correct local-dev choices — no external API
keys are needed to run or test the full flow.

### Database prep before running / testing

- Apply migrations to **both** DBs: `pnpm exec prisma migrate deploy` (dev) and
  the same with `DATABASE_URL=…/seneschal_test` (tests). The Vitest global-setup
  also runs `prisma migrate deploy` against the test DB, but the role/DB must
  already exist.
- `pnpm db:seed` (idempotent) populates the demo workspace and prints login
  emails plus live `/link/<token>` URLs. `pnpm fixtures:render` writes the
  fixture PDFs the OCR/import harness reads.
- Do **not** commit the files written by `pnpm fixtures:render` — the PDFs have
  non-deterministic metadata and show up as spurious diffs; `git checkout --
  fixtures/pdf/` to discard them.

### Running the app

- `pnpm dev` (app on :3000) and, in a separate terminal, `pnpm worker` (outbox +
  daily jobs). Run both — the worker is what dispatches emails/reminders.
- Auth is email-OTP with `EMAIL_PROVIDER=console`: the 6-digit code is **printed
  to the log of whichever process flushes the outbox**. In dev the `pnpm dev`
  server flushes immediately on request, so grab the code from the dev-server
  output (not the worker). Seeded logins include `operator@example.com`
  (WORKSPACE_ADMIN → `/dashboard`).

### Gates

Run exactly what CI runs (`.github/workflows/ci.yml`):
`pnpm lint && pnpm scope-audit && pnpm typecheck && pnpm test && pnpm build`.
`pnpm test` needs `seneschal_test` migrated and reachable.
