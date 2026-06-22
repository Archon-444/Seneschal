import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import { acceptOffer, mintRenewedTenancy, openRenewalCase, proposeOffer } from "@/server/services/renewals";

// PR-pilot P0-1 — renewal terminal mutations must be atomic and singular under
// concurrency. Each test fires the same operation twice (or N times) in parallel
// and asserts exactly one winner, with the DB left in a single, consistent state.
// The guards under test: the conditional claim inside mintRenewedTenancy, the
// RenewalCase_active_unique partial index behind openRenewalCase, and the guarded
// claim + Offer_one_accepted_per_case partial index behind acceptOffer.

let W: TestActor;
let tenancyId: string;

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

const TERMINAL: Prisma.RenewalCaseWhereInput = { status: { notIn: ["RENEWED", "DECLINED", "LAPSED"] } };

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Concurrency WS");
  const client = await clients.createClient(W.ctx, { displayName: "Race Co" });
  const property = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    community: "Business Bay",
    unitNo: "3301",
  });
  const tenancy = await tenancies.createTenancy(W.ctx, {
    propertyId: property.id,
    startDate: daysFromNow(-305),
    endDate: daysFromNow(60),
    annualRent: 80_000,
  });
  tenancyId = tenancy.id;
});

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

const mintArgs = (renewalCaseId: string) => ({
  renewalCaseId,
  startDate: daysFromNow(61),
  endDate: daysFromNow(425),
  annualRent: 84_000,
});

describe("renewal concurrency", () => {
  it("mintRenewedTenancy — two concurrent mints yield exactly one successor", async () => {
    const rc = await makeAgreedCase();

    const results = await Promise.allSettled([
      mintRenewedTenancy(W.ctx, mintArgs(rc.id)),
      mintRenewedTenancy(W.ctx, mintArgs(rc.id)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);

    // Exactly one successor tenancy points at the predecessor, and the case
    // references that single successor.
    const successors = await prisma.tenancy.count({ where: { renewsFromTenancyId: tenancyId } });
    expect(successors).toBe(1);
    const reloaded = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(reloaded!.status).toBe("RENEWED");
    expect(reloaded!.renewedTenancyId).not.toBeNull();
  });

  it("openRenewalCase — N concurrent opens collapse to one active case", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => openRenewalCase(W.ctx, tenancyId)),
    );
    // Every caller observes the same case (idempotent contract holds under race).
    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(1);

    const active = await prisma.renewalCase.count({ where: { tenancyId, ...TERMINAL } });
    expect(active).toBe(1);
    // Only one assessment-created evidence row was emitted (losers must not emit).
    const created = await prisma.evidenceEvent.count({
      where: { tenancyId, type: "RENEWAL_ASSESSMENT_CREATED" },
    });
    expect(created).toBe(1);
  });

  it("acceptOffer — two competing open offers, only one is accepted", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const o1 = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 84_000,
      paymentSchedule: "4 cheques",
    });
    // A second, independently-open offer on the same case (bypassing the propose
    // supersede) simulates two competing proposals racing to acceptance.
    const o2 = await prisma.offer.create({
      data: {
        workspaceId: W.workspaceId,
        renewalCaseId: rc.id,
        tenancyId,
        version: o1.version + 1,
        party: "LANDLORD",
        annualRent: new Prisma.Decimal(82_000),
        paymentSchedule: "2 cheques",
        status: "SENT",
      },
    });

    const results = await Promise.allSettled([acceptOffer(W.ctx, o1.id), acceptOffer(W.ctx, o2.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const accepted = await prisma.offer.count({ where: { renewalCaseId: rc.id, status: "ACCEPTED" } });
    expect(accepted).toBe(1);
    const reloaded = await prisma.renewalCase.findUnique({ where: { id: rc.id } });
    expect(reloaded!.status).toBe("AGREED");
    expect(reloaded!.decidedOfferId).not.toBeNull();
  });

  it("acceptOffer — accepting the same offer twice concurrently wins once", async () => {
    const rc = await openRenewalCase(W.ctx, tenancyId);
    const offer = await proposeOffer(W.ctx, {
      renewalCaseId: rc.id,
      party: "LANDLORD",
      annualRent: 84_000,
      paymentSchedule: "4 cheques",
    });

    const results = await Promise.allSettled([acceptOffer(W.ctx, offer.id), acceptOffer(W.ctx, offer.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const accepted = await prisma.offer.count({ where: { renewalCaseId: rc.id, status: "ACCEPTED" } });
    expect(accepted).toBe(1);
  });
});
