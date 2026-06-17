"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestOtp, verifyOtp } from "@/server/auth";
import { SESSION_COOKIE, homePathFor, requireCtx } from "@/server/auth/request";
import { dispatchPending } from "@/server/outbox";
import { handlers } from "@/server/outbox/runner";

export type LoginState =
  | { step: "email"; error?: string }
  | { step: "code"; email: string; error?: string };

export async function requestOtpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { step: "email", error: "Enter your email." };
  await requestOtp(email);
  // No resident worker on serverless: flush the outbox inline so the OTP email
  // leaves immediately. The cron route re-dispatches anything that fails here.
  await dispatchPending(handlers);
  return { step: "code", email };
}

export async function verifyOtpAction(prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const code = String(formData.get("code") ?? "");
  const h = await headers();
  const result = await verifyOtp(email, code, {
    ip: h.get("x-forwarded-for") ?? undefined,
    device: h.get("user-agent") ?? undefined,
  });
  if (!result) return { step: "code", email, error: "Invalid or expired code." };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });
  // Land each role on its own home: personas → /portal, operators → /dashboard.
  // The cookie we just set is readable by requireCtx within this same request.
  let target = "/dashboard";
  try {
    const ctx = await requireCtx();
    target = homePathFor(ctx.role);
  } catch {
    // No membership yet — fall back to the operator home (its layout re-guards).
  }
  redirect(target);
  return prev;
}

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const { revokeSession } = await import("@/server/auth");
    await revokeSession(token);
  }
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
