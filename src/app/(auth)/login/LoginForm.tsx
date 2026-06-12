"use client";

import { useActionState } from "react";
import { requestOtpAction, verifyOtpAction, type LoginState } from "./actions";

const initial: LoginState = { step: "email" };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginReducer, initial);

  async function loginReducer(prev: LoginState, formData: FormData): Promise<LoginState> {
    if (prev.step === "email") return requestOtpAction(prev, formData);
    return verifyOtpAction(prev, formData);
  }

  return (
    <form action={formAction} className="rounded-lg border border-ivory-300 bg-white p-6 shadow-sm">
      {state.step === "email" ? (
        <>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy-500">
            Email address
          </label>
          <input
            name="email"
            type="email"
            required
            autoFocus
            placeholder="you@example.com"
            className="w-full rounded-md border border-ivory-300 px-3 py-2 text-sm focus:border-navy-300 focus:outline-none"
          />
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-navy-700">
            If <span className="font-medium">{state.email}</span> has an account, a 6-digit code was
            sent. Enter it below.
          </p>
          <input type="hidden" name="email" value={state.email} />
          <input
            name="code"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            placeholder="000000"
            className="figure w-full rounded-md border border-ivory-300 px-3 py-2 text-center text-2xl tracking-[0.5em] focus:border-navy-300 focus:outline-none"
          />
        </>
      )}
      {state.error && <p className="mt-2 text-sm text-claret-500">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-md bg-navy-800 py-2 text-sm font-medium text-ivory-50 hover:bg-navy-700 disabled:opacity-50"
      >
        {pending ? "…" : state.step === "email" ? "Send sign-in code" : "Sign in"}
      </button>
    </form>
  );
}
