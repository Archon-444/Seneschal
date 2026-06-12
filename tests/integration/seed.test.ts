import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers";
import { runSeed } from "@/server/seed";

describe("runSeed", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("attaches a valid adminEmail as FIDUCIARY in the Farina workspace", async () => {
    await runSeed({ adminEmail: " Pilot@Example.COM " });
    const user = await prisma.user.findUnique({ where: { email: "pilot@example.com" } });
    expect(user).toBeTruthy();
    const membership = await prisma.membership.findFirst({
      where: { userId: user!.id, role: "FIDUCIARY", revokedAt: null },
    });
    expect(membership).toBeTruthy();
  });

  it("rejects a blank adminEmail without creating an empty-email user", async () => {
    await expect(runSeed({ adminEmail: "   " })).rejects.toThrow(/not a valid email/);
    expect(await prisma.user.findUnique({ where: { email: "" } })).toBeNull();
  });

  it("is idempotent for the same adminEmail", async () => {
    await runSeed({ adminEmail: "pilot@example.com" });
    await runSeed({ adminEmail: "pilot@example.com" });
    expect(await prisma.user.count({ where: { email: "pilot@example.com" } })).toBe(1);
    expect(
      await prisma.membership.count({
        where: { user: { email: "pilot@example.com" }, role: "FIDUCIARY" },
      }),
    ).toBe(1);
  });
});
