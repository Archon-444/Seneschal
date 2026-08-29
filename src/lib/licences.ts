import type { WorkspaceType } from "@prisma/client";

/** Licences the platform may provision. OPERATOR and INTERNAL remain demo
 *  shells in the seed; they are not sold. */
export const PROVISIONABLE_LICENCES = ["FIDUCIARY", "OWNER"] as const;
export type ProvisionableLicence = (typeof PROVISIONABLE_LICENCES)[number];

export function isProvisionableLicence(type: string): type is ProvisionableLicence {
  return (PROVISIONABLE_LICENCES as readonly string[]).includes(type);
}

/** English names for workspace.type — Landlord is the OWNER licence. */
export const LICENCE_LABEL: Record<WorkspaceType, string> = {
  OWNER: "Landlord",
  FIDUCIARY: "Fiduciary",
  OPERATOR: "Operator",
  INTERNAL: "Internal",
};

export const LICENCE_COPY: Record<
  ProvisionableLicence,
  { label: string; kicker: string; body: string; principalLabel: string; principalHint: string }
> = {
  FIDUCIARY: {
    label: "Fiduciary",
    kicker: "Family office or agency",
    body: "The principal administers the office. They invite staff, agents, and client owners. An owner seat is bound to an OWNER contact.",
    principalLabel: "Office principal",
    principalHint: "They become workspace admin. They set their own password when they accept.",
  },
  OWNER: {
    label: "Landlord",
    kicker: "Self-managing owner",
    body: "The principal is the owner of this book. They run the workspace. Client-owner invites are not a seat on this licence — they already are the owner.",
    principalLabel: "Owner",
    principalHint: "They become workspace admin of their own book. They set their own password when they accept.",
  },
};
