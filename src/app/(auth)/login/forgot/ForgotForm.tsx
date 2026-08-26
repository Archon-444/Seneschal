"use client";

import { useActionState } from "react";
import Link from "next/link";
import { inputClass } from "@/components/ui";
import { requestResetAction, type ResetRequestState } from "../actions";

export function ForgotForm() {
  const [state, formAction, pending] = useActionState<ResetRequestState, FormData>(requestResetAction, null);

  return (
    <form action={formAction} className="rounded-lg border border-ivory-300 bg-white p-6 shadow-sm">
      <p className="mb-3 text-sm text-navy-700">
        Enter the email on your account. If it matches, we will send a one-time reset link.
      </p>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy-500">
        Email address
      </label>
      <input name="email" type="email" required autoFocus autoComplete="username" className={inputClass} />
      {state?.error && <p className="mt-2 text-sm text-claret-500">{state.error}</p>}
      {state?.ok && (
        <p className="mt-2 text-sm text-verde-700" role="status">
          If that email has an account, a reset link is on its way.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-md bg-navy-800 py-2 text-sm font-medium text-ivory-50 hover:bg-navy-700 disabled:opacity-50"
      >
        {pending ? "…" : "Send reset link"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        <Link href="/login" className="text-navy-700 underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
