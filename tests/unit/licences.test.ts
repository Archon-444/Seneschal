import { describe, expect, it } from "vitest";
import { WorkspaceType } from "@prisma/client";
import {
  isProvisionableLicence,
  LICENCE_COPY,
  LICENCE_LABEL,
  PROVISIONABLE_LICENCES,
} from "@/lib/licences";

describe("licences", () => {
  it("sells Landlord and Fiduciary only", () => {
    expect([...PROVISIONABLE_LICENCES]).toEqual(["FIDUCIARY", "OWNER"]);
    expect(isProvisionableLicence("FIDUCIARY")).toBe(true);
    expect(isProvisionableLicence("OWNER")).toBe(true);
    expect(isProvisionableLicence("OPERATOR")).toBe(false);
    expect(isProvisionableLicence("INTERNAL")).toBe(false);
  });

  it("names every WorkspaceType in English, with OWNER as Landlord", () => {
    for (const type of Object.values(WorkspaceType)) {
      expect(LICENCE_LABEL[type].length).toBeGreaterThan(0);
      expect(LICENCE_LABEL[type]).not.toBe(type);
    }
    expect(LICENCE_LABEL.OWNER).toBe("Landlord");
    expect(LICENCE_LABEL.FIDUCIARY).toBe("Fiduciary");
  });

  it("provision copy distinguishes the two licences", () => {
    expect(LICENCE_COPY.OWNER.body).toMatch(/already are the owner/i);
    expect(LICENCE_COPY.FIDUCIARY.body).toMatch(/client owners/i);
    expect(LICENCE_COPY.OWNER.principalLabel).toBe("Owner");
    expect(LICENCE_COPY.FIDUCIARY.principalLabel).toBe("Office principal");
  });
});
