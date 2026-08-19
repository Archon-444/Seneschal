import { describe, expect, it } from "vitest";
import { diffCorrections } from "@/app/(app)/imports/review/[jobId]/corrections";
import type { ExtractionFields } from "@/server/services/extraction";
import type { ImportRowData } from "@/server/services/imports";

// The corrections diff is what turns a reviewer's edit into a FIELD_CORRECTED
// evidence event. It used to be an allowlist of 14 scalars, so party sub-fields
// and every payment item were silently excluded — and the review screen makes
// cheque amounts and due dates editable. A changed cheque that leaves no
// correction in the trail is the failure this guards.

const field = (value: unknown) => ({ value, confidence: 0.9 });

const original: ExtractionFields = {
  community: field("Dubai Marina"),
  startDate: field("2025-09-16"),
  endDate: field("2026-09-15"),
  annualRent: field(72000),
  landlordEmiratesId: field("784-1980-1234567-1"),
  tenantEmail: field("tenant@old.example"),
  paymentItems: field([
    { seq: 1, dueDate: "2025-09-16", amount: 36000, instrument: "CHEQUE", chequeNo: "0001" },
    { seq: 2, dueDate: "2026-03-16", amount: 36000, instrument: "CHEQUE", chequeNo: "0002" },
  ]),
};

const base: ImportRowData = {
  community: "Dubai Marina",
  startDate: "2025-09-16",
  endDate: "2026-09-15",
  annualRent: 72000,
  landlord: { emiratesId: "784-1980-1234567-1" },
  tenant: { email: "tenant@old.example" },
  paymentItems: [
    { seq: 1, dueDate: "2025-09-16", amount: 36000, instrument: "CHEQUE", chequeNo: "0001" },
    { seq: 2, dueDate: "2026-03-16", amount: 36000, instrument: "CHEQUE", chequeNo: "0002" },
  ],
};

describe("diffCorrections", () => {
  it("reports nothing when the reviewer changed nothing", () => {
    expect(diffCorrections(original, base)).toEqual({});
  });

  it("records an altered cheque amount", () => {
    const reviewed = {
      ...base,
      paymentItems: [{ ...base.paymentItems![0], amount: 3600 }, base.paymentItems![1]],
    };
    const diff = diffCorrections(original, reviewed);
    expect(diff["paymentItems.1.amount"]).toEqual({ from: 36000, to: 3600 });
  });

  it("records an altered due date", () => {
    const reviewed = {
      ...base,
      paymentItems: [{ ...base.paymentItems![0], dueDate: "2025-12-01" }, base.paymentItems![1]],
    };
    expect(diffCorrections(original, reviewed)["paymentItems.1.dueDate"]).toEqual({
      from: "2025-09-16",
      to: "2025-12-01",
    });
  });

  it("records a changed instrument", () => {
    const reviewed = {
      ...base,
      paymentItems: [{ ...base.paymentItems![0], instrument: "TRANSFER" as const }, base.paymentItems![1]],
    };
    expect(diffCorrections(original, reviewed)["paymentItems.1.instrument"]).toEqual({
      from: "CHEQUE",
      to: "TRANSFER",
    });
  });

  it("records party sub-field edits, which the old allowlist missed", () => {
    const reviewed: ImportRowData = {
      ...base,
      landlord: { emiratesId: "784-1990-7654321-9" },
      tenant: { email: "tenant@new.example" },
    };
    const diff = diffCorrections(original, reviewed);
    expect(diff.landlordEmiratesId).toEqual({ from: "784-1980-1234567-1", to: "784-1990-7654321-9" });
    expect(diff.tenantEmail).toEqual({ from: "tenant@old.example", to: "tenant@new.example" });
  });

  it("records a removed instalment", () => {
    const reviewed = { ...base, paymentItems: [base.paymentItems![0]] };
    const diff = diffCorrections(original, reviewed);
    expect(diff["paymentItems.2"]).toBeTruthy();
    expect(diff["paymentItems.2"].to).toBeNull();
  });

  it("still records plain scalar edits", () => {
    expect(diffCorrections(original, { ...base, annualRent: 84000 }).annualRent).toEqual({
      from: 72000,
      to: 84000,
    });
  });
});
