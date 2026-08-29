"use client";

import { useActionState, useState } from "react";
import { provisionAction, type ProvisionState } from "../actions";
import { Field, FormStatus, LinkButton, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import {
  LICENCE_COPY,
  LICENCE_LABEL,
  type ProvisionableLicence,
} from "@/lib/licences";

export function ProvisionForm() {
  const [state, action] = useActionState<ProvisionState, FormData>(provisionAction, null);
  const [licence, setLicence] = useState<ProvisionableLicence>("FIDUCIARY");
  const copy = LICENCE_COPY[licence];

  if (state?.ok) {
    const who = state.licence === "OWNER" ? "owner" : "office principal";
    return (
      <div className="space-y-4">
        <p className="text-sm text-verde-700">
          {LICENCE_LABEL[state.licence]} workspace provisioned. Send the {who} this one-time
          invite link — it is shown once and never stored. They choose a password when they
          accept. The workspace is empty until they populate it.
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
      <fieldset>
        <legend className="t-label mb-2 block text-muted">
          Licence
          <span className="ml-0.5 text-gold-700" aria-hidden="true">
            *
          </span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["FIDUCIARY", "OWNER"] as const).map((code) => {
            const selected = licence === code;
            const item = LICENCE_COPY[code];
            return (
              <label
                key={code}
                className={`cursor-pointer rounded-xl border p-3 transition ${
                  selected
                    ? "border-gold-500 bg-gold-100/60 shadow-sm"
                    : "border-line bg-white hover:border-gold-500/50"
                }`}
              >
                <input
                  type="radio"
                  name="type"
                  value={code}
                  checked={selected}
                  onChange={() => setLicence(code)}
                  className="sr-only"
                />
                <span className="block font-display text-base text-navy-900">{item.label}</span>
                <span className="mt-0.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-gold-700">
                  {item.kicker}
                </span>
                <span className="mt-2 block text-xs text-muted">{item.body}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <Field label={copy.principalLabel} required hint={copy.principalHint}>
        <input name="customerName" className={inputClass} required />
      </Field>
      <Field label={`${copy.principalLabel} email`} required>
        <input name="customerEmail" type="email" className={inputClass} required />
      </Field>
      <FormStatus error={state && !state.ok ? state.error : undefined} />
      <SubmitButton pendingLabel="Provisioning…">Provision {copy.label.toLowerCase()} workspace</SubmitButton>
    </form>
  );
}
