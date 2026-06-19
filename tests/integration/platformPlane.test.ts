import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, resetDb, prisma } from "../helpers";
import { platformStats } from "@/server/admin/platformStats";
import {
  authz,
  require_,
  type AuthzContext,
  type PlatformAdminContext,
} from "@/server/authz";
import * as admin from "@/server/services/admin";
import { getTenancy } from "@/server/services/tenancies";

// F-Admin §8 — platform-plane teardown (Phase 0.5). ⛔ release-gating.
// The platform operator provisions/bills/reads aggregate health and NEVER reaches a row.

// ── Type-level barrier (§5): a PlatformAdminContext is not a data-service argument.
// This function is never called; tsc checks its body, and the @ts-expect-error asserts
// the call is a COMPILE error. Delete the type split and this directive goes unused → red.
async function _typeBarrier(p: PlatformAdminContext) {
  // @ts-expect-error PlatformAdminContext must not be assignable to AuthzContext
  await getTenancy(p, "any-id");
}
void _typeBarrier;

describe("platform plane is data-blind by construction", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a platform admin holds no membership, so no readable context can be built (§8.2)", async () => {
    const ws = await makeWorkspace("Customer WS");
    const operator = await prisma.user.create({
      data: { email: `op-${Date.now()}@seneschal.example`, name: "Operator", isPlatformAdmin: true },
    });
    await expect(authz(operator.id, ws.workspaceId)).rejects.toThrow(/No access/);
  });

  it("a data service fails closed if a platform context is forced past the type barrier (§8.1)", async () => {
    const forced = { kind: "platform", userId: "op" } as unknown as AuthzContext;
    await expect(getTenancy(forced, "any-id")).rejects.toThrow();
  });

  it("the break-glass rail and every cross-workspace data read are gone (§3.5, §3.3)", () => {
    for (const removed of [
      "staffActAs",
      "staffListWorkspaces",
      "staffListUsers",
      "staffListNotifications",
      "staffListRiskFlags",
      "staffListExtractionQueue",
      "staffAuditStream",
    ]) {
      expect(removed in admin).toBe(false);
    }
  });

  it("isPlatformAdmin is never a capability/scope short-circuit (§2.3)", async () => {
    // A CLIENT_VIEWER who is ALSO flagged isPlatformAdmin must still be denied a write its
    // role lacks — the flag tags audit rows, it never widens what the verb may do.
    const ws = await makeWorkspace("Scoped WS");
    const client = await prisma.clientPrincipal.create({
      data: { workspaceId: ws.workspaceId, displayName: "Client A" },
    });
    const viewer = await prisma.user.create({
      data: { email: `v-${Date.now()}@test.example`, name: "Viewer", isPlatformAdmin: true },
    });
    await prisma.membership.create({
      data: { workspaceId: ws.workspaceId, userId: viewer.id, role: "CLIENT_VIEWER", clientPrincipalId: client.id },
    });
    const ctx = await authz(viewer.id, ws.workspaceId);
    expect(ctx.isStaff).toBe(true); // the audit-label flag is set…
    expect(() => require_(ctx, "tenancies.read")).not.toThrow(); // …read is the role's, allowed
    expect(() => require_(ctx, "tenancies.write")).toThrow(/lacks/); // …but the flag grants nothing
  });

  it("platformStats returns scalars only — no member email or named row leaks (§3.3, §8.3)", async () => {
    const ws = await makeWorkspace("Acme Holdings");
    const secret = `secret-member-${Date.now()}@example.test`;
    const member = await prisma.user.create({ data: { email: secret, name: "Hidden Member" } });
    await prisma.membership.create({
      data: { workspaceId: ws.workspaceId, userId: member.id, role: "MANAGER" },
    });

    // Named CUSTOMER rows that platformStats aggregates over (it counts properties; tenants are
    // contacts on tenancies). Their names are exactly what would leak if someone "enriched" the
    // console with row data — so assert the behavioral leak-check covers them, not just the email.
    const buildingName = "Sentinel-Heights-Tower";
    const tenantName = "Sentinel-Tenant-Name";
    await prisma.property.create({
      data: { workspaceId: ws.workspaceId, community: "Sentinel Marina", building: buildingName, unitNo: "9999" },
    });
    await prisma.contact.create({
      data: { workspaceId: ws.workspaceId, kind: "TENANT", name: tenantName },
    });

    const operatorCtx: PlatformAdminContext = { kind: "platform", userId: "op" };
    const stats = await platformStats(operatorCtx);
    const acme = stats.find((s) => s.name === "Acme Holdings");

    expect(acme).toBeTruthy();
    expect(acme!.seatsUsed).toBe(2); // makeWorkspace owner + the added member, counted, never named
    // The fixed scalar shape — no nested user/email/row object can hide here.
    expect(Object.keys(acme!).sort()).toEqual([
      "archived",
      "documents",
      "lastActivityAt",
      "name",
      "notifications",
      "openProofRequests",
      "openRiskFlags",
      "properties",
      "seatsUsed",
      "subscriptionStatus",
      "suspended",
      "tenanciesByStatus",
      "type",
      "workspaceId",
    ]);
    // The decisive behavioral check: the member's email is nowhere in the payload…
    expect(JSON.stringify(stats)).not.toContain(secret);
    // …and neither is any named customer row (building, tenant) it merely counts.
    expect(JSON.stringify(stats)).not.toContain(buildingName);
    expect(JSON.stringify(stats)).not.toContain(tenantName);
  });
});
