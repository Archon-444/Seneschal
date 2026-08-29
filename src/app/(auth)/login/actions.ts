"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginWithPassword, requestPasswordReset, resetPassword, revokeSession } from "@/server/auth";
import {
  SESSION_COOKIE,
  establishSessionCookie,
  landSignedIn,
} from "@/server/auth/request";
import { consumeRateLimit } from "@/server/services/rateLimit";
import { dispatchPending } from "@/server/outbox";
import { handlers } from "@/server/outbox/runner";

export type LoginState = { error?: string } | null;
export type ResetRequestState = { ok?: true; error?: string } | null;
export type ResetState = { error?: string } | null;

const LOGIN_IP_LIMIT = 20;
const LOGIN_IP_WINDOW_MS = 10 * 60_000;
const RESET_IP_LIMIT = 10;
const RESET_IP_WINDOW_MS = 10 * 60_000;

async function clientMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for") ?? undefined,
    device: h.get("user-agent") ?? undefined,
  };
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim() || "unknown";
  const rl = await consumeRateLimit(`login-ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS);
  if (!rl.ok) return { error: "Too many attempts. Please wait a few minutes and try again." };

  const result = await loginWithPassword(email, password, await clientMeta());
  if ("error" in result) return { error: result.error };

  await establishSessionCookie(result.sessionToken);
  return landSignedIn();
}

export async function requestResetAction(_prev: ResetRequestState, formData: FormData): Promise<ResetRequestState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email." };
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim() || "unknown";
  const rl = await consumeRateLimit(`reset-ip:${ip}`, RESET_IP_LIMIT, RESET_IP_WINDOW_MS);
  if (!rl.ok) return { error: "Too many attempts. Please wait a few minutes and try again." };
  await requestPasswordReset(email);
  await dispatchPending(handlers);
  return { ok: true };
}

export async function resetPasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) return { error: "Passwords do not match." };
  const result = await resetPassword(token, password, await clientMeta());
  if ("error" in result) return { error: result.error };
  await establishSessionCookie(result.sessionToken);
  return landSignedIn();
}

export async function logoutAction() {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
