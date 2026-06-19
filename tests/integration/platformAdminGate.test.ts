import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "../helpers";
import { generateToken } from "@/server/crypto";
import { requirePlatformAdmin } from "@/server/auth/request";

// F-Admin §5 — the platform-admin door fails closed at the HANDLER, not only the layout. The
// /admin layout redirects a non-admin, but every platform server action (suspend/archive/
// unarchive/provision) re-gates with requirePlatformAdmin(). This proves that gate independently
// of the layout, by driving a real session through a mocked cookie jar.

const cookie = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "seneschal_session" && cookie.token ? { value: cookie.token } : undefined),
  }),
}));

async function signIn(opts: { isPlatformAdmin: boolean }): Promise<void> {
  const { token, tokenHash } = generateToken();
  const user = await prisma.user.create({
    data: { email: `u-${Date.now()}@seneschal.example`, name: "U", isPlatformAdmin: opts.isPlatformAdmin },
  });
  await prisma.session.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60_000) },
  });
  cookie.token = token;
}

describe("requirePlatformAdmin fails closed (handler re-gate)", () => {
  beforeEach(async () => {
    await resetDb();
    cookie.token = undefined;
  });

  it("throws 401 when there is no session", async () => {
    await expect(requirePlatformAdmin()).rejects.toMatchObject({ status: 401 });
  });

  it("throws 403 for a signed-in NON-platform-admin — the gate, not just the layout redirect", async () => {
    await signIn({ isPlatformAdmin: false });
    await expect(requirePlatformAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("resolves a scopeless PlatformAdminContext for a platform admin", async () => {
    await signIn({ isPlatformAdmin: true });
    await expect(requirePlatformAdmin()).resolves.toMatchObject({ kind: "platform" });
  });
});
