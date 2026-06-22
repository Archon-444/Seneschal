"use client";

import { useActionState } from "react";
import { provisionAction, type ProvisionState } from "../actions";
import { Field, FormStatus, LinkButton, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export function ProvisionForm() {
  const [state, action] = useActionState<ProvisionState, FormData>(provisionAction, null);

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
      <Field label="Organisation name" required>
        <input name="name" className={inputClass} required />
      </Field>
      <Field label="Workspace type">
        <select name="type" className={inputClass} defaultValue="FIDUCIARY">
          <option value="FIDUCIARY">Fiduciary</option>
          <option value="OWNER">Owner-landlord</option>
          <option value="OPERATOR">Operator</option>
        </select>
      </Field>
      <Field label="Principal name" required>
        <input name="customerName" className={inputClass} required />
      </Field>
      <Field label="Principal email" required>
        <input name="customerEmail" type="email" className={inputClass} required />
      </Field>
      <FormStatus error={state && !state.ok ? state.error : undefined} />
      <SubmitButton pendingLabel="Provisioning…">Provision workspace</SubmitButton>
    </form>
  );
}
