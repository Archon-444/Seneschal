"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptState } from "./actions";
import { Field, FormStatus, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState<AcceptState, FormData>(acceptInviteAction, null);
  if (state && "awaitingAssignment" in state) {
    return (
      <p className="text-sm text-navy-700" role="status">
        Your password is set. Ask your office to assign your book, then sign in.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="Your name">
        <input name="name" className={inputClass} required autoComplete="name" />
      </Field>
      <Field label="Confirm your email">
        <input
          name="confirmEmail"
          type="email"
          className={inputClass}
          placeholder={email}
          required
          autoComplete="username"
        />
      </Field>
      <Field label="Password" hint="At least 10 characters.">
        <input name="password" type="password" className={inputClass} required minLength={10} autoComplete="new-password" />
      </Field>
      <Field label="Confirm password">
        <input name="confirm" type="password" className={inputClass} required minLength={10} autoComplete="new-password" />
      </Field>
      <FormStatus error={state && "error" in state ? state.error : undefined} />
      <SubmitButton pendingLabel="Accepting…">Set password and join</SubmitButton>
    </form>
  );
}
