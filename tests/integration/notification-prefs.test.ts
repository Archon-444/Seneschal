import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, resetDb, type TestActor } from "../helpers";
import {
  getMyNotificationPreferences,
  setNotificationPreference,
} from "@/server/services/notifications";

// PR5 — cadence preferences are self-data; absence of a row means the default
// (routine categories DAILY, the portfolio DIGEST WEEKLY).

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Prefs WS");
});

const cadenceOf = (prefs: { category: string; cadence: string }[], cat: string) =>
  prefs.find((p) => p.category === cat)!.cadence;

describe("notification preferences", () => {
  it("defaults to DAILY for routine categories and WEEKLY for the digest", async () => {
    const prefs = await getMyNotificationPreferences(W.ctx);
    expect(prefs).toHaveLength(6);
    expect(cadenceOf(prefs, "DEADLINES")).toBe("DAILY");
    expect(cadenceOf(prefs, "PAYMENTS")).toBe("DAILY");
    expect(cadenceOf(prefs, "DIGEST")).toBe("WEEKLY");
  });

  it("round-trips a saved cadence and leaves other categories untouched", async () => {
    await setNotificationPreference(W.ctx, "PAYMENTS", "IMMEDIATE");
    const prefs = await getMyNotificationPreferences(W.ctx);
    expect(cadenceOf(prefs, "PAYMENTS")).toBe("IMMEDIATE");
    expect(cadenceOf(prefs, "DEADLINES")).toBe("DAILY"); // unchanged default
  });

  it("upserts — re-saving a category updates rather than duplicates", async () => {
    await setNotificationPreference(W.ctx, "RISK", "OFF");
    await setNotificationPreference(W.ctx, "RISK", "WEEKLY");
    const prefs = await getMyNotificationPreferences(W.ctx);
    expect(cadenceOf(prefs, "RISK")).toBe("WEEKLY");
  });
});
