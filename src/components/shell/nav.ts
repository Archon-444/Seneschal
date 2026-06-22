import type { Role } from "@prisma/client";
import { roleHas, type Capability } from "@/server/capabilities";
import { isQuarantined } from "@/server/config/features";
import type { IconKey } from "./navIcons";

// Pure data/logic for the nav rail — NO JSX, so it imports cleanly into the server layout AND into
// plain unit tests. The glyph registry (NAV_ICONS) lives in ./navIcons; nav items carry a string
// `IconKey` mapped there. Re-exported for the client renderers that import the type from here.
export type { IconKey };

export interface NavItem {
  href: string;
  label: string;
  icon: IconKey;
  /** Capability required to see this item; omitted means always shown to operators. */
  cap?: Capability;
  /** Operator-nav zone. Omitted on persona/create items (rendered flat). */
  zone?: "WORK" | "MANAGE";
  /** WORK tier: `primary` is the always-visible spine; `secondary` sits under "More". */
  tier?: "primary" | "secondary";
}

// The operator rail, zoned. WORK = the renewal lifecycle + the nouns it touches (a ≤7 primary
// spine + a "More" group the Sidebar collapses); MANAGE = decorrelated people-power. Marketplace
// routes (/enquiries, /viewings) are intentionally absent — they are fail-closed server-side
// (the `listings` quarantine) and must not be advertised (see QUARANTINE.md). Creates are NOT
// nav nouns; they live in the header "+ New" menu (CREATE_ACTIONS). Overview keeps a
// portfolio-read cap on purpose: it is the home only for roles whose dashboard resolves —
// dropping the cap would advertise a dead Overview to ORG_ADMIN (people-power, no data).
export const NAV: NavItem[] = [
  // WORK — primary spine (daily)
  { href: "/dashboard", label: "Overview", icon: "dashboard", cap: "properties.read", zone: "WORK", tier: "primary" },
  { href: "/renewals", label: "Renewals", icon: "renewals", cap: "renewals.read", zone: "WORK", tier: "primary" },
  { href: "/properties", label: "Properties", icon: "properties", cap: "properties.read", zone: "WORK", tier: "primary" },
  { href: "/clients", label: "Clients", icon: "clients", cap: "clients.read", zone: "WORK", tier: "primary" },
  { href: "/payments", label: "Payments", icon: "payments", cap: "payments.read", zone: "WORK", tier: "primary" },
  { href: "/evidence", label: "Evidence", icon: "evidence", cap: "evidence.read", zone: "WORK", tier: "primary" },
  // WORK — secondary (under "More"; re-homed under a primary noun in a later ticket)
  { href: "/calendar", label: "Calendar", icon: "calendar", cap: "deadlines.read", zone: "WORK", tier: "secondary" },
  { href: "/risk", label: "Risk flags", icon: "risk", cap: "riskflags.read", zone: "WORK", tier: "secondary" },
  { href: "/proofs", label: "Proof requests", icon: "proofs", cap: "proofs.read", zone: "WORK", tier: "secondary" },
  { href: "/vault", label: "Document vault", icon: "vault", cap: "documents.read", zone: "WORK", tier: "secondary" },
  { href: "/contacts", label: "Contacts", icon: "contacts", cap: "contacts.read", zone: "WORK", tier: "secondary" },
  { href: "/reports", label: "Reports", icon: "reports", cap: "reports.read", zone: "WORK", tier: "secondary" },
  { href: "/imports", label: "Import & extract", icon: "imports", cap: "imports.manage", zone: "WORK", tier: "secondary" },
  // MANAGE — in-org people & access (Assignments folded in on the page, not a top-level item)
  { href: "/members", label: "Members & access", icon: "contacts", cap: "members.read", zone: "MANAGE" },
];

// "+ New" header actions. Creates are actions, not destinations — cap-filtered like NAV. Only
// standalone creates belong here (/tenancies/new needs a property context, so it is excluded).
export const CREATE_ACTIONS: NavItem[] = [
  { href: "/onboarding/new", label: "Onboard tenancy", icon: "onboard", cap: "clients.write" },
  { href: "/properties/new", label: "Property", icon: "properties", cap: "properties.write" },
];

export function createsForRole(role: Role): NavItem[] {
  return CREATE_ACTIONS.filter((item) => !item.cap || roleHas(role, item.cap));
}

/** Operator nav filtered to the role's capabilities — a MANAGING_AGENT delegate sees
 *  only its operational rails (no Clients/Imports/Reports/Enquiries/Viewings/etc.). */
export function navForRole(role: Role): NavItem[] {
  return NAV.filter((item) => !item.cap || roleHas(role, item.cap));
}

// Persona rails (F0b). One honest entry each: the self-service surface is a single
// scoped home for now. Stage 1B/2B add their own pages and grow these.
// Cosmetic layer of the pilot quarantine (see QUARANTINE.md) — hiding the entry
// is not enforcement; the route/middleware/action gates are. Same source of truth.
export const TENANT_NAV: NavItem[] = [
  { href: "/portal", label: "Home", icon: "dashboard" },
  ...(isQuarantined("passport")
    ? []
    : [{ href: "/portal/passport", label: "Rental passport", icon: "contacts" } as NavItem]),
  { href: "/portal/movein", label: "Move-in", icon: "vault" },
];
export const LANDLORD_NAV: NavItem[] = [
  { href: "/portal", label: "Home", icon: "dashboard" },
  ...(isQuarantined("listings")
    ? []
    : [{ href: "/portal/listings", label: "Listings", icon: "properties" } as NavItem]),
  { href: "/portal/movein", label: "Move-in", icon: "vault" },
];
