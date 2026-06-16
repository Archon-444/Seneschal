"use client";

import { useActionState } from "react";
import { submitEnquiryAction } from "./actions";

// Public "register interest" form on a shared listing. No account; on success the
// workspace is notified and an ENQUIRY_RECEIVED event is recorded server-side.
export function EnquiryForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(submitEnquiryAction, { status: "idle" as const });

  if (state.status === "done") {
    return (
      <p className="rounded-md bg-verde/10 px-4 py-3 text-sm text-verde">
        Thanks — your enquiry has been sent to the managing office.
      </p>
    );
  }

  const field = "w-full rounded-md border border-ivory-300 px-3 py-2 text-sm";
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <input name="name" required placeholder="Your name" className={field} />
      <input name="email" type="email" placeholder="Email (optional)" className={field} />
      <input name="phone" placeholder="Phone (optional)" className={field} />
      <textarea name="message" rows={3} placeholder="Your message (optional)" className={field} />
      {state.status === "error" && <p className="text-sm text-claret">{state.message}</p>}
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
