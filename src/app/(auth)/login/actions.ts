"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requestOtp, verifyOtp } from "@/server/auth";
import { SESSION_COOKIE } from "@/server/auth/request";
import { dispatchPending } from "@/server/outbox";
import { handlers } from "@/server/outbox/runner";

export type LoginState =
  | { step: "email"; error?: string }
  | { step: "code"; email: string; error?: string };

export async function requestOtpAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { step: "email", error: "Enter your email." };
  await requestOtp(email);
  // dev convenience: flush the outbox so the console email appears immediately
  if (process.env.NODE_ENV !== "production") await dispatchPending(handlers);
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
  redirect("/dashboard");
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
