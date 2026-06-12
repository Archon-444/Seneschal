import { prisma } from "../db";
import type { AuthzContext } from "../authz";

export async function getWorkspaceName(ctx: AuthzContext): Promise<string> {
  const ws = await prisma.workspace.findUnique({ where: { id: ctx.workspaceId } });
  return ws?.name ?? "";
}
