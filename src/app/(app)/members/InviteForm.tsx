"use client";

import { useActionState } from "react";
import { inviteAction, type InviteState } from "./actions";
import { Button, inputClass } from "@/components/ui";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, null);
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap gap-2">
        <input
          name="email"
          type="email"
          required
          placeholder="office.manager@org.example"
          className={`${inputClass} max-w-xs`}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Inviting…" : "Invite org-admin"}
        </Button>
      </form>
      {state?.ok && (
        <div className="text-sm">
          <p className="text-verde-700">Invite created. Share this one-time link — it is shown once:</p>
          <code className="mt-1 block break-all rounded-lg border border-line bg-ivory-100 p-2 text-xs text-navy-900">
            {state.url}
          </code>
        </div>
      )}
      {state && !state.ok && <p className="text-sm text-claret-700">{state.error}</p>}
    </div>
  );
}
