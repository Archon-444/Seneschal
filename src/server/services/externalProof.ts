import type { SecureLink } from "@prisma/client";
import { prisma } from "../db";

/** Public-page read: only the fields an external party may see. */
export async function getProofRequestForLink(link: SecureLink) {
  if (link.purpose !== "PROOF_UPLOAD" || link.scopeType !== "PROOF_REQUEST") return null;
  const request = await prisma.proofRequest.findUnique({ where: { id: link.scopeId } });
  if (!request || request.workspaceId !== link.workspaceId) return null;
  return { title: request.title, requiredEvidence: request.requiredEvidence, dueAt: request.dueAt };
}
