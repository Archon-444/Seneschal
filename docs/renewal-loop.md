# Stage 2 renewal loop — implementation map

One-page map of the broker-free renewal orchestration loop (#60). Seneschal
records, orchestrates, and proves. It does not broker, hold funds, or adjudicate.

Target loop: **verified landlord → renewal assessment → Decree-43 / index capture
→ notice / offer → tenant acknowledgement → renewed tenancy + evidence pack.**

## As-built path

| Step | Who | Surface | Service | Evidence |
| --- | --- | --- | --- | --- |
| 1. Open assessment | member with `renewals.write` | `/renewals/[tenancyId]` → Open renewal case | `openRenewalCase` | `RENEWAL_ASSESSMENT_CREATED` |
| 2. Capture index | `renewals.write` | Decree-43 card | `captureRentIndex` | `INDEX_CAPTURED` |
| 3. Serve notice | generate → approve → serve | Notice card | `notice.ts` | `NOTICE_GENERATED` → `NOTICE_APPROVED` → `NOTICE_SERVED` |
| 4. Propose terms | `renewals.write` | Terms tab | `proposeOffer` | `OFFER_PROPOSED` |
| 5. Send to tenant | `renewals.write` | Send to tenant | `sendOfferToTenant` | mints `TENANT_OFFER` link |
| 6. Tenant responds | link-party, no account | `/link/<token>` | `respondToOfferViaLink` | `TENANT_ACKNOWLEDGED` → `OFFER_ACCEPTED` (or `OFFER_COUNTERED`) |
| 7. Absentee owner sign-off (when used) | `APPROVAL` link | `/link/<token>` `ApprovalForm` | `decideApprovalViaLink` | approval evidence on the offer |
| 8. Mint successor | `renewals.decide` | **Create successor tenancy** | `mintRenewedTenancy` | exactly one `RENEWAL_COMPLETED` |

Automated proof: `tests/integration/renewalWalkthrough.test.ts`,
`renewalStage2.test.ts`, `renewalConcurrency.test.ts`, and
`e2e/renewals/walkthrough.spec.ts`. Demo seed: one landlord, one Marina
property, one tenancy, one tenant contact, one renewal case, plus live
`TENANT_OFFER` / `APPROVAL` / `PROOF_UPLOAD` links printed by `pnpm db:seed`.

The README “Stage 2 renewal acceptance walkthrough” is the operator script for
the same loop.

## Landlord-authority model (as built — not a new product decision)

#60 asked what counts as authority to initiate or propose a renewal. The engine
shipped against the member-vs-link-party boundary in
`docs/architect-vs-workspace-admin.md`. This is the as-built answer, not a
change to it.

| Question | As built |
| --- | --- |
| What is authority? | A **workspace membership** with `renewals.write` / `renewals.decide`, scoped by `AuthzContext`. There is no separate “landlord mandate” aggregate. |
| Verified ownership? | `Contact.verifiedAt` + append-only `LANDLORD_VERIFIED` (`src/server/services/landlords.ts`). Used as a listing badge / fact. **Not a gate** on `openRenewalCase`, `proposeOffer`, or `mintRenewedTenancy`. |
| Delegated portfolio authority? | `MANAGING_AGENT` via live `PropertyAssignment` rows (`delegateScope.ts`). The delegate may prepare inside the assigned property book. |
| Signed landlord mandate? | Episodic **`APPROVAL` secure link** to the absentee owner (`decideApprovalViaLink`). Optional on an offer; the seed demonstrates it. Not required before opening an assessment. |
| Can an operator prepare without proven authority? | **Yes.** `openRenewalCase` only checks `renewals.write` and tenancy scope. Serving notice, proposing, and minting are further capability / case-state checks, not a verified-landlord check. |
| Minimum pilot-safe proof for one landlord / one property / one tenancy? | Seed path: OWNER contact on the tenancy (`landlordContactId` / `ownerContactId`), fiduciary or manager membership to run the loop, tenant as `TENANT_OFFER` link-party. Optional: verify the OWNER contact; optional: mint an `APPROVAL` link for absentee sign-off. |

Making verification or an `APPROVAL` decision a **hard precondition** of
opening a case or proposing terms would be a new product rule. It is listed
below rather than encoded here.

## What can stay manual in the first pilot

- Capturing the DLD Smart Rental Index figure (an operator types the source
  reference; Seneschal does not scrape DLD).
- Physical service of notice (the app records method, delivery reference, and
  proof document).
- WhatsApp delivery (built, off by default — ops/approvals, not code).
- Landlord verification and absentee `APPROVAL` — available, not mandatory.

## Follow-ups (not blocking a one-landlord demo)

1. **Product:** should `LANDLORD_VERIFIED` or a completed `APPROVAL` be required
   before `openRenewalCase` / `proposeOffer` / `mintRenewedTenancy`? Today they
   are not.
2. Maintenance UI, WhatsApp inbound proof, and the payments/DDS rail remain
   out of this loop (schema-only, ops, and Phase 2 non-goal respectively).

## Files

- Engine: `src/server/services/renewals.ts`, `notice.ts`, `approvals.ts`,
  `renewalNextAction.ts`, `renewalWorkspace.ts`
- UI: `src/app/(app)/renewals/`, `src/app/link/[token]/`
- Calculators: `src/server/calculators/rent.ts` (`decree_43_v1`)
- Authority primitives: `src/server/authz.ts`, `landlords.ts`, `delegateScope.ts`
