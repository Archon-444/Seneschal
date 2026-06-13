import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import {
  createManualDeadline,
  deadlineLabel,
  listDeadlines,
  setDeadlineStatus,
} from "@/server/services/deadlines";
import * as clients from "@/server/services/clients";
import * as properties from "@/server/services/properties";

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Calendar WS");
});

describe("manual calendar entries (T3.3)", () => {
  it("a standalone manual entry (no tenancy) appears in the calendar", async () => {
    const d = await createManualDeadline(W.ctx, {
      title: "Service charge due",
      dueAt: new Date("2026-07-01"),
    });
    expect(d.kind).toBe("CUSTOM");

    const list = await listDeadlines(W.ctx);
    const found = list.find((x) => x.id === d.id);
    expect(found).toBeTruthy(); // was previously filtered out by the required tenancy join
    expect(deadlineLabel(found!)).toBe("Service charge due");

    const audit = await prisma.auditEvent.findFirst({
      where: { verb: "deadline.create", objectId: d.id },
    });
    expect(audit).toBeTruthy();
  });

  it("mark-done removes it from the open list and is audited", async () => {
    const d = await createManualDeadline(W.ctx, { title: "One-off", dueAt: new Date("2026-07-01") });
    await setDeadlineStatus(W.ctx, d.id, "DONE");
    expect((await listDeadlines(W.ctx)).find((x) => x.id === d.id)).toBeUndefined();
    expect(
      await prisma.auditEvent.findFirst({ where: { verb: "deadline.complete", objectId: d.id } }),
    ).toBeTruthy();
  });

  it("a property-scoped manual entry is visible to that client's viewer; a workspace one is not", async () => {
    const client = await clients.createClient(W.ctx, { displayName: "Al Noor" });
    const property = await properties.createProperty(W.ctx, {
      clientPrincipalId: client.id,
      community: "Dubai Marina",
      unitNo: "1204",
    });
    const scoped = await createManualDeadline(W.ctx, {
      title: "Property inspection",
      dueAt: new Date("2026-07-01"),
      propertyId: property.id,
    });
    const workspaceWide = await createManualDeadline(W.ctx, {
      title: "Workspace memo",
      dueAt: new Date("2026-07-02"),
    });

    const viewer = await addMember(W.workspaceId, "CLIENT_VIEWER", client.id);
    const seen = (await listDeadlines(viewer.ctx)).map((d) => d.id);
    expect(seen).toContain(scoped.id);
    expect(seen).not.toContain(workspaceWide.id);
  });

  it("refuses to complete a tenancy/Ejari-derived deadline (would resurrect on regen)", async () => {
    const derived = await prisma.deadline.create({
      data: {
        workspaceId: W.workspaceId,
        kind: "CONTRACT_EXPIRY",
        dueAt: new Date("2026-07-01"),
        status: "OPEN",
        computedFrom: { rule: "contract_expiry_v1" },
      },
    });
    await expect(setDeadlineStatus(W.ctx, derived.id, "DONE")).rejects.toThrow();
    const still = await prisma.deadline.findUnique({ where: { id: derived.id } });
    expect(still?.status).toBe("OPEN");
  });

  it("rejects a tenancy/property from another workspace", async () => {
    const other = await makeWorkspace("Other", { type: "OWNER" });
    const p = await properties.createProperty(other.ctx, { community: "X", unitNo: "1" });
    await expect(
      createManualDeadline(W.ctx, { title: "x", dueAt: new Date("2026-07-01"), propertyId: p.id }),
    ).rejects.toThrow();
  });
});
