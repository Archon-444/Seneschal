import { describe, expect, it } from "vitest";
import * as Prisma from "@prisma/client";
import { BADGE_TONES } from "@/components/badgeTones";

// Every status enum that renders as a <Badge> must have an explicit tone, so no
// real status silently falls back to the neutral default. Importing the enums
// from Prisma means new enum values are caught here automatically — the same
// "structural guard over convention" discipline as the other static tests.

const BADGE_ENUMS: Record<string, Record<string, string>> = {
  TenancyStatus: Prisma.TenancyStatus,
  PaymentStatus: Prisma.PaymentStatus,
  ProofStatus: Prisma.ProofStatus,
  DeadlineStatus: Prisma.DeadlineStatus,
  TaskStatus: Prisma.TaskStatus,
  ExtractionStatus: Prisma.ExtractionStatus,
  ImportStatus: Prisma.ImportStatus,
  ImportRowStatus: Prisma.ImportRowStatus,
  ListingStatus: Prisma.ListingStatus,
  PassportStatus: Prisma.PassportStatus,
  EnquiryStatus: Prisma.EnquiryStatus,
  ViewingStatus: Prisma.ViewingStatus,
  ContractPackStatus: Prisma.ContractPackStatus,
  MoveInStatus: Prisma.MoveInStatus,
  OfferStatus: Prisma.OfferStatus,
  NoticeStatus: Prisma.NoticeStatus,
  RenewalStatus: Prisma.RenewalStatus,
  FlagStatus: Prisma.FlagStatus,
  Severity: Prisma.Severity,
  ApprovalDecision: Prisma.ApprovalDecision,
  MaintStatus: Prisma.MaintStatus,
};

describe("badge tones — every badge-rendered status enum value has an explicit tone", () => {
  for (const [name, e] of Object.entries(BADGE_ENUMS)) {
    it(`${name} is fully covered`, () => {
      const missing = Object.values(e).filter((v) => !(v in BADGE_TONES));
      expect(missing, `${name} missing badge tones: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
