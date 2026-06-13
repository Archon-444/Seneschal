import { type AuthzContext, AuthzError, require_ } from "../authz";
import { recordAudit } from "../audit";
import { createContact, getContact } from "./contacts";
import { createProperty, getProperty } from "./properties";
import { createTenancy } from "./tenancies";
import { setPaymentSchedule } from "./payments";
import { toUtcDateOnly, daysBetween } from "../calculators/dates";

// Combined tenancy onboarding (Ejari-shaped). Creates landlord + tenant + asset
// + tenancy from one form, reusing existing records where chosen. Each step goes
// through the existing service so audit/evidence/deadlines/risk all apply; this
// orchestrator adds a single tenancy.onboard audit over the whole action.

export interface PartyInput {
  name: string;
  emiratesId?: string;
  email?: string;
  phone?: string;
  nationality?: string;
  company?: string;
  licenseNo?: string;
  licensingAuthority?: string;
}

export interface OnboardInput {
  // landlord: reuse an existing contact OR create a new one
  landlordContactId?: string;
  newLandlord?: PartyInput;
  // tenant: reuse OR create
  tenantContactId?: string;
  newTenant?: PartyInput;
  // asset: reuse a property OR create one
  propertyId?: string;
  newProperty?: {
    clientPrincipalId?: string;
    community: string;
    building?: string;
    unitNo?: string;
    propertyType?: string;
    bedrooms?: number;
    usage?: string;
    plotNo?: string;
    makaniNo?: string;
    dewaPremiseNo?: string;
    sizeSqm?: number;
  };
  // contract
  ejariNo?: string;
  startDate: Date;
  endDate: Date;
  annualRent: number;
  depositAmount?: number;
  noticePeriodDays?: number;
  paymentTermsNote?: string;
  /** auto-generate this many evenly-spaced cheques summing to annualRent */
  chequeCount?: number;
}

export interface OnboardResult {
  tenancyId: string;
  propertyId: string;
  landlordContactId: string | null;
  tenantContactId: string | null;
}

export async function onboardTenancy(ctx: AuthzContext, input: OnboardInput): Promise<OnboardResult> {
  // creating a tenancy is the gating capability; the sub-calls additionally
  // enforce contacts.write / properties.write for the new-record paths.
  require_(ctx, "tenancies.write");

  // ── landlord
  let landlordContactId: string | null = null;
  if (input.landlordContactId) {
    await getContact(ctx, input.landlordContactId); // workspace + existence check
    landlordContactId = input.landlordContactId;
  } else if (input.newLandlord?.name) {
    const c = await createContact(ctx, { kind: "OWNER", ...input.newLandlord });
    landlordContactId = c.id;
  }

  // ── tenant
  let tenantContactId: string | null = null;
  if (input.tenantContactId) {
    await getContact(ctx, input.tenantContactId);
    tenantContactId = input.tenantContactId;
  } else if (input.newTenant?.name) {
    const c = await createContact(ctx, { kind: "TENANT", ...input.newTenant });
    tenantContactId = c.id;
  }

  // ── asset
  let propertyId: string;
  if (input.propertyId) {
    await getProperty(ctx, input.propertyId);
    propertyId = input.propertyId;
  } else if (input.newProperty) {
    const p = await createProperty(ctx, {
      clientPrincipalId: input.newProperty.clientPrincipalId ?? null,
      community: input.newProperty.community,
      building: input.newProperty.building,
      unitNo: input.newProperty.unitNo,
      propertyType: input.newProperty.propertyType,
      bedrooms: input.newProperty.bedrooms,
      usage: input.newProperty.usage,
      plotNo: input.newProperty.plotNo,
      makaniNo: input.newProperty.makaniNo,
      dewaPremiseNo: input.newProperty.dewaPremiseNo,
      sizeSqm: input.newProperty.sizeSqm,
    });
    propertyId = p.id;
  } else {
    throw new AuthzError("Onboarding needs an existing property or new property details", 422);
  }

  // ── tenancy (records audit + deadlines + risk via the existing service)
  const tenancy = await createTenancy(ctx, {
    propertyId,
    landlordContactId: landlordContactId ?? undefined,
    tenantContactId: tenantContactId ?? undefined,
    ejariNo: input.ejariNo,
    startDate: input.startDate,
    endDate: input.endDate,
    annualRent: input.annualRent,
    depositAmount: input.depositAmount,
    noticePeriodDays: input.noticePeriodDays,
    paymentTermsNote: input.paymentTermsNote,
    source: "MANUAL",
  });

  // ── optional cheque schedule: even split, evenly spaced across the term,
  // last cheque absorbs rounding so Σ == annualRent (no CHEQUE_TOTAL_MISMATCH).
  if (input.chequeCount && input.chequeCount > 0) {
    const n = Math.min(input.chequeCount, 12);
    const termDays = daysBetween(input.startDate, input.endDate);
    const per = Math.round(input.annualRent / n);
    const items = Array.from({ length: n }, (_, i) => {
      const due = toUtcDateOnly(input.startDate);
      due.setUTCDate(due.getUTCDate() + Math.round((i * termDays) / n));
      const amount = i === n - 1 ? input.annualRent - per * (n - 1) : per;
      return { seq: i + 1, dueDate: due, amount };
    });
    await setPaymentSchedule(ctx, tenancy.id, items);
  }

  await recordAudit({
    workspaceId: ctx.workspaceId,
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    verb: "tenancy.onboard",
    objectType: "Tenancy",
    objectId: tenancy.id,
  });

  return { tenancyId: tenancy.id, propertyId, landlordContactId, tenantContactId };
}
