import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { authz, hasCapability, require_, rolePrecedence } from "@/server/authz";
import { BUNDLE_CAPABILITIES, CAPABILITIES, ROLE_CAPABILITIES } from "@/server/capabilities";
import type { Bundle, Role } from "@prisma/client";

// F-Admin Phase 1 (D1) — the decorrelated capability foundation. ⛔ release-gating.
// Effective caps = roleMap(role) ∪ expand(live grants); rank never grants data.

let W: TestActor;

async function seat(role: Role): Promise<{ userId: string; membershipId: string }> {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@t.test`, name: "m" } });
  const m = await prisma.membership.create({ data: { workspaceId: W.workspaceId, userId: user.id, role } });
  return { userId: user.id, membershipId: m.id };
}

function grant(membershipId: string, bundle: Bundle) {
  return prisma.membershipGrant.create({
    data: { membershipId, bundle, grantedById: W.userId },
  });
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Capabilities WS");
});

describe("capability resolution (roleMap ∪ grants)", () => {
  it("ORG_ADMIN holds people-power and is denied every data verb (§8.4)", async () => {
    const { userId } = await seat("ORG_ADMIN");
    const ctx = await authz(userId, W.workspaceId);

    expect(hasCapability(ctx, "members.manage")).toBe(true);
    expect(hasCapability(ctx, "clients.assign")).toBe(true);
    expect(() => require_(ctx, "tenancies.read")).toThrow(/lacks/);
    expect(() => require_(ctx, "documents.read")).toThrow(/lacks/);
    expect(() => require_(ctx, "evidence.read")).toThrow(/lacks/);
    expect(() => require_(ctx, "payments.read")).toThrow(/lacks/);
  });

  it("rank never grants data: a more-senior ORG_ADMIN is denied a read a junior CLIENT_VIEWER gets (§8.5)", async () => {
    // ORG_ADMIN outranks CLIENT_VIEWER (lower precedence number = more senior)…
    expect(rolePrecedence("ORG_ADMIN")).toBeLessThan(rolePrecedence("CLIENT_VIEWER"));

    const admin = await seat("ORG_ADMIN");
    const client = await prisma.clientPrincipal.create({
      data: { workspaceId: W.workspaceId, displayName: "Client A" },
    });
    const viewerUser = await prisma.user.create({ data: { email: `${randomUUID()}@t.test`, name: "v" } });
    await prisma.membership.create({
      data: { workspaceId: W.workspaceId, userId: viewerUser.id, role: "CLIENT_VIEWER", clientPrincipalId: client.id },
    });

    const adminCtx = await authz(admin.userId, W.workspaceId);
    const viewerCtx = await authz(viewerUser.id, W.workspaceId);

    // …yet the junior reads and the senior does not. Seniority is not a data input.
    expect(() => require_(viewerCtx, "tenancies.read")).not.toThrow();
    expect(() => require_(adminCtx, "tenancies.read")).toThrow(/lacks/);
  });

  it("empty grants ⇒ parity: effective caps equal the role map exactly (§8.13)", async () => {
    const { userId } = await seat("FIDUCIARY");
    const ctx = await authz(userId, W.workspaceId);
    expect(ctx.grantedBundles).toEqual([]);
    for (const cap of CAPABILITIES) {
      expect(hasCapability(ctx, cap)).toBe(ROLE_CAPABILITIES.FIDUCIARY.includes(cap));
    }
  });

  it("a granted bundle adds EXACTLY its caps to the role's — the union, nothing more", async () => {
    const { userId, membershipId } = await seat("ORG_ADMIN");
    await grant(membershipId, "DELEGATE"); // org-admin who is ALSO a senior delegate
    const ctx = await authz(userId, W.workspaceId);

    expect(ctx.grantedBundles).toEqual(["DELEGATE"]);
    const expected = new Set<string>([...ROLE_CAPABILITIES.ORG_ADMIN, ...BUNDLE_CAPABILITIES.DELEGATE]);
    for (const cap of CAPABILITIES) {
      expect(hasCapability(ctx, cap)).toBe(expected.has(cap));
    }
    // Concretely: keeps people-power, gains delegate data, gains neither's exclusions.
    expect(hasCapability(ctx, "members.manage")).toBe(true); // role
    expect(hasCapability(ctx, "tenancies.write")).toBe(true); // bundle
    expect(hasCapability(ctx, "proofs.decide")).toBe(false); // in neither set
    expect(hasCapability(ctx, "clients.read")).toBe(false); // in neither set
  });

  it("a REVOKED grant contributes nothing — the live-only read filters it out", async () => {
    const { userId, membershipId } = await seat("ORG_ADMIN");
    const g = await grant(membershipId, "DELEGATE");

    let ctx = await authz(userId, W.workspaceId);
    expect(() => require_(ctx, "tenancies.read")).not.toThrow(); // granted → allowed

    await prisma.membershipGrant.update({
      where: { id: g.id },
      data: { revokedAt: new Date(), revokedById: W.userId },
    });

    ctx = await authz(userId, W.workspaceId);
    expect(ctx.grantedBundles).toEqual([]); // revoked grant is not loaded
    expect(() => require_(ctx, "tenancies.read")).toThrow(/lacks/); // back to deny
  });

  it("the partial unique allows re-granting a revoked bundle (no collision)", async () => {
    const { membershipId } = await seat("ORG_ADMIN");
    const g = await grant(membershipId, "DELEGATE");
    await prisma.membershipGrant.update({ where: { id: g.id }, data: { revokedAt: new Date() } });
    // Re-granting the same (membership, bundle) must NOT violate uniqueness once the old row is revoked.
    await expect(grant(membershipId, "DELEGATE")).resolves.toBeTruthy();
  });
});
