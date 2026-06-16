import type { Role } from "@prisma/client";

// Role × capability map (T1.3) — the spec §3 access matrix as a code table.
// Frontend filtering is never enforcement; this table is.

export const CAPABILITIES = [
  "workspace.manage",
  "members.manage",
  "clients.read",
  "clients.write",
  "contacts.read",
  "contacts.write",
  "properties.read",
  "properties.write",
  "listings.read",
  "listings.write",
  "listings.publish",
  "landlords.verify",
  "tenancies.read",
  "tenancies.write",
  "payments.read",
  "payments.write",
  "deadlines.read",
  "deadlines.write",
  "renewals.read",
  "renewals.write",
  "renewals.decide",
  "documents.read",
  "documents.write",
  "imports.manage",
  "proofs.read",
  "proofs.write",
  "proofs.decide",
  "passport.read",
  "passport.write",
  "passport.share",
  "enquiries.read",
  "enquiries.write",
  "evidence.read",
  "riskflags.read",
  "riskflags.ack",
  "reports.generate",
  "reports.read",
  "notifications.read",
  "messaging.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL = [...CAPABILITIES] as Capability[];

const READ_PORTFOLIO: Capability[] = [
  "clients.read",
  "contacts.read",
  "properties.read",
  "tenancies.read",
  "payments.read",
  "deadlines.read",
  "renewals.read",
  "documents.read",
  "proofs.read",
  "evidence.read",
  "riskflags.read",
  "reports.read",
];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  WORKSPACE_ADMIN: ALL,
  FIDUCIARY: ALL.filter((c) => c !== "workspace.manage" && c !== "members.manage"),
  MANAGER: [
    ...READ_PORTFOLIO,
    "clients.write",
    "contacts.write",
    "properties.write",
    "listings.read",
    "listings.write",
    "listings.publish",
    "landlords.verify",
    "tenancies.write",
    "payments.write",
    "deadlines.write",
    "renewals.write",
    "renewals.decide",
    "documents.write",
    "imports.manage",
    "proofs.write",
    "proofs.decide",
    "passport.read",
    "enquiries.read",
    "enquiries.write",
    "riskflags.ack",
    "reports.generate",
    "notifications.read",
    "messaging.manage",
  ],
  // CLIENT_VIEWER is additionally scoped to a single ClientPrincipal in authz.
  CLIENT_VIEWER: READ_PORTFOLIO,
  AGENT: [
    "contacts.read",
    "properties.read",
    "tenancies.read",
    "deadlines.read",
    "renewals.read",
    "proofs.read",
    "documents.read",
  ],
  LICENSED_PARTNER: [
    "properties.read",
    "tenancies.read",
    "deadlines.read",
    "renewals.read",
    "proofs.read",
    "proofs.write",
    "documents.read",
    "documents.write",
  ],
  VENDOR: ["proofs.read", "documents.write"],
  AUDITOR: [...READ_PORTFOLIO, "notifications.read"],
  // Self-service personas, each additionally scoped to ONE Contact in authz via
  // Membership.subjectContactId (see services/contactScope.ts). F0a grants only
  // the read capabilities whose service paths are contact-scoped and tested here;
  // offers.* / renewals.* arrive with their authenticated services in Stage 2.
  TENANT: [
    "tenancies.read",
    "payments.read",
    "deadlines.read",
    "documents.read",
    "proofs.read",
    "passport.read",
    "passport.write",
    "passport.share",
  ],
  LANDLORD: [
    "properties.read",
    "listings.read",
    "listings.write",
    "listings.publish",
    "tenancies.read",
    "payments.read",
    "deadlines.read",
    "documents.read",
    "proofs.read",
  ],
};

export function roleHas(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
