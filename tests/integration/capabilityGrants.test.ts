import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { authz, hasCapability, require_, rolePrecedence } from "@/server/authz";
import {
  BUNDLE_CAPABILITIES,
  CAPABILITIES,
  GRANT_HONORED_BUNDLES,
  PEOPLE_ADMIN,
  ROLE_CAPABILITIES,
} from "@/server/capabilities";
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

  it("a granted ORG_ADMIN overlay adds EXACTLY its caps to the base role's — the union, nothing more", async () => {
    const { userId, membershipId } = await seat("AGENT");
    await grant(membershipId, "ORG_ADMIN"); // an agent who ALSO runs onboarding
    const ctx = await authz(userId, W.workspaceId);

    expect(ctx.grantedBundles).toEqual(["ORG_ADMIN"]);
    const expected = new Set<string>([...ROLE_CAPABILITIES.AGENT, ...BUNDLE_CAPABILITIES.ORG_ADMIN]);
    for (const cap of CAPABILITIES) {
      expect(hasCapability(ctx, cap)).toBe(expected.has(cap));
    }
    // Concretely: keeps the agent's reads, gains people-power, gains neither's exclusions.
    expect(hasCapability(ctx, "tenancies.read")).toBe(true); // role (AGENT reads)
    expect(hasCapability(ctx, "members.manage")).toBe(true); // bundle (people-power)
    expect(hasCapability(ctx, "tenancies.write")).toBe(false); // in neither set
    expect(hasCapability(ctx, "payments.read")).toBe(false); // in neither set
  });

  it("a REVOKED grant contributes nothing — the live-only read filters it out", async () => {
    const { userId, membershipId } = await seat("AGENT");
    const g = await grant(membershipId, "ORG_ADMIN");

    let ctx = await authz(userId, W.workspaceId);
    expect(() => require_(ctx, "members.manage")).not.toThrow(); // granted → allowed

    await prisma.membershipGrant.update({
      where: { id: g.id },
      data: { revokedAt: new Date(), revokedById: W.userId },
    });

    ctx = await authz(userId, W.workspaceId);
    expect(ctx.grantedBundles).toEqual([]); // revoked grant is not loaded
    expect(() => require_(ctx, "members.manage")).toThrow(/lacks/); // back to deny
  });

  it("the partial unique allows re-granting a revoked bundle (no collision)", async () => {
    const { membershipId } = await seat("AGENT");
    const g = await grant(membershipId, "ORG_ADMIN");
    await prisma.membershipGrant.update({ where: { id: g.id }, data: { revokedAt: new Date() } });
    // Re-granting the same (membership, bundle) must NOT violate uniqueness once the old row is revoked.
    await expect(grant(membershipId, "ORG_ADMIN")).resolves.toBeTruthy();
  });

  // ── Closure 1: the read-layer backstop. The grant union honors only people-power; a DATA-bundle
  // grant from ANY path is inert, so the capability∪scope seam can't leak even if issuance is bypassed.
  it("a forged DATA-bundle grant is INERT — honored set excludes it, no data cap leaks (⛔)", async () => {
    // Bypass the members.ts issuance guard entirely by writing the grant rows directly.
    const { userId, membershipId } = await seat("ORG_ADMIN");
    for (const bundle of ["DELEGATE", "PRINCIPAL", "CLIENT_VIEWER"] as const) {
      await grant(membershipId, bundle);
    }
    const ctx = await authz(userId, W.workspaceId);

    expect(ctx.grantedBundles).toEqual([]); // the resolver never loads a non-honored bundle…
    for (const cap of ["tenancies.read", "tenancies.write", "documents.read", "payments.read", "clients.read", "evidence.read"] as const) {
      expect(hasCapability(ctx, cap)).toBe(false); // …so not one data cap is conferred
    }
    // The rows really are in the DB — this is inertness at resolution, not a failed insert.
    expect(await prisma.membershipGrant.count({ where: { membershipId } })).toBe(3);
  });

  // The premise BEHIND the inert filter: the honored set must be data-free. This fails the moment
  // someone adds a data bundle to GRANT_HONORED_BUNDLES (the future re-opener), regardless of how
  // they justify "fixing" the inert test by honoring the bundle. Guards the premise, not the filter.
  it("every honored grant bundle is DATA-FREE (the premise guard) (⛔)", () => {
    // (a) Honored caps are people/config — cross-checks two INDEPENDENT literals (PEOPLE_ADMIN and
    //     each bundle's expansion), so it is not trivially true: it goes red if a honored bundle's
    //     expansion gains a cap PEOPLE_ADMIN doesn't list.
    for (const bundle of GRANT_HONORED_BUNDLES) {
      for (const cap of BUNDLE_CAPABILITIES[bundle]) {
        expect(PEOPLE_ADMIN).toContain(cap);
      }
    }
    // (b) AND anchor "data-free" on the actual data sets a data role/bundle confers (CLIENT_VIEWER
    //     reads, DELEGATE read+write) — independent of PEOPLE_ADMIN, so the guard can't be hollowed
    //     by quietly adding a confidential-data cap to PEOPLE_ADMIN itself.
    const dataCaps = new Set<string>([...ROLE_CAPABILITIES.CLIENT_VIEWER, ...BUNDLE_CAPABILITIES.DELEGATE]);
    for (const cap of PEOPLE_ADMIN) {
      expect(dataCaps.has(cap)).toBe(false);
    }
  });
});
