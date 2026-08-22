# Trust references — relational vs polymorphic

Seneschal stores some ids as Prisma relations with database foreign keys, and
some as bare strings. The split is intentional. This note is the map for #58.

## Relational (enforced)

These columns always point at one table. The database rejects an insert or
update that names a missing row (`P2003`). Parent rows that are still referenced
cannot be hard-deleted (`ON DELETE RESTRICT`); archive them instead.

| Column | Target | Notes |
| --- | --- | --- |
| `Tenancy.propertyId` | `Property` | original schema |
| `Tenancy.renewsFromTenancyId` | `Tenancy` | successor lineage |
| `Tenancy.contractDocId` | `Document` | PR5 / H3; `ON DELETE SET NULL` |
| `Tenancy.landlordContactId` | `Contact` | #58 |
| `Tenancy.tenantContactId` | `Contact` | #58 |
| `Property.clientPrincipalId` | `ClientPrincipal` | #58 |
| `Property.ownerContactId` | `Contact` | #58; LANDLORD persona scope |
| `Property.assignedAgentId` | `Contact` | #58; schema comment is Contact, not User |

`Property.assignedAgentId` is a Contact of kind `AGENT`, not a `User`. The #58
issue listed “if always a User”; the as-built column is a contact, and the FK
follows that.

## Intentionally polymorphic (strings)

These ids are scoped by a companion type enum (`scopeType`, `objectType`,
`kind`). A single column names a tenancy on one row and a proof request on the
next. A foreign key cannot express that, and fabricating one would either lie
or force a table-per-type split the evidence/audit model does not want.

| Column | Companion type | Why it stays a string |
| --- | --- | --- |
| `EvidenceEvent.scopeId` | `scopeType` | append-only ledger across every aggregate |
| `AuditEvent.objectId` | `objectType` | same, for mutations |
| `Document.scopeId` | `scopeType` | a file can hang off workspace / tenancy / proof / … |
| `RiskFlag.scopeId` | `scopeType` | one open flag per code per scope |
| `SecureLink` purpose payload | `purpose` | token names a proof, offer, approval, … |
| `NotificationMessage` target | topic / href | delivery, not a trust edge |
| `Deadline.scopeId` | `scopeType` | calculator-owned rows |

Do not add FKs here. Resolve through the type discriminator in the service that
owns the row.

## String columns that are *not* polymorphic (left for later)

These always name a Contact (or similar) but were out of the #58 candidate
list. They remain application-checked:

- `Membership.subjectContactId` — persona membership subject
- `Membership.clientPrincipalId` — CLIENT_VIEWER pin
- `ProofRequest.assignedContactId`
- `MaintenanceCase.tenantContactId`, `Invoice.vendorContactId`, `Quote` vendor

A later migration can follow the same Restrict pattern once those write paths
are confirmed never to land a row before the contact exists.

## Tests

`tests/integration/trustReferenceFks.test.ts` asserts that an orphan id is
rejected (`P2003`) and that seed/fixture data has no dangling trust refs.
