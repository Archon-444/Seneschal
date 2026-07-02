"use client";

import { useActionState, useState } from "react";
import { Field, FormStatus, inputClass, Money } from "@/components/ui";
import { respondToOfferAction, type OfferResponseState } from "./actions";

export function TenantOfferForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    respondToOfferAction,
    { status: "idle" } as OfferResponseState,
  );
  const [mode, setMode] = useState<"choose" | "counter" | "ask">("choose");

  if (state.status === "done") {
    // Echo the response back as a receipt — the tenant should see exactly
    // what was recorded, not just that "something" was.
    return (
      <div className="space-y-2 rounded-md bg-verde-100 p-4 text-sm text-verde-700">
        <p className="font-semibold">
          {state.action === "ACCEPT"
            ? "Thank you — your acceptance has been recorded."
            : state.action === "COUNTER"
              ? "Thank you — your counter-proposal has been sent and recorded."
              : "Thank you — your question has been sent to the managing office."}
        </p>
        {state.action === "COUNTER" && state.annualRent != null && (
          <p>
            You proposed <Money amount={state.annualRent} />
            {state.paymentSchedule ? ` · ${state.paymentSchedule}` : ""}.
          </p>
        )}
        {state.note && (
          <p className="border-l-2 border-verde-500/40 pl-2 italic">“{state.note}”</p>
        )}
        <p>
          {state.action === "ACCEPT"
            ? "The managing office will be in touch to finalise."
            : "The managing office will come back to you on this."}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      {mode === "counter" && (
        <div className="space-y-3 rounded-md border border-ivory-300 bg-ivory-100 p-4">
          <Field label="Your proposed annual rent (AED)" required>
            <input name="annualRent" type="number" min="1" step="1" required className={inputClass} />
          </Field>
          <Field label="Payment schedule" required>
            <input name="paymentSchedule" required placeholder="e.g. 2 cheques" className={inputClass} />
          </Field>
        </div>
      )}

      {(mode === "counter" || mode === "ask") && (
        <Field label={mode === "ask" ? "Your question" : "Note (optional)"} required={mode === "ask"}>
          <textarea name="note" rows={2} required={mode === "ask"} className={inputClass} />
        </Field>
      )}

      <label className="flex items-start gap-2 text-xs text-navy-500">
        <input type="checkbox" name="optIn" className="mt-0.5" />
        <span>You may contact me on WhatsApp about this renewal.</span>
      </label>

      {state.status === "error" && <FormStatus error={state.message} />}

      {mode === "choose" ? (
        <div className="grid grid-cols-3 gap-2">
          <button type="submit" name="action" value="ACCEPT" disabled={pending}
            className="rounded-md bg-navy-800 py-3 text-sm font-medium text-ivory-50 hover:bg-navy-700 disabled:opacity-50">
            Accept
          </button>
          <button type="button" onClick={() => setMode("counter")}
            className="rounded-md bg-gold-100 py-3 text-sm font-medium text-gold-700 hover:brightness-95">
            Counter
          </button>
          <button type="button" onClick={() => setMode("ask")}
            className="rounded-md border border-ivory-300 py-3 text-sm font-medium text-navy-700 hover:bg-ivory-100">
            Ask
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="submit" name="action" value={mode === "counter" ? "COUNTER" : "ASK"} disabled={pending}
            className="flex-1 rounded-md bg-navy-800 py-3 text-sm font-medium text-ivory-50 hover:bg-navy-700 disabled:opacity-50">
            {pending ? "Sending…" : mode === "counter" ? "Send counter" : "Send question"}
          </button>
          <button type="button" onClick={() => setMode("choose")}
            className="rounded-md border border-ivory-300 px-4 py-3 text-sm text-navy-500 hover:bg-ivory-100">
            Back
          </button>
        </div>
      )}
    </form>
  );
}
