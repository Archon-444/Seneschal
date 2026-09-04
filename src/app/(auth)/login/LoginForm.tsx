"use client";

import { useActionState } from "react";
import Link from "next/link";
import { inputClass } from "@/components/ui";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, null);

  return (
    <form action={formAction} className="rounded border border-ivory-300 bg-white p-6">
      <label htmlFor="login-email" className="mb-1 block text-[12px] font-medium text-navy-700">
        Email address
      </label>
      <input
        id="login-email"
        name="email"
        type="email"
        required
        autoFocus
        autoComplete="username"
        placeholder="you@example.com"
        className={inputClass}
      />
      <label htmlFor="login-password" className="mb-1 mt-4 block text-[12px] font-medium text-navy-700">
        Password
      </label>
      <input
        id="login-password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        aria-invalid={state?.error ? true : undefined}
        aria-describedby={state?.error ? "login-error" : undefined}
        className={inputClass}
      />
      {state?.error && (
        <p id="login-error" className="mt-2 text-sm text-claret-500" role="alert">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded bg-navy-800 py-2 text-sm font-medium text-ivory-50 hover:bg-navy-700 disabled:opacity-50"
      >
        {pending ? "…" : "Sign in"}
      </button>
      <p className="mt-3 text-center text-xs text-muted">
        <Link href="/login/forgot" className="text-navy-700 underline-offset-2 hover:underline">
          Forgot password
        </Link>
      </p>
    </form>
  );
}
