# Architect vs Workspace-Admin — reconciling the brief with the as-built system

An early brief imagined a platform **"Architect"** who could **act-as** customer
workspaces and **switch between the four workspace-type views** to "see the
different layouts." The system was deliberately built the other way. This note
records the reconciliation so the question is not re-litigated, and — more
importantly — pins the **member-vs-link-party boundary** that decides who gets an
account and who acts through a link.

## 1. The brief's assumptions vs the as-built reality

| Brief assumed | As built | Where |
| --- | --- | --- |
| An Architect can **act-as** a workspace and read its data | The platform admin is **data-blind by construction** — holds **no membership**, so no `AuthzContext` can be built for any workspace; the type barrier makes a `PlatformAdminContext` un-passable to a data service (compile error) | `provisioning.ts`, `auth/request.ts:81`, `platformStats.ts`, `tests/integration/platformPlane.test.ts` |
| Switching `workspace.type` swaps the UI "layout" | `workspace.type` drives **zero** UI; navigation is **role-driven** via `homePathFor` | `auth/request.ts:69`, `(app)/layout.tsx`, `(portal)/…` |
| There is a break-glass / impersonation rail | Every cross-workspace data read and the act-as rail were **removed** and are asserted gone | `tests/integration/platformPlane.test.ts:43` |

Provisioning makes the blindness concrete: `provisionWorkspace` creates an empty
workspace, seats the customer's first user as `WORKSPACE_ADMIN`, issues a hashed
invite, and **sets no credential** — "I can't see their data" is true the moment
the operator touches it. The platform console reads `platformStats` **scalars
only** (counts, statuses, timestamps — never a named row), and the admin module
graph is forbidden from importing any confidential service (`tests/unit/adminAllowlist.test.ts`).

So "see the different layouts" does not mean a type switcher. It means: **sign in
(or open a link) as each access model.** The demo seed makes every one reachable.

## 2. Member vs link-party — and why

Both planes are real and intentional. A **member** is a `User` + `Membership`
(an account, a role, a workspace scope). A **link-party** is a `Contact` reached
through a `SecureLink` token — **no account** — acting as e.g. `TENANT_LINK`.
The decision of which an actor should be is **not** "who uploads the document."
It is:

> **A USER/member ⇔ a recurring orchestration relationship** (a self-managing
> landlord, a fiduciary, operations staff).
> **A link-party (no account) ⇔ an episodic counterparty whose own attestation
> *is* the evidence** (a tenant, always; an absentee landlord, for approvals).
>
> The deciders are **relationship cardinality** (recurring vs one-shot) and
> **provenance** (does the evidence's worth come from *that party* attesting it).

**Why provenance is load-bearing.** Seneschal exists to remove the weak-evidence
trap. If the landlord uploads the tenant's documents, the evidence actor is the
landlord — self-attestation. If the **tenant** accepts terms or uploads their own
ID through a `TENANT_LINK`, the `EvidenceEvent` actor *is* the tenant, bound to
the request and a timestamp: **independent provenance, stronger evidence, and no
account to provision.** Promoting a tenant to a `User` would also quietly rebuild
the (deliberately dead) Tenant Passport and add login friction for a one-shot
counterparty. So the tenant is a link-party — not because it's convenient, but
because it produces *better evidence*.

### The mapping this produces

| Actor | Model | Identity | Surface |
| --- | --- | --- | --- |
| Fiduciary (Farina), staff, operator roles | **member (USER)** | `User` + `Membership(role)` | `/dashboard` · `/members` · `/admin` |
| Self-managing landlord | **member (persona)** | `Membership(LANDLORD)` + `subjectContactId` | `/portal` |
| Absentee landlord (managed) | **member (passive) + link** | `Membership(CLIENT_VIEWER)` + `clientPrincipalId` **and** an `APPROVAL` link | `/dashboard` + link |
| Tenant (always) | **link-party** | `Contact(TENANT)` + `TENANT_OFFER` / `PROOF_UPLOAD` link, acts `TENANT_LINK` | `/link/[token]` |

`TENANT` remains a value in the `Role` enum — it still types capabilities/scope
and the `/portal` persona code still compiles — but the demo **never seats a
tenant as a member**. That is the boundary in practice, not a migration.

### Dual-plane carve-out (so the rule doesn't read as self-contradicting)

The rule classifies a **relationship**, not a person, and one party can hold two.
The **absentee landlord** is *both* a recurring **`CLIENT_VIEWER`** membership
(a passive portfolio view) **and** an episodic **`APPROVAL`** link (occasional
sign-offs); a **`VENDOR`** is member-or-link depending on the engagement. The
planes **compose** — they are not mutually exclusive. Answer each question
independently: *"recurring orchestration?"* → seat a member; *"episodic
attestation whose worth is this party's signature?"* → mint a link. The absentee
landlord's `APPROVAL` link is the model's second plane: the public `/link`
handler (`ApprovalForm` → `decideApprovalViaLink`) is live, and the seed mints
the Marina offer sign-off link so both planes are reachable.

**Routing footnote.** `isPersonaRole` is exactly `TENANT | LANDLORD`
(`authz.ts:53`), so `CLIENT_VIEWER` is **not** a persona and `homePathFor` routes
it to `/dashboard` (`auth/request.ts:69-74`), not `/portal`. What makes the
absentee landlord's view "passive" is its **read-only/scoped capability set**, not
the route.

## 3. How you reach every view — seed, not type switcher

`runSeed` (`src/server/seed.ts`) builds the access-model gallery in a FIDUCIARY
workspace and three further per-type shells (`OWNER` / `OPERATOR` / `INTERNAL`):

- **Orchestrator members**, one per *recurring* role, seeded by iterating the
  capability matrix (`ROLE_CAPABILITIES`) so a newly-added `Role` can't be
  silently omitted. The builder (`SEED_ADMIN_EMAIL`) is the gallery's sole
  `WORKSPACE_ADMIN`; Farina is the `FIDUCIARY` orchestrator.
- **Self-managing landlord** — `LANDLORD` persona (`owner@example.com`, `/portal`).
- **Absentee landlord** — `CLIENT_VIEWER` (`absentee-owner@example.com`) plus an
  episodic `APPROVAL` sign-off link (printed by the seed as “Absentee owner
  sign-off”). Open `/link/<token>` with no account to approve or decline.
- **Tenant** — **no account**: a `Contact` plus `TENANT_OFFER` and `PROOF_UPLOAD`
  links. The demo "tenant view" is the `/link/[token]` surface.

The CLI (`prisma/seed.ts`) prints three blocks — workspaces, member logins (with
their landing route), and link-party URLs. Dev password is `seneschal-dev` unless
`SEED_DEMO_PASSWORD` is set. `SEED_ADMIN_EMAIL` (or `operator@example.com` in
dev) is the gallery's `WORKSPACE_ADMIN`, not a FIDUCIARY seat.

In-org surfaces: `/members` (invite by seat) and `/members/assignments` (one
responsible `MANAGING_AGENT` per property). Workspace admin is not invited
from here.

## 4. Gaps closed alongside this note

| Gap | Resolution |
| --- | --- |
| Seed seated the tenant as a persona member, contradicting the boundary | Tenant reseeded as a link-party; orchestrators seeded by enum-iteration; absentee landlord = `CLIENT_VIEWER` plus a live `APPROVAL` link; builder = sole `WORKSPACE_ADMIN` (`seed.ts`, `tests/integration/seed.test.ts`) |
| Reset URL / secure-link token persisted readably (`NotificationMessage.bodyRef`, retained `Outbox.payload`) | Sensitive templates store a redacted placeholder; the live body rides the outbox payload to the adapter and is **stripped on the terminal flip**; delivery **fails closed** if the body is absent (`notify/*`, `outbox/index.ts`, `tests/integration/notifySensitive.test.ts`) |
| Archive was one-way | `unarchiveWorkspace` + action + console button; round-trip re-opens authz and the daily sweep (`provisioning.ts`, `(staff)/admin/*`) |
| Handler re-gate and member-power edges untested | `requirePlatformAdmin` 403 at the handler; data-only members rejected on `inviteOrgAdmin`/`grantBundle`; the data-blind leak-check extended to named customer rows (`tests/integration/platformAdminGate.test.ts`, `members.test.ts`, `platformPlane.test.ts`) |

## 5. Two licences, and who may invite an owner

Workspace.type is a **licence**, not a layout switch. The platform provisions two:

| Licence | `Workspace.type` | Who the principal is | Owner invite from `/members` |
| --- | --- | --- | --- |
| **Landlord** | `OWNER` | Self-managing owner of this book. Seat-zero `WORKSPACE_ADMIN`. | **No.** They already are the owner. |
| **Fiduciary** | `FIDUCIARY` | Office principal. Seat-zero `WORKSPACE_ADMIN`. They invite staff, agents, and client owners. | **Yes** — `LANDLORD` + `subjectContactId` bound to a live `Contact(kind=OWNER)`. |

`OPERATOR` and `INTERNAL` remain **demo shells** in the seed so every historical type is reachable. They are not provisionable licences (`provisionWorkspace` refuses them).

**Seats invited by email** (never the Role enum on the members surface):

- Office admin → `ORG_ADMIN`
- Staff → `MANAGER` (FIDUCIARY is not a second invite seat)
- Agent → `MANAGING_AGENT` (empty book signs in)
- Owner → `LANDLORD` + OWNER contact — **fiduciary workspaces only**

Workspace admin is **seat-zero** (provisioning). It is not invited from `/members`. Tenants stay link-parties. There is no custom role editor and no platform act-as.

A landlord licence does not grow a second "owner" seat: the principal runs the book. A fiduciary invites a client owner so that person lands on `/portal`, scoped to the contact they act as. Vacant sibling units of a client the office serves stay invisible to that owner until those units are recorded against their contact.

## Out of scope (deliberately)

- Migrating tenants/landlords to link-only in the **schema** (removing enum
  values, reworking `/portal` auth) — unnecessary; the intent lives in the seed
  and this note.
- A workspace-type **layout switcher** or any act-as rail — they contradict the
  data-blind design. Provision copy differs by licence; in-app navigation stays
  role-driven via `homePathFor`.
