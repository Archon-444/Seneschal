"use client";

import { useActionState } from "react";
import { inputClass } from "@/components/ui";
import { resetPasswordAction, type ResetState } from "../../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ResetState, FormData>(resetPasswordAction, null);

  return (
    <form action={formAction} className="rounded-lg border border-ivory-300 bg-white p-6 shadow-sm">
      <input type="hidden" name="token" value={token} />
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy-500">
        New password
      </label>
      <input
        name="password"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        autoFocus
        className={inputClass}
      />
      <label className="mb-1 mt-4 block text-xs font-medium uppercase tracking-wide text-navy-500">
        Confirm password
      </label>
      <input name="confirm" type="password" required minLength={10} autoComplete="new-password" className={inputClass} />
      <p className="mt-2 text-xs text-muted">At least 10 characters.</p>
      {state?.error && <p className="mt-2 text-sm text-claret-500">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-md bg-navy-800 py-2 text-sm font-medium text-ivory-50 hover:bg-navy-700 disabled:opacity-50"
      >
        {pending ? "…" : "Set password and sign in"}
      </button>
    </form>
  );
}
