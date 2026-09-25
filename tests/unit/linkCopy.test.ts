import { describe, expect, it } from "vitest";
import { COPY, errorPair, localesFor, monthsLabel, parseLinkLang } from "@/lib/linkCopy";
import { formatAed } from "@/lib/money";
import { localizedNoticeVersion } from "@/lib/noticeLocale";
import { formatDubaiDate } from "@/server/calculators/dates";
import { renderTenantOfferPositionNote } from "@/server/services/renewalTemplates";

describe("link page language", () => {
  it("defaults to both languages and accepts only en or ar", () => {
    expect(parseLinkLang(undefined)).toBe("both");
    expect(parseLinkLang("en")).toBe("en");
    expect(parseLinkLang("ar")).toBe("ar");
    expect(parseLinkLang("fr")).toBe("both");
    expect(parseLinkLang(["ar"])).toBe("both");
  });

  it("renders English first when both are shown", () => {
    expect(localesFor("both")).toEqual(["en", "ar"]);
    expect(localesFor("ar")).toEqual(["ar"]);
  });

  it("agrees Arabic month counts with the number", () => {
    expect(monthsLabel(1).ar).toBe("شهر واحد");
    expect(monthsLabel(2).ar).toBe("شهران");
    expect(monthsLabel(6).ar).toBe("6 أشهر");
    expect(monthsLabel(12).ar).toBe("12 شهراً");
    expect(monthsLabel(12).en).toBe("12 months");
  });

  it("translates fixed server messages and passes others through", () => {
    expect(errorPair("This link is no longer available.").ar).toBe("هذا الرابط لم يعد متاحاً.");
    expect(errorPair("slip.jpg is larger than 15 MB.").ar).toBe("slip.jpg is larger than 15 MB.");
  });

  it("keeps the English strings the e2e suite and receipts rely on", () => {
    expect(COPY.acceptedTitle.en).toMatch(/acceptance has been recorded/i);
    expect(COPY.filesReceived(1).en).toMatch(/file was received and recorded/i);
    expect(COPY.unavailableBody.en).toMatch(/expired, been used already, or been withdrawn/i);
  });
});

describe("locale-aware formatting", () => {
  it("formats AED with the currency before the amount in English and the dirham after it in Arabic", () => {
    expect(formatAed(78_000)).toBe("AED 78,000");
    expect(formatAed("79200.00", "ar")).toBe("79,200 درهم");
  });

  it("formats Dubai dates with Arabic month names and Latin digits", () => {
    expect(formatDubaiDate(new Date("2027-01-16"), "ar")).toBe("16 يناير 2027");
    expect(formatDubaiDate(new Date("2027-01-16"))).toBe("16 Jan 2027");
  });
});

describe("consent notice versions", () => {
  it("keeps English records unchanged and names other renditions", () => {
    expect(localizedNoticeVersion("privacy_notice_v1")).toBe("privacy_notice_v1");
    expect(localizedNoticeVersion("privacy_notice_v1", "en")).toBe("privacy_notice_v1");
    expect(localizedNoticeVersion("privacy_notice_v1", "ar")).toBe("privacy_notice_v1+ar");
    expect(localizedNoticeVersion("privacy_notice_v1", "both")).toBe("privacy_notice_v1+en-ar");
  });
});

describe("tenant offer position note", () => {
  const base = {
    proposedRent: 78_000,
    currentRent: 72_000,
    indexIndicatedMaximum: 79_200,
    indexAverage: 96_000,
    capturedOn: { en: "28 Aug 2026", ar: "28 أغسطس 2026" },
    sourceName: { en: "Smart Rental Index", ar: "مؤشر الإيجارات الذكي" },
    provisional: false,
  };

  it("states the distance to the maximum and the gap to the index in both languages", () => {
    const note = renderTenantOfferPositionNote(base);
    expect(note.en).toContain("AED 1,200 below the index-indicated maximum of AED 79,200");
    expect(note.en).toContain("25.0% below it");
    expect(note.ar).toContain("1,200 درهم");
    expect(note.ar).toContain("79,200 درهم");
    expect(note.ar).toContain("25.0%");
  });

  it("flags an offer above the maximum", () => {
    const note = renderTenantOfferPositionNote({ ...base, proposedRent: 82_000 });
    expect(note.en).toContain("AED 2,800 above the index-indicated maximum");
    expect(note.ar).toContain("أعلى");
  });

  it("never calls a provisional estimate an official figure", () => {
    const note = renderTenantOfferPositionNote({ ...base, provisional: true });
    expect(note.en).toContain("not an official index figure");
    expect(note.en).not.toContain("Smart Rental Index");
  });
});
