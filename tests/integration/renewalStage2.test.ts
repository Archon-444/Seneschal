import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import {
  acceptOffer,
  captureRentIndex,
  mintRenewedTenancy,
  openRenewalCase,
  proposeOffer,
} from "@/server/services/renewals";
import { approveNotice, prepareNotice, serveNoticeFormal, serveRenewalNotice } from "@/server/services/notice";
import { evaluateRenewalRisk, evaluateWorkspaceRisk } from "@/server/services/risk";

// PR6b — Stage-2 services. Provenance, single-event-per-transition discipline,
// successor lineage, and the two new risk evaluators.

let W: TestActor;
let tenancyId: string;
let propertyId: string;

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("PR6 WS");
  const client = await clients.createClient(W.ctx, { displayName: "Renewal Co" });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    community: "Downtown",
    unitNo: "2104",
  });
  propertyId = property.id;
  const tenancy = await tenancies.createTenancy(W.ctx, {
    propertyId,
    startDate: daysFromNow(-305),
    endDate: daysFromNow(60),
    annualRent: 80_000,
  });
  tenancyId = tenancy.id;
});

describe("captureRentIndex — provenance is captured contemporaneously", () => {
  it("populates computed fields + calculatorVersion at capture time, backfilledAt stays NULL", async () => {
    await captureRentIndex(W.ctx, {
      tenancyId,
      marketRentAvg: 100_000, // gap = 20% → 5% band → 84_000 ceiling
      indexSource: "SMART_RENTAL_INDEX_2025",
      sourceRef: { url: "https://example.test/index" },
    });
    const cap = await prisma.rentIndexCapture.findFirst({ where: { tenancyId } });
    expect(cap).toBeTruthy();
    expect(cap!.indexSource).toBe("SMART_RENTAL_INDEX_2025");
    expect(cap!.permittedPct).toBe(5);
    expect(Number(cap!.permittedNewRentMax)).toBe(84_000);
    expect(cap!.calculatorVersion).toBe("decree_43_v1");
    // Contemporaneous: not backfilled.
    expect(cap!.backfilledAt).toBeNull();
  });

  it("the backfill invariant: an inserted row with NULL computed fields stays NULL — we do NOT recompute", async () => {
    // Simulate a pre-PR6 row by inserting one without computed fields.
    const raw = await prisma.rentIndexCapture.create({
      data: {
        workspaceId: W.workspaceId,
        tenancyId,
        propertyId,
        marketRentAvg: new Prisma.Decimal(100_000),
        capturedAt: daysFromNow(-180),
        indexSource: "MANUAL_CONCIERGE",
        backfilledAt: new Date(),
      },
    });
    // The provenance fields are NULL — recomputing decree43 now would stamp a
    // present-day assessment onto a row dated 180 days ago. The schema's NULL is
    // what enforces "we know we don't know"; assert it stays NULL.
    const reread = await prisma.rentIndexCapture.findUnique({ where: { id: raw.id } });
    expect(reread!.permittedPct).toBeNull();
    expect(reread!.permittedNewRentMax).toBeNull();
    expect(reread!.calculatorVersion).toBeNull();
    expect(reread!.backfilledAt).not.toBeNull();
  });

  it("rejects an official-source capture that cites no source artefact", async () => {
    await expect(
      captureRentIndex(W.ctx, {
        tenancyId,
        marketRentAvg: 100_000,
        indexSource: "SMART_RENTAL_INDEX_2025",
      }),
    ).rejects.toThrow(/artefact|sourceRef/i);
  });

  it("a bare capture is recorded as a provisional concierge estimate, never DLD-sourced", async () => {
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 100_000 });
    const cap = await prisma.rentIndexCapture.findFirst({ where: { tenancyId } });
    expect(cap!.indexSource).toBe("MANUAL_CONCIERGE");
    expect(cap!.source).toMatch(/awaiting verification/i);
    expect(cap!.source).not.toMatch(/DLD/);
    // The decree-43 figures are still computed contemporaneously.
    expect(cap!.permittedPct).toBe(5);
  });

  it("an official capture with a source artefact keeps its official label", async () => {
    await captureRentIndex(W.ctx, {
      tenancyId,
      marketRentAvg: 100_000,
      indexSource: "SMART_RENTAL_INDEX_2025",
      sourceRef: { url: "https://dld.example/index" },
    });
    const cap = await prisma.rentIndexCapture.findFirst({ where: { tenancyId } });
    expect(cap!.indexSource).toBe("SMART_RENTAL_INDEX_2025");
    expect(cap!.source).toBe("DLD Smart Rental Index");
  });
});

describe("Notice 3-state flow — one evidence event per transition, timeline monotonic", () => {
  it("prepare → approve → serve each emit a single evidence row, in order", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const notice = await prepareNotice(W.ctx, {
      renewalCaseId: rc.id,
      kind: "RENEWAL_CHANGE",
      templateCode: "renewal_change_v1",
    });
    // small delay between transitions so createdAt is unambiguously monotonic
    await new Promise((r) => setTimeout(r, 10));
    await approveNotice(W.ctx, notice.id);
    await new Promise((r) => setTimeout(r, 10));
    await serveNoticeFormal(W.ctx, { noticeId: notice.id, serviceMethod: "EMAIL", serviceRef: "inbox-ref" });

    const rows = await prisma.evidenceEvent.findMany({
      where: {
        scopeId: rc.id,
        type: { in: ["NOTICE_GENERATED", "NOTICE_APPROVED", "NOTICE_SERVED"] },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.map((r) => r.type)).toEqual(["NOTICE_GENERATED", "NOTICE_APPROVED", "NOTICE_SERVED"]);
    // Timeline-monotonicity assertion the plan called out: rows are NOT clustered
    // at a single mint timestamp. The serve row's createdAt must be strictly
    // greater than the generate row's createdAt.
    expect(rows[2].createdAt.getTime()).toBeGreaterThan(rows[0].createdAt.getTime());
    // Belt-and-braces: not all three share the same timestamp.
    const uniq = new Set(rows.map((r) => r.createdAt.getTime()));
    expect(uniq.size).toBeGreaterThan(1);
  });

  it("rejects out-of-order transitions: cannot SERVE before APPROVE", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const notice = await prepareNotice(W.ctx, { renewalCaseId: rc.id, kind: "RENEWAL_CHANGE" });
    await expect(
      serveNoticeFormal(W.ctx, { noticeId: notice.id, serviceMethod: "EMAIL" }),
    ).rejects.toThrow(/APPROVED/);
  });
});

describe("mintRenewedTenancy — single event, lineage stamped, no back-filled chain", () => {
  async function makeAgreedCase() {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const offer = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 84_000,
      paymentSchedule: "4 cheques",
    });
    await acceptOffer(W.ctx, offer.id);
    return rc;
  }

  it("creates the successor, sets renewsFromTenancyId, and emits exactly one RENEWAL_COMPLETED row", async () => {
    const rc = await makeAgreedCase();
    const beforeRows = await prisma.evidenceEvent.count({ where: { type: "RENEWAL_COMPLETED" } });
    const successor = await mintRenewedTenancy(W.ctx, {
      renewalCaseId: rc.id,
      startDate: daysFromNow(61),
      endDate: daysFromNow(425),
      annualRent: 84_000,
    });
    expect(successor.renewsFromTenancyId).toBe(tenancyId);

    const reloadedRc = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(reloadedRc!.renewedTenancyId).toBe(successor.id);
    expect(reloadedRc!.status).toBe("RENEWED");
    const predecessor = await prisma.tenancy.findUnique({ where: { id: tenancyId } });
    expect(predecessor!.status).toBe("RENEWED");

    // Exactly ONE renewal-completed evidence row, emitted at mint time. No chain.
    const afterRows = await prisma.evidenceEvent.count({ where: { type: "RENEWAL_COMPLETED" } });
    expect(afterRows - beforeRows).toBe(1);
  });

  it("does not back-fill prior renewal events at mint time (the timeline must not lie)", async () => {
    const rc = await makeAgreedCase();
    const priorTypes = ["RENEWAL_ASSESSMENT_CREATED", "OFFER_PROPOSED", "OFFER_ACCEPTED"] as const;
    const before = await prisma.evidenceEvent.count({
      where: { scopeId: { in: [rc.id] }, type: { in: [...priorTypes] } },
    });
    await mintRenewedTenancy(W.ctx, {
      renewalCaseId: rc.id,
      startDate: daysFromNow(61),
      endDate: daysFromNow(425),
      annualRent: 84_000,
    });
    const after = await prisma.evidenceEvent.count({
      where: { scopeId: { in: [rc.id] }, type: { in: [...priorTypes] } },
    });
    // The minting MUST NOT have written any back-dated copies of the earlier events.
    expect(after).toBe(before);
  });

  it("refuses to mint twice (renewedTenancyId is @unique-guarded)", async () => {
    const rc = await makeAgreedCase();
    await mintRenewedTenancy(W.ctx, {
      renewalCaseId: rc.id,
      startDate: daysFromNow(61),
      endDate: daysFromNow(425),
      annualRent: 84_000,
    });
    // Both guards are correct rejections — the status guard fires first because
    // a successful mint moves the case to RENEWED, but should that ever change,
    // the renewedTenancyId guard still catches the second attempt.
    await expect(
      mintRenewedTenancy(W.ctx, {
        renewalCaseId: rc.id,
        startDate: daysFromNow(61),
        endDate: daysFromNow(425),
        annualRent: 84_000,
      }),
    ).rejects.toThrow(/AGREED|already been minted/);
  });
});

describe("renewal risk wiring — production paths raise flags", () => {
  it("PROPOSED_INCREASE_ABOVE_INDEX_BAND raises from proposeOffer and follows the active offer", async () => {
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 100_000 }); // ceiling = 84_000
    const rc = await openRenewalCase(W.ctx, tenancyId);

    const high = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 90_000,
      paymentSchedule: "4 cheques",
    });
    const afterHigh = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(afterHigh!.currentOfferId).toBe(high.id);
    expect(afterHigh!.proposedRent).toBeNull();
    expect(
      await prisma.riskFlag.findFirst({
        where: { scopeId: rc.id, code: "PROPOSED_INCREASE_ABOVE_INDEX_BAND", status: "OPEN" },
      }),
    ).toBeTruthy();

    const low = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "TENANT",
      annualRent: 82_000,
      paymentSchedule: "4 cheques",
    });
    const afterLow = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(afterLow!.currentOfferId).toBe(low.id);
    expect(
      await prisma.riskFlag.findFirst({
        where: {
          scopeId: rc.id,
          code: "PROPOSED_INCREASE_ABOVE_INDEX_BAND",
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
      }),
    ).toBeNull();
  });

  it("RENEWAL_NOTICE_WINDOW_MISSED raises from the workspace sweep and clears through canonical notice service", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    await prisma.renewalCase.update({
      where: { id: rc.id },
      data: { noticeGateAt: daysFromNow(-2), noticeServedAt: null },
    });

    await evaluateWorkspaceRisk(W.workspaceId);
    expect(
      await prisma.riskFlag.findFirst({
        where: { scopeId: rc.id, code: "RENEWAL_NOTICE_WINDOW_MISSED", status: "OPEN" },
      }),
    ).toBeTruthy();

    await serveRenewalNotice(W.ctx, { renewalCaseId: rc.id, serviceMethod: "EMAIL", serviceRef: "inbox-ref" });
    expect(
      await prisma.riskFlag.findFirst({
        where: {
          scopeId: rc.id,
          code: "RENEWAL_NOTICE_WINDOW_MISSED",
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
        },
      }),
    ).toBeNull();
  });

  it("the daily sweep skips terminal cases — RENEWED/DECLINED/LAPSED never raise the missed-window flag", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    // A setup that WOULD raise for a non-terminal case (the test above proves that
    // exact shape raises from the sweep): the notice gate is in the past and no
    // notice was ever served.
    await prisma.renewalCase.update({
      where: { id: rc.id },
      data: { noticeGateAt: daysFromNow(-2), noticeServedAt: null },
    });

    // Drive the SAME case through each terminal status. The sweep
    // (evaluateWorkspaceRisk) must exclude it via its `status notIn` filter, so the
    // missed-window flag is never raised — even though the per-case evaluator has no
    // terminal guard of its own. No hand-editing of the flag table; only the case
    // status changes.
    for (const status of ["RENEWED", "DECLINED", "LAPSED"] as const) {
      await prisma.renewalCase.update({ where: { id: rc.id }, data: { status } });
      await evaluateWorkspaceRisk(W.workspaceId);
      expect(
        await prisma.riskFlag.findFirst({
          where: { scopeId: rc.id, code: "RENEWAL_NOTICE_WINDOW_MISSED" },
        }),
      ).toBeNull();
    }
  });
});

describe("proposeOffer — captures permittedMaxSnapshot at send time", () => {
  it("snapshots the live ceiling onto the offer row and does not auto-update on later captures", async () => {
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 100_000 }); // ceiling = 84_000
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const offer = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 84_000,
      paymentSchedule: "4 cheques",
    });
    expect(offer.permittedMaxSnapshot).not.toBeNull();
    expect(Number(offer.permittedMaxSnapshot)).toBe(84_000);

    // A later capture changes the live ceiling — the prior offer's snapshot must NOT change.
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 120_000 });
    const reread = await prisma.offer.findUnique({ where: { id: offer.id } });
    expect(Number(reread!.permittedMaxSnapshot)).toBe(84_000);
  });
});

describe("renewal risk evaluator — reads the active offer's frozen figures, not mutable fields", () => {
  // The discriminating cases the static "above-ceiling raises a flag" test does NOT
  // exercise: a capture that MOVES after the offer is sent, and the legacy
  // RenewalCase.proposedRent cache. Both are set up to FLIP the verdict if the
  // evaluator read them — so a refactor that repoints at the mutable field fails loud.

  it("reads the offer's frozen ceiling, not a capture that moved after the offer was sent", async () => {
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 100_000 }); // ceiling = 84_000
    const rc = await openRenewalCase(W.ctx, tenancyId);
    // Offer above the frozen ceiling → flag raised; permittedMaxSnapshot frozen at 84_000.
    await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 90_000,
      paymentSchedule: "4 cheques",
    });
    expect(
      await prisma.riskFlag.findFirst({
        where: { scopeId: rc.id, code: "PROPOSED_INCREASE_ABOVE_INDEX_BAND", status: "OPEN" },
      }),
    ).toBeTruthy();

    // A LATER capture lifts the LIVE ceiling to 92_000 (gap 33% → 15% band on 80k).
    // If the evaluator re-read the latest capture, 90_000 ≤ 92_000 would CLEAR the
    // flag. The offer's frozen 84_000 snapshot must still win → flag stays OPEN.
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 120_000 });
    await evaluateRenewalRisk(rc.id);
    expect(
      await prisma.riskFlag.findFirst({
        where: { scopeId: rc.id, code: "PROPOSED_INCREASE_ABOVE_INDEX_BAND", status: "OPEN" },
      }),
    ).toBeTruthy();
  });

  it("ignores RenewalCase.proposedRent (legacy cache), reading the active offer's annualRent", async () => {
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 100_000 }); // ceiling = 84_000
    const rc = await openRenewalCase(W.ctx, tenancyId);
    await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 90_000, // above ceiling → flag raised
      paymentSchedule: "4 cheques",
    });
    expect(
      await prisma.riskFlag.findFirst({
        where: { scopeId: rc.id, code: "PROPOSED_INCREASE_ABOVE_INDEX_BAND", status: "OPEN" },
      }),
    ).toBeTruthy();

    // Poison the legacy cache field with a value BELOW the ceiling. If a future
    // refactor repointed the evaluator at RenewalCase.proposedRent, 50_000 ≤ 84_000
    // would CLEAR the flag. The active offer's annualRent (90_000) must remain the
    // source of truth → flag stays OPEN.
    await prisma.renewalCase.update({
      where: { id: rc.id },
      data: { proposedRent: new Prisma.Decimal(50_000) },
    });
    await evaluateRenewalRisk(rc.id);
    expect(
      await prisma.riskFlag.findFirst({
        where: { scopeId: rc.id, code: "PROPOSED_INCREASE_ABOVE_INDEX_BAND", status: "OPEN" },
      }),
    ).toBeTruthy();
  });
});
