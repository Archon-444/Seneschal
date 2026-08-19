import path from "node:path";

export const authDir = path.join(process.cwd(), "e2e", ".auth");

export const authState = {
  workspaceAdmin: path.join(authDir, "workspace-admin.json"),
  fiduciary: path.join(authDir, "fiduciary.json"),
  manager: path.join(authDir, "manager.json"),
  agent: path.join(authDir, "agent.json"),
  managingAgent: path.join(authDir, "managing-agent.json"),
  licensedPartner: path.join(authDir, "licensed-partner.json"),
  clientViewer: path.join(authDir, "client-viewer.json"),
  auditor: path.join(authDir, "auditor.json"),
  orgAdmin: path.join(authDir, "org-admin.json"),
  tenant: path.join(authDir, "tenant.json"),
  landlord: path.join(authDir, "landlord.json"),
  platformAdmin: path.join(authDir, "platform-admin.json"),
} as const;

export const manifestPath = path.join(authDir, "manifest.json");

export interface E2EManifest {
  workspaceId: string;
  workflowTenancyId: string;
  sourceMissingTenancyId: string;
  provisionalTenancyId: string;
  pendingEvidenceTenancyId: string;
  awaitingTenantTenancyId: string;
  readyToCompleteTenancyId: string;
  completedTenancyId: string;
  proofRequestId: string;
  links: {
    validProof: string;
    expiredProof: string;
    exhaustedProof: string;
    staleOffer: string;
  };
}
