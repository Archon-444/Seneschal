# Archived: marketplace & passport (out of product scope)

The marketplace loop and the tenant passport are **killed concepts** under the
current product brief — Seneschal is a Dubai real-estate portfolio-oversight and
**tenancy-evidence / renewal** platform, not a marketplace. These features are
**not on the roadmap**. They remain in the tree only because deleting working,
tested code now would add churn during pilot-stability work; they are made
**unreachable and fail-closed**, not maintained and not planned.

Archived (fail-closed, out of scope):

- **`passport`** — the tenant reusable rental profile (`src/server/services/tenantPassport.ts`).
- **`listings`** — the whole marketplace loop: the supply side
  (`src/server/services/listings.ts`), the enquiry path
  (`src/server/services/enquiries.ts`), viewings
  (`src/server/services/viewings.ts`), and the contract-pack
  (`src/server/services/contractPack.ts`) / listing-readiness scoring. This covers
  both the public link flow **and** the operator surfaces (`/enquiries`, `/viewings`).

There is **no plan to revive** these. Any future reintroduction would be a
deliberate, freshly-scoped and re-reviewed product decision — not the execution of
a deferred roadmap. New core (renewal / evidence) code must not take on
dependencies toward these modules; a guardrail test enforces this
(`tests/unit/quarantine-boundary.test.ts`).

## Single source of truth

`src/server/config/features.ts` — `isQuarantined('passport' | 'listings')`,
hardcoded `true` (not env: fail-closed, prod can't be misconfigured *on*).

## What is gated (every reachable handler, fail-closed)

| Surface | Location | Mechanism |
|---|---|---|
| Portal pages | `app/(portal)/portal/passport/`, `.../listings/` segment layouts | `notFound()` at the segment |
| Operator pages | `app/(app)/enquiries/layout.tsx`, `app/(app)/viewings/layout.tsx` | `notFound()` at the segment |
| Edge (defense-in-depth) | `middleware.ts` | 404 on `/portal/passport/*`, `/portal/listings/*`, `/enquiries/*`, `/viewings/*` |
| Public link branches | `app/link/[token]/page.tsx` | `PASSPORT_SHARE` / `LISTING_VIEW` short-circuit to the "no longer available" page **before** consume/data-fetch (held tokens stay dormant, `useCount` untouched) |
| Server actions | `.../passport/actions.ts`, `.../listings/actions.ts`, `submitEnquiryAction` in `app/link/[token]/actions.ts`, and `setEnquiryStatusAction` / `createViewingAction` / `setViewingStatusAction` in `app/(app)/actions.ts` | `assertNotQuarantined()` / error return |
| Nav | `src/components/shell/nav.ts` | marketplace entries (`/enquiries`, `/viewings`) **removed** from `NAV`; persona `passport`/`listings` entries omitted when quarantined |

## What is NOT changed

- Service modules, Prisma models, and the `TENANT_PASSPORT` / `LISTING` scope
  types stay (the persona authz primitive `contactScope.ts` depends on the
  passport model — it is part of the in-scope scoping machinery).
- The service-level integration tests (`tenantPassport`, `passportShare`,
  `passportDocuments`, `listings`, `listingShare`, `listingPermit`) keep
  running and passing — they call the services directly, not the gated
  handlers, so they guard the dormant code for a safe revival. They are **not**
  skipped.
- **H4 (atomic secure-link consume) is deferred on these paths** — a branch that
  never consumes can't have a consume TOCTOU. This is safe **only** while the
  paths stay quarantined and fail-closed: H4 consume-first is a hard prerequisite
  for any revival (see below), not an optional follow-up.

## If these were ever reconsidered (not planned)

Reintroduction is **out of scope and not on the roadmap**. Were it ever revisited
as a new product decision, it would be re-scoped and re-reviewed from scratch — the
notes below only record how the code was made dormant, not a green-light path:

- The flags live in `src/server/config/features.ts` (hardcoded `true`,
  fail-closed — not env-driven, so prod can't be switched on by config).
- Nothing was skipped in the test suite; the dormant code keeps its own tests.
- **Hard prerequisite:** the H4 consume-first fix MUST be applied to
  `getPassportForLink` / `getListingForLink` (and the enquiry path) before these
  link branches consume a token or fetch data. Today they short-circuit *before*
  consume/data-fetch (the table above), so the deferral is safe; the moment any
  revival removes that short-circuit, the consume-first fix has to land in the
  same change — do not un-quarantine without it.
