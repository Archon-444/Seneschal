import { PrismaClient, type Role } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { contextFromMembership, type AuthzContext } from "@/server/authz";

export const prisma = new PrismaClient();

/** Wipe all rows between tests (test DB only). */
export async function resetDb() {
  // Order matters only for FK'd tables; raw TRUNCATE cascades.
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations')
      LOOP EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE'; END LOOP;
    END $$;
  `);
}

export interface TestActor {
  ctx: AuthzContext;
  userId: string;
  workspaceId: string;
}

export async function makeWorkspace(
  name: string,
  opts?: {
    type?: "OWNER" | "FIDUCIARY" | "OPERATOR";
    role?: Role;
    clientPrincipalId?: string;
    subjectContactId?: string;
  },
): Promise<TestActor> {
  const workspace = await prisma.workspace.create({
    data: { name, type: opts?.type ?? "FIDUCIARY" },
  });
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@test.example`, name: `${name} user` },
  });
  const membership = await prisma.membership.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: opts?.role ?? "FIDUCIARY",
      clientPrincipalId: opts?.clientPrincipalId ?? null,
      subjectContactId: opts?.subjectContactId ?? null,
    },
  });
  return {
    ctx: contextFromMembership(user, membership),
    userId: user.id,
    workspaceId: workspace.id,
  };
}

/** Add another member to an existing workspace. */
export async function addMember(
  workspaceId: string,
  role: Role,
  clientPrincipalId?: string,
  subjectContactId?: string,
  assignedClientIds?: string[],
): Promise<TestActor> {
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@test.example`, name: "member" },
  });
  const membership = await prisma.membership.create({
    data: {
      workspaceId,
      userId: user.id,
      role,
      clientPrincipalId: clientPrincipalId ?? null,
      subjectContactId: subjectContactId ?? null,
      assignedClientIds: assignedClientIds ?? [],
    },
  });
  return { ctx: contextFromMembership(user, membership), userId: user.id, workspaceId };
}

/** Add a MANAGING_AGENT (execution delegate) scoped to a set of ClientPrincipals. */
export async function makeDelegate(workspaceId: string, assignedClientIds: string[]): Promise<TestActor> {
  return addMember(workspaceId, "MANAGING_AGENT", undefined, undefined, assignedClientIds);
}
