# Pilot quarantine

Two live, tested features are **out of scope for the renewal pilot** and have
been made unreachable rather than deleted, so they can be revived later without
re-implementing working code:

- **`passport`** — the tenant reusable rental profile (`src/server/services/tenantPassport.ts`).
- **`listings`** — the marketplace supply side (`src/server/services/listings.ts`),
  and the public enquiry path reached through a listing (`src/server/services/enquiries.ts`).

Both were the deferred Stage-1B/2 marketplace concept. Keeping the code +
tests dormant preserves optionality (the marketplace loop is the next strategic
step) while removing live, out-of-scope attack surface from the pilot.

## Single source of truth

`src/server/config/features.ts` — `isQuarantined('passport' | 'listings')`,
hardcoded `true` (not env: fail-closed, prod can't be misconfigured *on*).

## What is gated (every reachable handler, fail-closed)

| Surface | Location | Mechanism |
|---|---|---|
| Portal pages | `app/(portal)/portal/passport/page.tsx`, `.../listings/page.tsx`, `.../listings/[id]/page.tsx` | `notFound()` at top |
| Edge (defense-in-depth) | `middleware.ts` | 404 on `/portal/passport/*`, `/portal/listings/*` |
| Public link branches | `app/link/[token]/page.tsx` | `PASSPORT_SHARE` / `LISTING_VIEW` short-circuit to the "no longer available" page **before** consume/data-fetch (held tokens stay dormant, `useCount` untouched) |
| Server actions | `.../passport/actions.ts`, `.../listings/actions.ts`, `submitEnquiryAction` in `app/link/[token]/actions.ts` | `assertNotQuarantined()` / error return |
| Nav | `src/components/shell/nav.ts` | entries omitted when quarantined |

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
  never consumes can't have a consume TOCTOU.

## Revival (deliberate, per-module)

1. Flip the relevant flag in `src/server/config/features.ts` to `false`.
2. No test un-skipping needed (nothing was skipped).
3. Apply the H4 consume-first fix to `getPassportForLink` / `getListingForLink`
   (and the enquiry path) before re-exposing them to real data.
4. Confirm nav, routes, and link branches return, then ship.
