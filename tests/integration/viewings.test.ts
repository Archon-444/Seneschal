import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as viewings from "@/server/services/viewings";

// 2A #10 — Viewings: operators schedule/track property visits; each schedule and
// completion writes evidence; personas have no viewing surface.

let W: TestActor;
let propertyId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Viewings WS");
  const client = await clients.createClient(W.ctx, { displayName: "Owner Co" });
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: owner.id,
    community: "Dubai Marina",
    unitNo: "101",
  });
  propertyId = property.id;
});

describe("viewings", () => {
  it("schedules a viewing with VIEWING_SCHEDULED evidence", async () => {
    const v = await viewings.createViewing(W.ctx, {
      propertyId,
      prospectName: "Aisha",
      scheduledAt: new Date("2026-07-01T14:30:00Z"),
    });
    expect(v.status).toBe("REQUESTED");
    const ev = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "VIEWING_SCHEDULED" },
    });
    expect(ev).toBeTruthy();
    expect((ev!.payload as { viewingId: string }).viewingId).toBe(v.id);
  });

  it("records VIEWING_COMPLETED only on completion", async () => {
    const v = await viewings.createViewing(W.ctx, { propertyId, scheduledAt: new Date("2026-07-01T14:30:00Z") });
    await viewings.setViewingStatus(W.ctx, v.id, "CONFIRMED");
    expect(await prisma.evidenceEvent.count({ where: { workspaceId: W.workspaceId, type: "VIEWING_COMPLETED" } })).toBe(0);
    const done = await viewings.setViewingStatus(W.ctx, v.id, "COMPLETED");
    expect(done.status).toBe("COMPLETED");
    expect(await prisma.evidenceEvent.count({ where: { workspaceId: W.workspaceId, type: "VIEWING_COMPLETED" } })).toBe(1);
  });

  it("personas have no viewing surface", async () => {
    const tc = await contacts.createContact(W.ctx, { kind: "TENANT", name: "T" });
    const tenant = await addMember(W.workspaceId, "TENANT", undefined, tc.id);
    await expect(viewings.listViewings(tenant.ctx)).rejects.toThrow(/viewings\.read/);
  });

  it("rejects an invalid scheduledAt", async () => {
    await expect(
      viewings.createViewing(W.ctx, { propertyId, scheduledAt: new Date("not-a-date") }),
    ).rejects.toThrow(/valid viewing/i);
  });
});
