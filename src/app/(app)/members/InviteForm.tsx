"use client";

import { useActionState } from "react";
import { inviteAction, type InviteState } from "./actions";
import { Field, inputClass } from "@/components/ui";
import { INVITE_SEAT_COPY } from "@/lib/seats";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, null);
  return (
    <div className="space-y-3">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <Field label="Email" required>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="name@firm.example"
            className={inputClass}
          />
        </Field>
        <Field label="Seat" required>
          <select id="invite-seat" name="role" required defaultValue="MANAGER" className={inputClass}>
            {INVITE_SEAT_COPY.map((seat) => (
              <option key={seat.role} value={seat.role}>
                {seat.label}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="submit"
          disabled={pending}
          className="h-[42px] rounded-lg bg-navy-900 px-4 text-sm font-medium text-ivory-50 hover:brightness-110 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </form>
      <ul className="space-y-1 text-xs text-muted">
        {INVITE_SEAT_COPY.map((seat) => (
          <li key={seat.role}>
            <span className="font-medium text-navy-700">{seat.label}.</span> {seat.hint}
          </li>
        ))}
      </ul>
      {state?.ok && (
        <div className="text-sm">
          <p className="text-verde-700">Invite created. Share this one-time link — it is shown once:</p>
          <code className="mt-1 block break-all rounded-lg border border-line bg-ivory-100 p-2 text-xs text-navy-900">
            {state.url}
          </code>
        </div>
      )}
      {state && !state.ok && (
        <p className="text-sm text-claret-700" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
