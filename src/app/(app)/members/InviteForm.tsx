"use client";

import { useActionState, useState } from "react";
import { inviteAction, type InviteState } from "./actions";
import { Field, inputClass } from "@/components/ui";
import { emailForOwnerContactChoice, type InviteableSeat, type OwnerInviteContact } from "@/lib/seats";

export function InviteForm({
  seats,
  ownerContacts,
  canRecordContacts,
}: {
  seats: { role: InviteableSeat; label: string; hint: string }[];
  ownerContacts: OwnerInviteContact[];
  canRecordContacts: boolean;
}) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteAction, null);
  const [seat, setSeat] = useState<InviteableSeat>(
    seats.find((s) => s.role === "MANAGER")?.role ?? seats[0]?.role ?? "MANAGER",
  );
  const [email, setEmail] = useState("");
  const ownerSeat = seat === "LANDLORD";
  const availableOwners = ownerContacts.filter((c) => !c.taken);
  const ownerBlocked = ownerSeat && availableOwners.length === 0;

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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Seat" required>
          <select
            id="invite-seat"
            name="role"
            required
            className={inputClass}
            value={seat}
            onChange={(e) => setSeat(e.target.value as InviteableSeat)}
          >
            {seats.map((s) => (
              <option key={s.role} value={s.role}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="submit"
          disabled={pending || ownerBlocked}
          className="h-[42px] rounded-lg bg-navy-900 px-4 text-sm font-medium text-ivory-50 hover:brightness-110 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
        {ownerSeat && (
          <div className="sm:col-span-3">
            <Field
              label="Owner contact"
              required
              hint={
                ownerBlocked
                  ? canRecordContacts
                    ? "Record an OWNER contact on the directory first, then invite them."
                    : "Ask staff to record the owner contact, then invite them here."
                  : "They will see the properties recorded against this contact."
              }
            >
              <select
                id="invite-owner-contact"
                name="subjectContactId"
                required={ownerSeat}
                className={inputClass}
                disabled={ownerBlocked}
                defaultValue=""
                onChange={(e) => {
                  setEmail(emailForOwnerContactChoice(ownerContacts, e.target.value));
                }}
              >
                <option value="" disabled>
                  {ownerBlocked ? "No owner contact available" : "Select an owner…"}
                </option>
                {ownerContacts.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.taken}>
                    {c.name}
                    {c.email ? ` · ${c.email}` : ""}
                    {c.taken ? " · already seated" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
      </form>
      <ul className="space-y-1 text-xs text-muted">
        {seats.map((s) => (
          <li key={s.role}>
            <span className="font-medium text-navy-700">{s.label}.</span> {s.hint}
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
