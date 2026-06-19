"use client";

import { useActionState } from "react";
import { provisionAction, type ProvisionState } from "../actions";
import { Button, Field, LinkButton, inputClass } from "@/components/ui";

export function ProvisionForm() {
  const [state, action, pending] = useActionState<ProvisionState, FormData>(provisionAction, null);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-verde-700">
          Workspace provisioned. Send the principal this one-time invite link — it is shown once and
          never stored. They set their own credentials on first login.
        </p>
        <code className="block break-all rounded-lg border border-line bg-ivory-100 p-3 text-xs text-navy-900">
          {state.inviteUrl}
        </code>
        <LinkButton href="/admin" variant="primary">
          Back to console
        </LinkButton>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Field label="Organisation name">
        <input name="name" className={inputClass} required />
      </Field>
      <Field label="Workspace type">
        <select name="type" className={inputClass} defaultValue="FIDUCIARY">
          <option value="FIDUCIARY">Fiduciary</option>
          <option value="OWNER">Owner-landlord</option>
          <option value="OPERATOR">Operator</option>
        </select>
      </Field>
      <Field label="Principal name">
        <input name="customerName" className={inputClass} required />
      </Field>
      <Field label="Principal email">
        <input name="customerEmail" type="email" className={inputClass} required />
      </Field>
      {state && !state.ok && <p className="text-sm text-claret-700">{state.error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Provisioning…" : "Provision workspace"}
      </Button>
    </form>
  );
}
