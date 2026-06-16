import { Prisma, type TenantPassport } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, require_ } from "../authz";
import { toUtcDateOnly } from "../calculators/dates";

// Tenant passport (1C) — a tenant's reusable rental profile, scoped to their own
// Contact (Membership.subjectContactId). The TENANT persona owns exactly one; the
// fail-closed boundary holds because every read is filtered by `contactId`, never
// scope(ctx) (which throws for a persona). Operators read by id within the workspace.

export interface PassportInput {
  employer?: string | null;
  jobTitle?: string | null;
  monthlyIncome?: number | null;
  nationality?: string | null;
  householdSize?: number | null;
  moveInBy?: Date | null;
  summary?: string | null;
  status?: "DRAFT" | "READY";
}

/** The persona's own Contact id, or throw — passport writes are TENANT-only. */
function tenantContactId(ctx: AuthzContext): string {
  if (ctx.role !== "TENANT" || !ctx.subjectContactId) {
    throw new AuthzError("Only a tenant can manage a passport", 403);
  }
  return ctx.subjectContactId;
}

/** The tenant's passport, created on first access so /passport always resolves. */
export async function getOrCreateMyPassport(ctx: AuthzContext): Promise<TenantPassport> {
  require_(ctx, "passport.read");
  const contactId = tenantContactId(ctx);
  const existing = await prisma.tenantPassport.findUnique({
    where: { workspaceId_contactId: { workspaceId: ctx.workspaceId, contactId } },
  });
  if (existing) return existing;
  return prisma.tenantPassport.create({
    data: { workspaceId: ctx.workspaceId, contactId },
  });
}

export async function updateMyPassport(ctx: AuthzContext, input: PassportInput): Promise<TenantPassport> {
  require_(ctx, "passport.write");
  const contactId = tenantContactId(ctx);
  const passport = await getOrCreateMyPassport(ctx);
  const data: Prisma.TenantPassportUncheckedUpdateInput = {};
  if (input.employer !== undefined) data.employer = input.employer;
  if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle;
  if (input.monthlyIncome !== undefined) {
    data.monthlyIncome = input.monthlyIncome == null ? null : new Prisma.Decimal(input.monthlyIncome);
  }
  if (input.nationality !== undefined) data.nationality = input.nationality;
  if (input.householdSize !== undefined) data.householdSize = input.householdSize;
  if (input.moveInBy !== undefined) data.moveInBy = input.moveInBy == null ? null : toUtcDateOnly(input.moveInBy);
  if (input.summary !== undefined) data.summary = input.summary;
  if (input.status !== undefined) data.status = input.status;
  return prisma.tenantPassport.update({
    where: { workspaceId_contactId: { workspaceId: ctx.workspaceId, contactId } },
    data,
  });
}

/** Read a passport by id, enforcing ownership: a TENANT may only read their own;
 *  operators (passport.read) may read any within their workspace. */
export async function getPassport(ctx: AuthzContext, id: string): Promise<TenantPassport> {
  require_(ctx, "passport.read");
  const passport = await prisma.tenantPassport.findUnique({ where: { id } });
  if (!passport || passport.workspaceId !== ctx.workspaceId) throw new AuthzError("Not found", 404);
  if (ctx.subjectContactId && passport.contactId !== ctx.subjectContactId) {
    throw new AuthzError("Not found", 404);
  }
  return passport;
}
