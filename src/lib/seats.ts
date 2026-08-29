import type { Role, WorkspaceType } from "@prisma/client";

/** Seats the members screen may invite by email. Workspace admin is seat-zero
 *  (provisioning), not invited here. Owner (LANDLORD + OWNER contact) is
 *  agency/fiduciary only. Staff is MANAGER — FIDUCIARY is not a second invite
 *  seat. Agent is MANAGING_AGENT. */
export const INVITEABLE_SEATS = ["ORG_ADMIN", "MANAGER", "MANAGING_AGENT", "LANDLORD"] as const;
export type InviteableSeat = (typeof INVITEABLE_SEATS)[number];

export function isInviteableSeat(role: string): role is InviteableSeat {
  return (INVITEABLE_SEATS as readonly string[]).includes(role);
}

/** Owner seats bind to an OWNER contact and exist only on a fiduciary workspace. */
export function inviteableSeatsFor(workspaceType: WorkspaceType): InviteableSeat[] {
  if (workspaceType === "FIDUCIARY") return [...INVITEABLE_SEATS];
  return INVITEABLE_SEATS.filter((seat) => seat !== "LANDLORD");
}

/** English seat names — never show the Role enum on the members surface. */
export const ROLE_SEAT_LABEL: Record<Role, string> = {
  WORKSPACE_ADMIN: "Workspace admin",
  ORG_ADMIN: "Office admin",
  MANAGER: "Staff",
  FIDUCIARY: "Fiduciary",
  MANAGING_AGENT: "Agent",
  AGENT: "Agent",
  CLIENT_VIEWER: "Client viewer",
  AUDITOR: "Auditor",
  LANDLORD: "Owner",
  TENANT: "Tenant",
  LICENSED_PARTNER: "Licensed partner",
  VENDOR: "Vendor",
};

export const INVITE_SEAT_COPY: { role: InviteableSeat; label: string; hint: string }[] = [
  {
    role: "ORG_ADMIN",
    label: ROLE_SEAT_LABEL.ORG_ADMIN,
    hint: "Members and assignments. Cannot open a tenancy.",
  },
  {
    role: "MANAGER",
    label: ROLE_SEAT_LABEL.MANAGER,
    hint: "Day-to-day portfolio work.",
  },
  {
    role: "MANAGING_AGENT",
    label: ROLE_SEAT_LABEL.MANAGING_AGENT,
    hint: "Assign them to properties after they join. An empty book signs in to empty lists.",
  },
  {
    role: "LANDLORD",
    label: ROLE_SEAT_LABEL.LANDLORD,
    hint: "A client owner. Pick the OWNER contact they act as. Agency workspaces only.",
  },
];

export function inviteSeatCopyFor(workspaceType: WorkspaceType) {
  const allowed = new Set(inviteableSeatsFor(workspaceType));
  return INVITE_SEAT_COPY.filter((seat) => allowed.has(seat.role));
}

export function memberSeatLabel(role: Role, overlayOfficeAdmin: boolean): string {
  const base = ROLE_SEAT_LABEL[role];
  if (overlayOfficeAdmin && role !== "ORG_ADMIN") return `${base} · office admin`;
  return base;
}

/** OWNER contacts shown on the members invite form (agency workspaces). */
export type OwnerInviteContact = {
  id: string;
  name: string;
  email: string | null;
  taken: boolean;
};
