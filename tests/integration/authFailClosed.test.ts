import { afterEach, describe, expect, it, vi } from "vitest";
import { makeWorkspace, prisma, resetDb } from "../helpers";
import { prisma as dbPrisma } from "@/server/db";
import { authz } from "@/server/authz";
import { resolveCtxFor } from "@/server/auth/request";

// NOTE: authz() reads through the @/server/db client, NOT the helpers' client — so the load
// failure must be injected on dbPrisma (the helpers' client stays real, for setup).

// F-Admin Closure 2 — the async grant/assignment load fails CLOSED. A throwing load denies (no
// context is built), and the requireCtx decision boundary never swallows an infra error into a
// silent switch to a different workspace. Deny-by-absence is only fail-closed if the boundary agrees.

describe("auth fails closed when the scope load throws", () => {
  afterEach(() => vi.restoreAllMocks());

  it("authz() rejects (deny-by-absence) when the assignment load throws", async () => {
    await resetDb();
    const W = await makeWorkspace("Fail-closed WS");
    vi.spyOn(dbPrisma.clientAssignment, "findMany").mockRejectedValueOnce(new Error("db down"));
    // No context is returned → no downstream read can happen.
    await expect(authz(W.userId, W.workspaceId)).rejects.toThrow(/db down/);
  });

  it("resolveCtxFor rethrows an infra error on the preferred workspace — never a silent scope-switch", async () => {
    await resetDb();
    const A = await makeWorkspace("Workspace A");
    // The SAME user also belongs to workspace B — the fallback the old bare-catch would switch to.
    const B = await makeWorkspace("Workspace B");
    await prisma.membership.create({ data: { workspaceId: B.workspaceId, userId: A.userId, role: "MANAGER" } });

    vi.spyOn(dbPrisma.clientAssignment, "findMany").mockRejectedValueOnce(new Error("db down"));

    // Pre-fix this fell through and resolved B's context; post-fix the denial propagates.
    await expect(resolveCtxFor(A.userId, A.workspaceId)).rejects.toThrow(/db down/);
  });

  it("resolveCtxFor still falls through on a genuine AuthzError (preferred workspace inaccessible)", async () => {
    await resetDb();
    const A = await makeWorkspace("Has-access WS");
    const orphan = await makeWorkspace("No-access WS"); // A.user holds no membership here
    // Preferred points at a workspace the user can't access → AuthzError → fall through to A.
    const ctx = await resolveCtxFor(A.userId, orphan.workspaceId);
    expect(ctx.workspaceId).toBe(A.workspaceId);
  });
});
