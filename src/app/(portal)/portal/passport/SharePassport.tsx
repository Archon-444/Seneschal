"use client";

import { useActionState } from "react";
import { Button, Field, inputClass } from "@/components/ui";
import { sharePassportAction } from "./actions";

// Consent-gated share. The tenant must tick consent; the server records the
// ConsentRecord before minting the link and returns the one-time URL shown here.
export function SharePassport() {
  const [state, action, pending] = useActionState(sharePassportAction, {});
  return (
    <form action={action} className="space-y-3">
      <Field label="Recipient (optional)">
        <input name="recipientName" className={inputClass} placeholder="Agent or landlord name" />
      </Field>
      <label className="flex items-start gap-2 text-sm text-navy-700">
        <input type="checkbox" name="consent" className="mt-1" />
        <span>I consent to sharing my passport and documents with the recipient of this link.</span>
      </label>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Creating…" : "Create secure link"}
      </Button>
      {state.error && <p className="text-sm text-claret-700">{state.error}</p>}
      {state.url && (
        <input
          readOnly
          value={state.url}
          onFocus={(e) => e.currentTarget.select()}
          className={inputClass}
          aria-label="Passport share link"
        />
      )}
    </form>
  );
}
