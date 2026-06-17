import type { SVGProps } from "react";
import type { Role } from "@prisma/client";
import { roleHas, type Capability } from "@/server/capabilities";
import {
  DashboardIcon,
  OnboardIcon,
  PropertiesIcon,
  ClientsIcon,
  ContactsIcon,
  CalendarIcon,
  RenewalsIcon,
  PaymentsIcon,
  VaultIcon,
  ImportsIcon,
  ProofsIcon,
  EvidenceIcon,
  RiskIcon,
  ReportsIcon,
  StaffIcon,
} from "../icons";

// Single source of truth for the nav rail, shared by the server layout (which owns NAV)
// and the client Sidebar (which renders the glyphs). Lives here — not in the "use client"
// Sidebar — so the server side never imports across the client boundary. Glyph components
// can't cross the RSC boundary as props, so nav items carry a string key mapped here.
export const NAV_ICONS = {
  dashboard: DashboardIcon,
  onboard: OnboardIcon,
  properties: PropertiesIcon,
  clients: ClientsIcon,
  contacts: ContactsIcon,
  calendar: CalendarIcon,
  renewals: RenewalsIcon,
  payments: PaymentsIcon,
  vault: VaultIcon,
  imports: ImportsIcon,
  proofs: ProofsIcon,
  evidence: EvidenceIcon,
  risk: RiskIcon,
  reports: ReportsIcon,
  staff: StaffIcon,
} satisfies Record<string, (p: SVGProps<SVGSVGElement>) => React.JSX.Element>;

export type IconKey = keyof typeof NAV_ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: IconKey;
  /** Capability required to see this item; omitted means always shown to operators. */
  cap?: Capability;
}

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", cap: "properties.read" },
  { href: "/onboarding/new", label: "Onboard tenancy", icon: "onboard", cap: "clients.write" },
  { href: "/properties", label: "Properties", icon: "properties", cap: "properties.read" },
  { href: "/clients", label: "Clients", icon: "clients", cap: "clients.read" },
  { href: "/contacts", label: "Contacts", icon: "contacts", cap: "contacts.read" },
  { href: "/calendar", label: "Calendar", icon: "calendar", cap: "deadlines.read" },
  { href: "/renewals", label: "Renewals", icon: "renewals", cap: "renewals.read" },
  { href: "/payments", label: "Payments", icon: "payments", cap: "payments.read" },
  { href: "/vault", label: "Document vault", icon: "vault", cap: "documents.read" },
  { href: "/imports", label: "Import & extract", icon: "imports", cap: "imports.manage" },
  { href: "/proofs", label: "Proof requests", icon: "proofs", cap: "proofs.read" },
  { href: "/enquiries", label: "Enquiries", icon: "contacts", cap: "enquiries.read" },
  { href: "/viewings", label: "Viewings", icon: "calendar", cap: "viewings.read" },
  { href: "/evidence", label: "Evidence", icon: "evidence", cap: "evidence.read" },
  { href: "/risk", label: "Risk flags", icon: "risk", cap: "riskflags.read" },
  { href: "/reports", label: "Reports", icon: "reports", cap: "reports.read" },
];

/** Operator nav filtered to the role's capabilities — a MANAGING_AGENT delegate sees
 *  only its operational rails (no Clients/Imports/Reports/Enquiries/Viewings/etc.). */
export function navForRole(role: Role): NavItem[] {
  return NAV.filter((item) => !item.cap || roleHas(role, item.cap));
}

// Persona rails (F0b). One honest entry each: the self-service surface is a single
// scoped home for now. Stage 1B/2B add their own pages and grow these.
export const TENANT_NAV: NavItem[] = [
  { href: "/portal", label: "Home", icon: "dashboard" },
  { href: "/portal/passport", label: "Rental passport", icon: "contacts" },
  { href: "/portal/movein", label: "Move-in", icon: "vault" },
];
export const LANDLORD_NAV: NavItem[] = [
  { href: "/portal", label: "Home", icon: "dashboard" },
  { href: "/portal/listings", label: "Listings", icon: "properties" },
  { href: "/portal/movein", label: "Move-in", icon: "vault" },
];
