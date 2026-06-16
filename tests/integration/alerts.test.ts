import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as payments from "@/server/services/payments";
import { runAlertLadders } from "@/server/services/alerts";
import { sendUserWeeklyDigests } from "@/server/services/digests";
import { captureRentIndex } from "@/server/services/renewals";
import { todayInDubai } from "@/server/calculators/dates";
import { findBannedCopy } from "../copyConstraints";

// T9.2 — ladders run from Deadline rows; every send is REMINDER_SENT evidence;
// each rung fires once (idempotent across daily reruns).

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Alerts WS");
});

function daysFromToday(days: number): Date {
  return new Date(todayInDubai().getTime() + days * 86_400_000);
}

describe("alert ladders", () => {
  it("cheque T-7 rung fires once with evidence, idempotent on rerun", async () => {
    const property = await properties.createProperty(W.ctx, {
      clientPrincipalId: (await prisma.clientPrincipal.create({ data: { workspaceId: W.workspaceId, displayName: "C" } })).id,
      community: "Dubai Marina",
      unitNo: "1",
    });
    const tenancy = await tenancies.createTenancy(W.ctx, {
      propertyId: property.id,
      startDate: daysFromToday(-30),
      endDate: daysFromToday(335),
      annualRent: 60000,
      ejariNo: "L-1",
    });
    await payments.setPaymentSchedule(W.ctx, tenancy.id, [
      { seq: 1, dueDate: daysFromToday(7), amount: 60000 }, // exactly T-7
    ]);

    const sent = await runAlertLadders(W.workspaceId);
    expect(sent).toBe(1);

    const evidence = await prisma.evidenceEvent.findMany({
      where: { workspaceId: W.workspaceId, type: "REMINDER_SENT" },
    });
    expect(evidence).toHaveLength(1);
    expect((evidence[0].payload as { rung: string }).rung).toBe("T-7");

    // One in-app feed item for the admin; no immediate email — the T-7 rung is
    // routine (DEADLINES/DAILY), so the email is deferred to the daily digest.
    const inApp = await prisma.notificationMessage.count({
      where: { workspaceId: W.workspaceId, templateCode: "cheque_v1", channel: "INAPP" },
    });
    expect(inApp).toBe(1);
    const email = await prisma.notificationMessage.count({
      where: { workspaceId: W.workspaceId, templateCode: "cheque_v1", channel: "EMAIL" },
    });
    expect(email).toBe(0);

    // rerun: the rung does not fire twice
    expect(await runAlertLadders(W.workspaceId)).toBe(0);
  });

  it("notice gate T-120 rung fires from the NOTICE_GATE deadline", async () => {
    const property = await properties.createProperty(W.ctx, {
      clientPrincipalId: (await prisma.clientPrincipal.create({ data: { workspaceId: W.workspaceId, displayName: "C" } })).id,
      community: "Business Bay",
      unitNo: "2",
    });
    // gate = end - 90; want gate at today+120 → end at today+210
    await tenancies.createTenancy(W.ctx, {
      propertyId: property.id,
      startDate: daysFromToday(-155),
      endDate: daysFromToday(210),
      annualRent: 50000,
      ejariNo: "L-2",
    });

    const sent = await runAlertLadders(W.workspaceId);
    expect(sent).toBe(1);
    const evidence = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "REMINDER_SENT" },
    });
    expect((evidence!.payload as { template: string }).template).toBe("notice_gate_v1");
  });

  it("weekly digest sends to fiduciary/admin members, throttled to once a week", async () => {
    await sendUserWeeklyDigests(W.workspaceId);
    await sendUserWeeklyDigests(W.workspaceId); // second call within the week is skipped
    const digests = await prisma.notificationMessage.findMany({
      where: { workspaceId: W.workspaceId, templateCode: "weekly_digest_v1" },
    });
    expect(digests).toHaveLength(1);
  });

  it("the daily runner triggers the weekly digest", async () => {
    const { runDailyJobs } = await import("@/server/outbox/runner");
    await runDailyJobs();
    const digest = await prisma.notificationMessage.findFirst({
      where: { workspaceId: W.workspaceId, templateCode: "weekly_digest_v1" },
    });
    expect(digest).toBeTruthy();
  });
});

async function noticeGateTenancy(actor: TestActor, annualRent: number) {
  const property = await properties.createProperty(actor.ctx, {
    clientPrincipalId: (
      await prisma.clientPrincipal.create({
        data: { workspaceId: actor.workspaceId, displayName: "C" },
      })
    ).id,
    community: "Dubai Marina",
    unitNo: "1",
  });
  // gate = end − 90; place it at today+120 to fire the T-120 rung
  return tenancies.createTenancy(actor.ctx, {
    propertyId: property.id,
    startDate: daysFromToday(-155),
    endDate: daysFromToday(210),
    annualRent,
    ejariNo: "L-IDX",
  });
}

async function noticeGateBody(workspaceId: string): Promise<string> {
  const msg = await prisma.notificationMessage.findFirst({
    where: { workspaceId, templateCode: "notice_gate_v1", direction: "OUTBOUND" },
  });
  return msg?.bodyRef ?? "";
}

function expectNoBannedTerms(body: string) {
  expect(findBannedCopy(body)).toBeNull();
}

describe("notice-gate alert — RERA enrichment (PR2)", () => {
  it("embeds the ceiling estimate and value-at-risk when an index exists", async () => {
    const tenancy = await noticeGateTenancy(W, 72000);
    // 72,000 vs market 96,000 → 25% below → Decree-43 10% band.
    await captureRentIndex(W.ctx, { tenancyId: tenancy.id, marketRentAvg: 96000 });

    expect(await runAlertLadders(W.workspaceId)).toBe(1); // body changes, not rung count

    const body = await noticeGateBody(W.workspaceId);
    const lower = body.toLowerCase();
    expect(lower).toContain("index-based ceiling estimate");
    expect(lower).toContain("at risk if a valid renewal notice");
    expect(lower).toContain("based on supplied data and the captured index");
    expect(lower).toContain("review before action");
    expect((body.match(/AED\s*[\d,]+/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expectNoBannedTerms(body);
  });

  it("stays generic when no index is captured", async () => {
    await noticeGateTenancy(W, 72000);
    expect(await runAlertLadders(W.workspaceId)).toBe(1);
    const lower = (await noticeGateBody(W.workspaceId)).toLowerCase();
    expect(lower).toContain("deadline reminder");
    expect(lower).not.toContain("index-based ceiling estimate");
    expectNoBannedTerms(lower);
  });

  it("no shipped reminder body uses constrained legal terms", async () => {
    const tenancy = await noticeGateTenancy(W, 72000);
    await captureRentIndex(W.ctx, { tenancyId: tenancy.id, marketRentAvg: 96000 });
    await runAlertLadders(W.workspaceId);
    const all = await prisma.notificationMessage.findMany({
      where: { workspaceId: W.workspaceId, direction: "OUTBOUND" },
    });
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) expectNoBannedTerms(m.bodyRef ?? "");
  });

  it("computes the canonical Decree-43 ceiling and value-at-risk", async () => {
    const tenancy = await noticeGateTenancy(W, 72000);
    await captureRentIndex(W.ctx, { tenancyId: tenancy.id, marketRentAvg: 96000 });
    await runAlertLadders(W.workspaceId);
    const normalized = (await noticeGateBody(W.workspaceId)).replace(/,/g, "");
    expect(normalized).toContain("79200"); // ceiling estimate
    expect(normalized).toContain("7200"); // value at risk / yr
  });
});
