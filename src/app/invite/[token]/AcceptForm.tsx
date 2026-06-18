"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptState } from "./actions";
import { Button, Field, inputClass } from "@/components/ui";

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<AcceptState, FormData>(acceptInviteAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="Your name">
        <input name="name" className={inputClass} required />
      </Field>
      <Field label="Confirm your email">
        <input name="confirmEmail" type="email" className={inputClass} placeholder={email} required />
      </Field>
      {state?.error && <p className="text-sm text-claret-700">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Accepting…" : "Accept invitation"}
      </Button>
    </form>
  );
}
