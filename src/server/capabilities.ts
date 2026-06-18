import type { Bundle, Role } from "@prisma/client";

// Role × capability map (T1.3) — the spec §3 access matrix as a code table.
// Frontend filtering is never enforcement; this table is.
//
// F-Admin (D1): data capabilities answer "may this verb exist for this user at all"; scope
// answers "which rows". Capabilities are resolved as roleMap(role) ∪ expand(grants) — never
// from ROLE_RANK or isStaff (see authz.ts assertCapability). ORG_ADMIN is the decorrelated
// shape: people/config power, zero data.

export const CAPABILITIES = [
  // people / configuration (F-Admin §2.1) — people-power, no data
  "workspace.manage",
  "workspace.configure",
  "members.read",
  "members.invite",
  "members.manage",
  "clients.assign",
  // data
  "clients.read",
  "clients.write",
  "contacts.read",
  "contacts.write",
  "properties.read",
  "properties.write",
  "listings.read",
  "listings.write",
  "listings.publish",
  "offers.read",
  "offers.write",
  "offers.decide",
  "offers.respond",
  "contracts.read",
  "contracts.write",
  "movein.read",
  "movein.write",
  "movein.acknowledge",
  "landlords.verify",
  "tenancies.read",
  "tenancies.write",
  "tenancies.upload",
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
  "viewings.read",
  "viewings.write",
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

// People/config power — the decorrelated set. A DATA role (e.g. FIDUCIARY) must NOT gain
// these just because it holds "all data": granting staff and reconfiguring the workspace is
// a different axis (F-Admin §2). Only WORKSPACE_ADMIN (PRINCIPAL) and ORG_ADMIN hold them.
const PEOPLE_ADMIN: Capability[] = [
  "workspace.manage",
  "workspace.configure",
  "members.read",
  "members.invite",
  "members.manage",
  "clients.assign",
];

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

// ORG_ADMIN (F-Admin §2.2): members + assignment + workspace config, and NOTHING else. No
// workspace.manage (the heavier WORKSPACE_ADMIN cap), no data. This is the office manager.
const ORG_ADMIN_CAPS: Capability[] = [
  "workspace.configure",
  "members.read",
  "members.invite",
  "members.manage",
  "clients.assign",
];

// Execution delegate (F0d): read + broad operational WRITE, every path confined to
// Membership.assignedClientIds (AuthzContext.delegateClientIds) — see services/delegateScope.ts.
// NOT the fiduciary-control caps (proofs.decide), the roster (clients.*), members/workspace
// admin, renewals.decide, landlords.verify, or cross-client reports.* — simply not granted.
const DELEGATE_CAPS: Capability[] = [
  "contacts.read",
  "properties.read",
  "properties.write",
  "tenancies.read",
  "tenancies.write",
  "tenancies.upload",
  "payments.read",
  "payments.write",
  "deadlines.read",
  "deadlines.write",
  "renewals.read",
  "documents.read",
  "documents.write",
  "proofs.read",
  "proofs.write",
];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  // PRINCIPAL: see-all-do-all within the workspace (data + people/config).
  WORKSPACE_ADMIN: ALL,
  // Data-power principal: every DATA cap, but NOT people/config (decorrelated — F-Admin §2).
  FIDUCIARY: ALL.filter((c) => !PEOPLE_ADMIN.includes(c)),
  // Decorrelated people-admin: people/config only, zero data (F-Admin §2.2).
  ORG_ADMIN: ORG_ADMIN_CAPS,
  MANAGER: [
    ...READ_PORTFOLIO,
    "clients.write",
    "contacts.write",
    "properties.write",
    "listings.read",
    "listings.write",
    "listings.publish",
    "offers.read",
    "offers.write",
    "offers.decide",
    "contracts.read",
    "contracts.write",
    "movein.read",
    "movein.write",
    "movein.acknowledge",
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
    "viewings.read",
    "viewings.write",
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
  MANAGING_AGENT: DELEGATE_CAPS,
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
    "tenancies.upload",
    "payments.read",
    "deadlines.read",
    "documents.read",
    "proofs.read",
    "offers.read",
    "offers.respond",
    "passport.read",
    "passport.write",
    "passport.share",
    "movein.read",
    "movein.acknowledge",
  ],
  LANDLORD: [
    "properties.read",
    "listings.read",
    "listings.write",
    "listings.publish",
    "offers.read",
    "offers.write",
    "offers.decide",
    "contracts.read",
    "contracts.write",
    "movein.read",
    "movein.acknowledge",
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

// F-Admin (D1): grantable bundles, unioned OVER the role map. A membership holds a SET of
// bundles ({} for every existing membership on deploy → effective caps unchanged). PRINCIPAL
// is the full in-org grant; ORG_ADMIN/DELEGATE/CLIENT_VIEWER mirror their role cap sets so an
// additive grant ("org-admin who is ALSO a delegate") needs no migration.
export const BUNDLE_CAPABILITIES: Record<Bundle, Capability[]> = {
  PRINCIPAL: ALL,
  ORG_ADMIN: ORG_ADMIN_CAPS,
  DELEGATE: DELEGATE_CAPS,
  CLIENT_VIEWER: READ_PORTFOLIO,
};

export function bundleHas(bundle: Bundle, capability: Capability): boolean {
  return BUNDLE_CAPABILITIES[bundle].includes(capability);
}

// Platform-plane capabilities (F-Admin §2.1) — reserved now so later splits are config, not
// migration. NOT part of the in-org Capability union: the operator plane runs under
// PlatformAdminContext and is gated by isPlatformAdmin, never by require_(ctx, …).
export const PLATFORM_CAPABILITIES = [
  "platform.workspaces.manage",
  "platform.entitlements.manage",
  "platform.invites.issue",
  "platform.stats.read",
] as const;

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];
