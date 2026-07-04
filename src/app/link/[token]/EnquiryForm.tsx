"use client";

import { useActionState } from "react";
import { Field, FormStatus, inputClass } from "@/components/ui";
import { submitEnquiryAction } from "./actions";

// Public "register interest" form on a shared listing. No account; on success the
// workspace is notified and an ENQUIRY_RECEIVED event is recorded server-side.
export function EnquiryForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitEnquiryAction, { status: "idle" as const });

  if (state.status === "done") {
    return (
      <p className="rounded-md bg-verde-100 px-4 py-3 text-sm text-verde-700">
        Thanks — your enquiry has been sent to the managing office.
      </p>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <Field label="Your name" required>
        <input name="name" required className={inputClass} />
      </Field>
      <Field label="Email (optional)">
        <input name="email" type="email" className={inputClass} />
      </Field>
      <Field label="Phone (optional)">
        <input name="phone" className={inputClass} />
      </Field>
      <Field label="Your message (optional)">
        <textarea name="message" rows={3} className={inputClass} />
      </Field>
      {state.status === "error" && <FormStatus error={state.message} />}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-navy-900 px-4 py-2 text-sm font-medium text-ivory-50 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Register interest"}
      </button>
    </form>
  );
}
