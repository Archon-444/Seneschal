import type { SVGProps } from "react";

// Hand-drawn stroke icons for the shell chrome and nav rail — a bespoke house set
// (not a third-party pack) drawn in one hand so it stays document-grade. 1.5px stroke
// matches the hairline aesthetic; the nav glyphs favour distinct silhouettes so they
// stay legible at 18px in the collapsed rail's vertical stack.

function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const BellIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </Icon>
);

export const ChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
);

export const GearIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);

export const SignOutIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
    <path d="M10 17 5 12l5-5M5 12h12" />
  </Icon>
);

export const UserIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20a8 8 0 0 1 16 0" />
  </Icon>
);

export const MenuIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const CheckAllIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="m2 13 4 4 8-9" />
    <path d="m12 16 1 1 9-10" />
  </Icon>
);

export const PanelLeftIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Icon>
);

// — Nav rail glyphs — one distinct silhouette per destination —

export const DashboardIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1" />
    <rect x="13" y="4" width="7" height="7" rx="1" />
    <rect x="4" y="13" width="7" height="7" rx="1" />
    <rect x="13" y="13" width="7" height="7" rx="1" />
  </Icon>
);

// Onboarding: arrow stepping in through a doorway (door on the right is the silhouette).
export const OnboardIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
    <path d="M4 12h9" />
    <path d="M9 8l4 4-4 4" />
  </Icon>
);

// Properties: a tower with a lower annex and lit windows — Dubai skyline shorthand.
export const PropertiesIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="5" y="3" width="9" height="17" rx="1" />
    <path d="M14 8h5v12h-5" />
    <path d="M8 7v0M11 7v0M8 11v0M11 11v0M8 15v0M11 15v0" />
    <path d="M3 20h18" />
  </Icon>
);

export const ClientsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M3 13h18" />
  </Icon>
);

// Contacts: an address card — avatar on the left, detail lines on the right.
export const ContactsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="11" r="2" />
    <path d="M6 16a3 3 0 0 1 6 0" />
    <path d="M15 10h3M15 13h3" />
  </Icon>
);

export const CalendarIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 9h16" />
    <path d="M8 3v4M16 3v4" />
    <path d="M8 13v0M12 13v0M16 13v0M8 16v0M12 16v0" />
  </Icon>
);

// Renewals: a closed cycle of two arrows (the loop, not a lone arrow).
export const RenewalsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M20 11a8 8 0 0 0-14-4L4 9" />
    <path d="M4 13a8 8 0 0 0 14 4l2-2" />
    <path d="M4 5v4h4M20 19v-4h-4" />
  </Icon>
);

export const PaymentsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 9v0M18 15v0" />
  </Icon>
);

// Document vault: a safe door with a combination dial — distinct from the doc glyphs.
export const VaultIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="12" cy="12" r="4" />
    <path d="M12 12l2-2" />
    <path d="M12 8v1M12 15v1M8 12h1M15 12h1" />
  </Icon>
);

// Import & extract: an arrow dropping into an open tray (the tray base is the silhouette).
export const ImportsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    <path d="M12 4v9" />
    <path d="M8 9l4 4 4-4" />
  </Icon>
);

// Proof requests: a clipboard (clip at top) with a check.
export const ProofsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="5" y="5" width="14" height="16" rx="2" />
    <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M9 13l2 2 4-4" />
  </Icon>
);

// Evidence: a certified seal/rosette with ribbon tails — not a rectangle.
export const EvidenceIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="12" cy="9" r="5" />
    <path d="M9 13l-2 7 5-3 5 3-2-7" />
    <path d="M10 9l1.5 1.5L14 8" />
  </Icon>
);

export const RiskIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 3v18" />
    <path d="M6 4h10l-2 3 2 3H6" />
  </Icon>
);

// Reports: a folded-corner page with bars — distinct from clipboard/seal.
export const ReportsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v4h4" />
    <path d="M9 17v-3M12 17v-5M15 17v-2" />
  </Icon>
);

export const StaffIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2" />
    <circle cx="16" cy="7" r="2" />
    <path d="M4 12h2M10 12h10" />
    <circle cx="8" cy="12" r="2" />
    <path d="M4 17h12M20 17h0" />
    <circle cx="18" cy="17" r="2" />
  </Icon>
);
