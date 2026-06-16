import type { LinkPurpose, ScopeType } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, assertSameWorkspace, require_, scope } from "../authz";
import { generateToken, hashToken } from "../crypto";
import { recordAudit } from "../audit";

// Secure links (T7.2 — release blocking). Raw token returned exactly once at
// creation and embedded in the share URL; only the hash is stored. Tokens
// never appear in logs.

const DEFAULT_TTL_DAYS = 14;

export async function createSecureLink(
  ctx: AuthzContext,
  args: {
    purpose: LinkPurpose;
    scopeType: ScopeType;
    scopeId: string;
    contactId?: string;
    expiresInDays?: number;
    maxUses?: number;
  },
): Promise<{ linkId: string; url: string }> {
  require_(ctx, "proofs.write");
  const { token, tokenHash } = generateToken();
  const link = await prisma.secureLink.create({
    data: {
      workspaceId: ctx.workspaceId,
      purpose: args.purpose,
      scopeType: args.scopeType,
      scopeId: args.scopeId,
      contactId: args.contactId ?? null,
      tokenHash,
      expiresAt: new Date(Date.now() + (args.expiresInDays ?? DEFAULT_TTL_DAYS) * 86_400_000),
      maxUses: args.maxUses ?? null,
      createdById: ctx.userId,
    },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "securelink.create",
    objectType: "SecureLink",
    objectId: link.id,
  });
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return { linkId: link.id, url: `${base}/link/${token}` };
}

export type LinkValidation =
  | { ok: true; link: NonNullable<Awaited<ReturnType<typeof findByToken>>> }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "exhausted" };

function findByToken(token: string) {
  return prisma.secureLink.findUnique({ where: { tokenHash: hashToken(token) } });
}

/** Validate a raw token from a public URL. Safe responses only — no detail leaks. */
export async function validateLinkToken(token: string): Promise<LinkValidation> {
  const link = await findByToken(token);
  if (!link) return { ok: false, reason: "not_found" };
  if (link.revokedAt) return { ok: false, reason: "revoked" };
  if (link.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (link.maxUses != null && link.useCount >= link.maxUses) {
    return { ok: false, reason: "exhausted" };
  }
  return { ok: true, link };
}

export async function consumeLinkUse(linkId: string) {
  await prisma.secureLink.update({
    where: { id: linkId },
    data: { useCount: { increment: 1 } },
  });
}

export async function revokeSecureLink(ctx: AuthzContext, linkId: string) {
  require_(ctx, "proofs.write");
  const link = await prisma.secureLink.findUnique({ where: { id: linkId } });
  assertSameWorkspace(ctx, link);
  const updated = await prisma.secureLink.update({
    where: { id: linkId },
    data: { revokedAt: new Date() },
  });
  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "securelink.revoke",
    objectType: "SecureLink",
    objectId: linkId,
  });
  return updated;
}

export async function listSecureLinks(ctx: AuthzContext, scopeType: ScopeType, scopeId: string) {
  require_(ctx, "proofs.read");
  // scope(ctx) (not a hand-rolled workspaceId) so a persona context fails closed
  // here rather than listing another Contact's secure links by scopeId.
  return prisma.secureLink.findMany({
    where: { ...scope(ctx), scopeType, scopeId },
    orderBy: { createdAt: "desc" },
  });
}
