import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as payments from "@/server/services/payments";
import { runAlertLadders, sendWeeklyDigest } from "@/server/services/alerts";
import { todayInDubai } from "@/server/calculators/dates";

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

    const messages = await prisma.notificationMessage.count({
      where: { workspaceId: W.workspaceId, templateCode: "cheque_v1" },
    });
    expect(messages).toBe(1); // one admin in the workspace

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
    await sendWeeklyDigest(W.workspaceId);
    await sendWeeklyDigest(W.workspaceId); // second call within the week is skipped
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
