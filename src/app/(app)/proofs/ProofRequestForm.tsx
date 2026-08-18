"use client";

import { useMemo, useState } from "react";
import type { ProofRequestScopeOption } from "@/server/services/proofs";
import { Field, FormSection, inputClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createProofRequestAction } from "../actions";

export function ProofRequestForm({ options }: { options: ProofRequestScopeOption[] }) {
  const [scope, setScope] = useState(options[0]?.value ?? "");
  const selected = useMemo(() => options.find((option) => option.value === scope), [options, scope]);

  return (
    <FormSection title="New proof request">
      {options.length === 0 ? (
        <p className="text-sm text-muted">
          No valid scopes with related assignees are available in your assignment.
        </p>
      ) : (
        <form action={createProofRequestAction} className="space-y-3">
          <Field label="Title" required>
            <input name="title" required className={inputClass} placeholder="Upload proof: cheque 4 received" />
          </Field>
          <Field label="Required evidence" required>
            <textarea
              name="requiredEvidence"
              required
              rows={2}
              className={inputClass}
              placeholder="Photo of deposit slip or bank confirmation"
            />
          </Field>
          <Field label="Related to" required>
            <select
              name="scope"
              required
              className={inputClass}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Assign to contact" required>
            <select name="assignedContactId" required className={inputClass} defaultValue="" key={scope}>
              <option value="" disabled>Select…</option>
              {selected?.assignees.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.label} ({contact.kind})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due date">
            <input name="dueAt" type="date" className={inputClass} />
          </Field>
          <SubmitButton pendingLabel="Creating…">Create &amp; send secure link</SubmitButton>
        </form>
      )}
    </FormSection>
  );
}
