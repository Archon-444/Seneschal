import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { contactReferrers } from "@/server/services/contactReferences";

// Import rollback archives the contacts a batch created, but only when nothing
// still points at them (MEDIUM-7). The referrer set is derived from the Prisma
// schema so a newly added `*ContactId` column is covered automatically; these
// tests are the proof that the derivation actually matches the schema and that
// every delegate it names resolves on the client.

describe("contact referrer derivation", () => {
  const refs = contactReferrers();

  it("covers every *ContactId scalar column in the schema", () => {
    const fromSchema: string[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      for (const field of model.fields) {
        if (field.kind === "scalar" && /ContactId$/.test(field.name)) {
          fromSchema.push(`${model.name}.${field.name}`);
        }
      }
    }
    const covered = refs.flatMap((r) => r.fields.map((f) => `${r.model}.${f}`));
    expect(covered.sort()).toEqual(fromSchema.sort());
    expect(covered.length).toBeGreaterThan(0);
  });

  it("names the referrers that would break if a live contact were archived", () => {
    const covered = refs.flatMap((r) => r.fields.map((f) => `${r.model}.${f}`));
    // Not an exhaustive list — the assertion above is. These are spelled out so
    // a schema change that drops one is visible in the diff.
    for (const expected of [
      "Property.ownerContactId",
      "Tenancy.landlordContactId",
      "Tenancy.tenantContactId",
      "ProofRequest.assignedContactId",
      "Membership.subjectContactId",
      "MaintenanceCase.tenantContactId",
      "Invoice.vendorContactId",
    ]) {
      expect(covered).toContain(expected);
    }
  });

  it("resolves a countable Prisma delegate for every referrer", () => {
    const client = prisma as unknown as Record<string, { count?: unknown } | undefined>;
    for (const ref of refs) {
      expect(typeof client[ref.delegate]?.count, `${ref.model} -> ${ref.delegate}`).toBe("function");
    }
  });

  it("marks the soft-deletable referrers so archived rows are not treated as live", () => {
    const byModel = Object.fromEntries(refs.map((r) => [r.model, r]));
    expect(byModel.Property.hasArchivedAt).toBe(true);
    expect(byModel.Tenancy.hasArchivedAt).toBe(true);
    expect(byModel.ProofRequest.hasArchivedAt).toBe(false);
  });
});
