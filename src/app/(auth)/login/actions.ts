"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestOtp, verifyOtp } from "@/server/auth";
import { SESSION_COOKIE, homePathFor, requireCtx } from "@/server/auth/request";
import { consumeRateLimit } from "@/server/services/rateLimit";
import { dispatchPending } from "@/server/outbox";
import { handlers } from "@/server/outbox/runner";

export type LoginState =
  | { step: "email"; error?: string }
  | { step: "code"; email: string; error?: string };

// H8: per-IP cap on OTP requests (durable, survives serverless cold starts). The
// per-email cooldown in requestOtp stops inbox flooding; this stops an IP from
// spraying requests across many addresses. Generic message — IP-based, so it
// reveals nothing about which emails exist.
const OTP_IP_LIMIT = 10;
const OTP_IP_WINDOW_MS = 10 * 60_000;

export async function requestOtpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { step: "email", error: "Enter your email." };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim() || "unknown";
  const rl = await consumeRateLimit(`otp-ip:${ip}`, OTP_IP_LIMIT, OTP_IP_WINDOW_MS);
  if (!rl.ok) return { step: "email", error: "Too many attempts. Please wait a few minutes and try again." };
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
