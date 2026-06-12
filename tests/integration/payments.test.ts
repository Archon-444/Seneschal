import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as payments from "@/server/services/payments";

// E4 — schedule editor, state machine + evidence, late detection (T4.3).

let W: TestActor;
let tenancyId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Payments WS");
  const client = await prisma.clientPrincipal.create({
    data: { workspaceId: W.workspaceId, displayName: "C" },
  });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    community: "Dubai Marina",
    unitNo: "1204",
  });
  const tenancy = await tenancies.createTenancy(W.ctx, {
    propertyId: property.id,
    startDate: new Date("2025-09-16"),
    endDate: new Date("2026-09-15"),
    annualRent: 72000,
    ejariNo: "X-1",
  });
  tenancyId = tenancy.id;
});

describe("schedule editor (T4.1)", () => {
  it("Σ items ≠ annualRent raises CHEQUE_TOTAL_MISMATCH as WARN, not block", async () => {
    const items = await payments.setPaymentSchedule(W.ctx, tenancyId, [
      { seq: 1, dueDate: new Date("2025-09-16"), amount: 18000 },
      { seq: 2, dueDate: new Date("2025-12-16"), amount: 18000 },
    ]);
    expect(items).toHaveLength(2); // write succeeded despite mismatch

    const flag = await prisma.riskFlag.findFirst({
      where: { code: "CHEQUE_TOTAL_MISMATCH", scopeId: tenancyId, status: "OPEN" },
    });
    expect(flag!.severity).toBe("WARN");

    // fixing the schedule clears the flag
    await payments.setPaymentSchedule(W.ctx, tenancyId, [
      { seq: 1, dueDate: new Date("2025-09-16"), amount: 36000 },
      { seq: 2, dueDate: new Date("2026-03-16"), amount: 36000 },
    ]);
    const cleared = await prisma.riskFlag.findFirst({
      where: { code: "CHEQUE_TOTAL_MISMATCH", scopeId: tenancyId, status: "OPEN" },
    });
    expect(cleared).toBeNull();
  });

  it("schedule changes regenerate CHEQUE_DUE deadlines", async () => {
    await payments.setPaymentSchedule(W.ctx, tenancyId, [
      { seq: 1, dueDate: new Date("2025-09-16"), amount: 72000 },
    ]);
    expect(
      await prisma.deadline.count({ where: { tenancyId, kind: "CHEQUE_DUE", status: "OPEN" } }),
    ).toBe(1);
    await payments.setPaymentSchedule(W.ctx, tenancyId, [
      { seq: 1, dueDate: new Date("2025-09-16"), amount: 36000 },
      { seq: 2, dueDate: new Date("2026-03-16"), amount: 36000 },
    ]);
    expect(
      await prisma.deadline.count({ where: { tenancyId, kind: "CHEQUE_DUE", status: "OPEN" } }),
    ).toBe(2);
  });
});

describe("state machine (T4.2)", () => {
  it("walks SCHEDULED→RECEIVED→DEPOSITED→CLEARED writing evidence each step", async () => {
    const [item] = await payments.setPaymentSchedule(W.ctx, tenancyId, [
      { seq: 1, dueDate: new Date("2025-09-16"), amount: 72000, chequeNo: "000451" },
    ]);
    await payments.transitionPayment(W.ctx, item.id, "RECEIVED");
    await payments.transitionPayment(W.ctx, item.id, "DEPOSITED");
    await payments.transitionPayment(W.ctx, item.id, "CLEARED");

    const types = (
      await prisma.evidenceEvent.findMany({ where: { scopeId: item.id }, orderBy: { createdAt: "asc" } })
    ).map((e) => e.type);
    expect(types).toEqual(["CHEQUE_RECEIVED", "CHEQUE_DEPOSITED", "CHEQUE_CLEARED"]);
    const final = await prisma.paymentItem.findUnique({ where: { id: item.id } });
    expect(final!.status).toBe("CLEARED");
    expect(final!.confirmedById).toBe(W.ctx.userId);
  });

  it("rejects invalid transitions", async () => {
    const [item] = await payments.setPaymentSchedule(W.ctx, tenancyId, [
      { seq: 1, dueDate: new Date("2025-09-16"), amount: 72000 },
    ]);
    await expect(payments.transitionPayment(W.ctx, item.id, "CLEARED")).rejects.toThrow();
    await expect(payments.transitionPayment(W.ctx, item.id, "BOUNCED")).rejects.toThrow();
    await payments.transitionPayment(W.ctx, item.id, "RECEIVED");
    await expect(payments.transitionPayment(W.ctx, item.id, "SCHEDULED")).rejects.toThrow();
  });

  it("BOUNCED can recover to RECEIVED", async () => {
    const [item] = await payments.setPaymentSchedule(W.ctx, tenancyId, [
      { seq: 1, dueDate: new Date("2025-09-16"), amount: 72000 },
    ]);
    await payments.transitionPayment(W.ctx, item.id, "RECEIVED");
    await payments.transitionPayment(W.ctx, item.id, "DEPOSITED");
    await payments.transitionPayment(W.ctx, item.id, "BOUNCED");
    const after = await payments.transitionPayment(W.ctx, item.id, "RECEIVED");
    expect(after.status).toBe("RECEIVED");
  });
});

describe("late detection (T4.3)", () => {
  it("marks LATE, raises PAYMENT_LATE, queues reminder; idempotent on rerun", async () => {
    const [pastDue] = await payments.setPaymentSchedule(W.ctx, tenancyId, [
      { seq: 1, dueDate: new Date("2020-01-01"), amount: 72000 },
    ]);
    expect(await payments.detectLatePayments(W.workspaceId)).toBe(1);
    expect(await payments.detectLatePayments(W.workspaceId)).toBe(0); // idempotent

    const item = await prisma.paymentItem.findUnique({ where: { id: pastDue.id } });
    expect(item!.status).toBe("LATE");
    const flag = await prisma.riskFlag.findFirst({
      where: { code: "PAYMENT_LATE", scopeId: pastDue.id, status: "OPEN" },
    });
    expect(flag).toBeTruthy();
    expect(await prisma.outbox.count({ where: { topic: "notification.send" } })).toBeGreaterThan(0);

    // receiving the late cheque clears the flag
    await payments.transitionPayment(W.ctx, pastDue.id, "RECEIVED");
    const cleared = await prisma.riskFlag.findFirst({
      where: { code: "PAYMENT_LATE", scopeId: pastDue.id, status: "OPEN" },
    });
    expect(cleared).toBeNull();
  });
});
