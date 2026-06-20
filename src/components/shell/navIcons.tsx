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

// Glyph registry for the nav rail. Kept apart from nav.ts (the pure data/logic module) so nav.ts
// stays JSX-free and importable in plain unit tests; nav items carry a string `IconKey` mapped here.
// Glyph components can't cross the RSC boundary as props, hence the string-key indirection.
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
