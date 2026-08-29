import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeDelegate, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import { listEvidencePage } from "@/server/services/evidenceQuery";
import { getEvidenceFilterOptions, getEvidenceTimeline } from "@/server/services/evidenceReadModel";
import * as clients from "@/server/services/clients";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Evidence timeline");
});

describe("paginated evidence timeline", () => {
  it("uses a stable id tie-breaker without duplicate or omitted rows", async () => {
    const at = new Date("2026-08-18T08:00:00.000Z");
    await prisma.evidenceEvent.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        id: `event-${String(index).padStart(3, "0")}`,
        workspaceId: W.workspaceId,
        type: "REPORT_GENERATED" as const,
        actorType: "USER" as const,
        actorId: W.userId,
        scopeType: "WORKSPACE" as const,
        scopeId: W.workspaceId,
        createdAt: at,
      })),
    });

    const pages = await Promise.all([1, 2, 3].map((page) => listEvidencePage(W.ctx, { types: ["REPORT_GENERATED"], page, pageSize: 10 })));
    const ids = pages.flatMap((result) => result.events.map((event) => event.id));
    expect(ids).toHaveLength(25);
    expect(new Set(ids)).toHaveLength(25);
    expect(ids[0]).toBe("event-024");
    expect(ids.at(-1)).toBe("event-000");
  });

  it("keeps workspace filters fail-closed", async () => {
    const other = await makeWorkspace("Other evidence");
    await prisma.evidenceEvent.create({
      data: {
        workspaceId: other.workspaceId,
        type: "REPORT_GENERATED",
        actorType: "USER",
        actorId: other.userId,
        scopeType: "WORKSPACE",
        scopeId: other.workspaceId,
      },
    });
    expect((await listEvidencePage(W.ctx)).events).toHaveLength(0);
  });

  it("keeps client-viewer filters inside the assigned client", async () => {
    const clientA = await clients.createClient(W.ctx, { displayName: "Client A" });
    const clientB = await clients.createClient(W.ctx, { displayName: "Client B" });
    const propertyA = await properties.createProperty(W.ctx, { clientPrincipalId: clientA.id, community: "Marina", unitNo: "1" });
    const propertyB = await properties.createProperty(W.ctx, { clientPrincipalId: clientB.id, community: "JVC", unitNo: "2" });
    const tenancyA = await tenancies.createTenancy(W.ctx, { propertyId: propertyA.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 80_000 });
    const tenancyB = await tenancies.createTenancy(W.ctx, { propertyId: propertyB.id, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), annualRent: 70_000 });
    await prisma.evidenceEvent.createMany({
      data: [tenancyA, tenancyB].map((tenancy) => ({
        workspaceId: W.workspaceId,
        type: "REPORT_GENERATED" as const,
        actorType: "USER" as const,
        actorId: W.userId,
        scopeType: "TENANCY" as const,
        scopeId: tenancy.id,
        propertyId: tenancy.propertyId,
        tenancyId: tenancy.id,
      })),
    });

    const viewer = await addMember(W.workspaceId, "CLIENT_VIEWER", clientA.id);
    const visible = await listEvidencePage(viewer.ctx, { types: ["REPORT_GENERATED"] });
    expect(visible.events.map((event) => event.tenancyId)).toEqual([tenancyA.id]);
    const probed = await listEvidencePage(viewer.ctx, { types: ["REPORT_GENERATED"], clientPrincipalId: clientB.id });
    expect(probed.events.map((event) => event.tenancyId)).toEqual([tenancyA.id]);
    const options = await getEvidenceFilterOptions(viewer.ctx);
    expect(options.clients.map((client) => client.id)).toEqual([clientA.id]);
    expect(options.properties.map((property) => property.id)).toEqual([propertyA.id]);

    const original = visible.events[0];
    await prisma.evidenceEvent.create({
      data: {
        workspaceId: W.workspaceId,
        type: "FIELD_CORRECTED",
        actorType: "USER",
        actorId: W.userId,
        scopeType: "TENANCY",
        scopeId: tenancyB.id,
        propertyId: propertyB.id,
        tenancyId: tenancyB.id,
        supersedesId: original.id,
      },
    });
    const presented = await getEvidenceTimeline(viewer.ctx, { type: "REPORT_GENERATED" });
    expect(presented.events[0].correctionState).toHaveLength(0);
  });

  it("returns presented Dubai-ready records while retaining UTC technical detail", async () => {
    await prisma.evidenceEvent.create({
      data: {
        workspaceId: W.workspaceId,
        type: "INDEX_CAPTURED",
        actorType: "USER",
        actorId: W.userId,
        scopeType: "WORKSPACE",
        scopeId: W.workspaceId,
        payload: { source: "DLD Smart Rental Index", calculatorVersion: "v1" },
        createdAt: new Date("2026-08-18T21:30:00.000Z"),
      },
    });
    const timeline = await getEvidenceTimeline(W.ctx, { type: "INDEX_CAPTURED" });
    expect(timeline.events[0].title).toBe("Smart Rental Index source captured");
    expect(timeline.events[0].actorLabel).toContain("Evidence timeline user");
    expect(timeline.events[0].technicalDetails.storedUtc).toBe("2026-08-18T21:30:00.000Z");
    expect((await getEvidenceTimeline(W.ctx, { q: "does-not-exist" })).events).toHaveLength(0);
  });

  it("denies the route to delegates that do not hold evidence-read capability", async () => {
    const delegate = await makeDelegate(W.workspaceId, []);
    await expect(getEvidenceTimeline(delegate.ctx)).rejects.toThrow();
  });
});
