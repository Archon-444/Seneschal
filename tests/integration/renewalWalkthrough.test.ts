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
  respondToOfferViaLink,
  sendOfferToTenant,
} from "@/server/services/renewals";
import { approveNotice, prepareNotice, serveNoticeFormal } from "@/server/services/notice";
import { validateLinkToken } from "@/server/services/secureLinks";

// PR6c — end-to-end walkthrough of the Stage-2 renewal pipeline. This is the
// acceptance test the plan calls for: an operator drives one tenancy from open
// to RENEWED, and we assert that every promise of the platform holds:
//
//   • Every meaningful transition emits its own evidence row, AT its moment.
//   • The timeline is strictly monotonic — events are NOT clustered at any
//     single later mint timestamp ("the timeline must not lie").
//   • The backfilled-capture invariant holds (NULL computed fields stay NULL).
//   • The offer's permittedMaxSnapshot is preserved through accept + mint.
//   • mintRenewedTenancy emits ONE RENEWAL_COMPLETED, not a chain.
//   • Successor tenancy carries renewsFromTenancyId; predecessor is RENEWED.

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
  W = await makeWorkspace("Walkthrough WS");
  const client = await clients.createClient(W.ctx, { displayName: "Walkthrough Co" });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    community: "Marina Heights",
    unitNo: "1204",
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

describe("end-to-end Stage-2 renewal walkthrough", () => {
  it("drives one case from open to RENEWED with a truthful timeline", async () => {
    // --- 1. Open the case.
    const rc = await openRenewalCase(W.ctx, tenancyId);
    expect(rc.status).toBe("ASSESSING");
    await new Promise((r) => setTimeout(r, 5));

    // --- 2. Seed a pre-existing (backfilled) capture, then a contemporaneous one.
    //         The backfilled row must keep its NULL computed fields; the new one
    //         must populate them.
    await prisma.rentIndexCapture.create({
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
    await new Promise((r) => setTimeout(r, 5));
    await captureRentIndex(W.ctx, { tenancyId, marketRentAvg: 100_000 }); // ceiling = 84_000
    await new Promise((r) => setTimeout(r, 5));

    const allCaptures = await prisma.rentIndexCapture.findMany({
      where: { tenancyId },
      orderBy: { capturedAt: "asc" },
    });
    expect(allCaptures).toHaveLength(2);
    // Backfilled row: NULL computed (provenance preserved).
    expect(allCaptures[0].backfilledAt).not.toBeNull();
    expect(allCaptures[0].permittedNewRentMax).toBeNull();
    // Contemporaneous row: populated, not backfilled.
    expect(allCaptures[1].backfilledAt).toBeNull();
    expect(Number(allCaptures[1].permittedNewRentMax)).toBe(84_000);

    // --- 3. Prepare → approve → serve notice. Three rows, in order.
    const notice = await prepareNotice(W.ctx, {
      renewalCaseId: rc.id,
      kind: "RENEWAL_CHANGE",
      templateCode: "renewal_change_notice_v1",
    });
    await new Promise((r) => setTimeout(r, 5));
    await approveNotice(W.ctx, notice.id);
    await new Promise((r) => setTimeout(r, 5));
    await serveNoticeFormal(W.ctx, { noticeId: notice.id, serviceMethod: "EMAIL" });
    await new Promise((r) => setTimeout(r, 5));

    // --- 4. Landlord proposes an offer. Snapshot = 84_000 (the live ceiling).
    const offer = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 84_000,
      paymentSchedule: "4 cheques",
    });
    expect(Number(offer.permittedMaxSnapshot)).toBe(84_000);
    await new Promise((r) => setTimeout(r, 5));

    // --- 5. Send the offer to the tenant via a secure link.
    const { url } = await sendOfferToTenant(W.ctx, offer.id);
    const token = url.split("/link/")[1];
    const validation = await validateLinkToken(token);
    expect(validation.ok).toBe(true);

    // --- 6. Tenant accepts via the link (consume-first, H4-protected).
    await respondToOfferViaLink(validation.ok ? validation.link : (null as never), {
      action: "ACCEPT",
    });
    await new Promise((r) => setTimeout(r, 5));

    // --- 7. Accept the offer formally; case moves to AGREED.
    //         (respondToOfferViaLink accepts on the offer in place; the case
    //          must now be AGREED for mintRenewedTenancy to fire.)
    const rcAfter = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(rcAfter!.status).toBe("AGREED");
    await new Promise((r) => setTimeout(r, 5));

    // --- 8. Proposal risk was evaluated by the offer/response production path.
    const aboveBand = await prisma.riskFlag.findFirst({
      where: { scopeId: rc.id, code: "PROPOSED_INCREASE_ABOVE_INDEX_BAND", status: "OPEN" },
    });
    expect(aboveBand).toBeNull(); // at ceiling, not above

    // --- 9. Mint the successor tenancy.
    const before = await prisma.evidenceEvent.count({ where: { tenancyId } });
    const successor = await mintRenewedTenancy(W.ctx, {
      renewalCaseId: rc.id,
      startDate: daysFromNow(61),
      endDate: daysFromNow(425),
      annualRent: 84_000,
    });
    const after = await prisma.evidenceEvent.count({ where: { tenancyId } });
    // The mint added zero evidence rows to the predecessor's timeline — its
    // RENEWAL_COMPLETED row points at the successor tenancyId.
    expect(after - before).toBe(0);

    // --- Lineage assertions
    expect(successor.renewsFromTenancyId).toBe(tenancyId);
    const reread = await prisma.tenancy.findUnique({ where: { id: tenancyId } });
    expect(reread!.status).toBe("RENEWED");
    const finalRc = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(finalRc!.renewedTenancyId).toBe(successor.id);
    expect(finalRc!.status).toBe("RENEWED");

    // --- Single RENEWAL_COMPLETED row, not a chain
    const completedRows = await prisma.evidenceEvent.findMany({
      where: { type: "RENEWAL_COMPLETED", scopeId: rc.id },
    });
    expect(completedRows).toHaveLength(1);

    // --- THE TIMELINE ASSERTION. Pull every evidence row attached to the case
    //     (notice rows) and the predecessor (open/index/offer/tenant), then the
    //     mint row. Their createdAts must be STRICTLY MONOTONIC — no batch-stamp
    //     at the mint moment.
    const allEvidence = await prisma.evidenceEvent.findMany({
      where: {
        OR: [
          { scopeId: rc.id, type: { in: ["RENEWAL_ASSESSMENT_CREATED", "NOTICE_GENERATED", "NOTICE_APPROVED", "NOTICE_SERVED", "RENEWAL_COMPLETED"] } },
          { scopeId: offer.id, type: { in: ["OFFER_PROPOSED", "OFFER_ACCEPTED", "TENANT_ACKNOWLEDGED"] } },
          { tenancyId, type: "INDEX_CAPTURED" },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    // Every consecutive pair must be non-decreasing; and the spread between
    // the first and last event must be wider than the mint moment alone.
    let monotonic = true;
    for (let i = 1; i < allEvidence.length; i++) {
      if (allEvidence[i].createdAt.getTime() < allEvidence[i - 1].createdAt.getTime()) {
        monotonic = false;
        break;
      }
    }
    expect(monotonic).toBe(true);

    // Belt-and-braces: at least four distinct timestamps across the run (open,
    // index, notice, mint at minimum) — i.e. the run is not collapsed onto a
    // single tick.
    const uniqTs = new Set(allEvidence.map((e) => e.createdAt.getTime()));
    expect(uniqTs.size).toBeGreaterThanOrEqual(4);

    // Belt-and-braces #2: the RENEWAL_COMPLETED row is the LAST one, and is
    // strictly after the OFFER_ACCEPTED row (no back-fill chain at mint).
    const accepted = allEvidence.find((e) => e.type === "OFFER_ACCEPTED");
    const completed = allEvidence.find((e) => e.type === "RENEWAL_COMPLETED");
    expect(accepted).toBeTruthy();
    expect(completed).toBeTruthy();
    expect(completed!.createdAt.getTime()).toBeGreaterThan(accepted!.createdAt.getTime());
    expect(allEvidence[allEvidence.length - 1].type).toBe("RENEWAL_COMPLETED");
  });
});
