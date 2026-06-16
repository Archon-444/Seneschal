import type { SVGProps } from "react";
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
}

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/onboarding/new", label: "Onboard tenancy", icon: "onboard" },
  { href: "/properties", label: "Properties", icon: "properties" },
  { href: "/clients", label: "Clients", icon: "clients" },
  { href: "/contacts", label: "Contacts", icon: "contacts" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/renewals", label: "Renewals", icon: "renewals" },
  { href: "/payments", label: "Payments", icon: "payments" },
  { href: "/vault", label: "Document vault", icon: "vault" },
  { href: "/imports", label: "Import & extract", icon: "imports" },
  { href: "/proofs", label: "Proof requests", icon: "proofs" },
  { href: "/enquiries", label: "Enquiries", icon: "contacts" },
  { href: "/evidence", label: "Evidence", icon: "evidence" },
  { href: "/risk", label: "Risk flags", icon: "risk" },
  { href: "/reports", label: "Reports", icon: "reports" },
];

// Persona rails (F0b). One honest entry each: the self-service surface is a single
// scoped home for now. Stage 1B/2B add their own pages and grow these.
export const TENANT_NAV: NavItem[] = [
  { href: "/portal", label: "Home", icon: "dashboard" },
  { href: "/portal/passport", label: "Rental passport", icon: "contacts" },
];
export const LANDLORD_NAV: NavItem[] = [
  { href: "/portal", label: "Home", icon: "dashboard" },
  { href: "/portal/listings", label: "Listings", icon: "properties" },
];
