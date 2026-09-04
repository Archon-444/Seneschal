"use client";

import { useActionState } from "react";
import { inputClass } from "@/components/ui";
import { resetPasswordAction, type ResetState } from "../../actions";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<ResetState, FormData>(resetPasswordAction, null);

  return (
    <form action={formAction} className="rounded border border-ivory-300 bg-white p-6">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="new-password" className="mb-1 block text-[12px] font-medium text-navy-700">
        New password
      </label>
      <input
        id="new-password"
        name="password"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        autoFocus
        aria-describedby={state?.error ? "reset-error reset-hint" : "reset-hint"}
        aria-invalid={state?.error ? true : undefined}
        className={inputClass}
      />
      <label htmlFor="confirm-password" className="mb-1 mt-4 block text-[12px] font-medium text-navy-700">
        Confirm password
      </label>
      <input
        id="confirm-password"
        name="confirm"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        aria-describedby={state?.error ? "reset-error reset-hint" : "reset-hint"}
        aria-invalid={state?.error ? true : undefined}
        className={inputClass}
      />
      <p id="reset-hint" className="mt-2 text-xs text-muted">
        At least 10 characters.
      </p>
      {state?.error && (
        <p id="reset-error" className="mt-2 text-sm text-claret-500" role="alert">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded bg-navy-800 py-2 text-sm font-medium text-ivory-50 hover:bg-navy-700 disabled:opacity-50"
      >
        {pending ? "…" : "Set password and sign in"}
      </button>
    </form>
  );
}
