"use client";

import { useActionState } from "react";
import { Field, FormStatus, inputClass } from "@/components/ui";
import { decideApprovalAction, type ApprovalDecisionState } from "./actions";

export function ApprovalForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    decideApprovalAction,
    { status: "idle" } as ApprovalDecisionState,
  );

  if (state.status === "done") {
    return (
      <div className="space-y-2 rounded-md bg-verde-100 p-4 text-sm text-verde-700">
        <p className="font-semibold">
          {state.decision === "APPROVED"
            ? "Thank you — your approval has been recorded."
            : "Thank you — your decision to reject has been recorded."}
        </p>
        {state.comment && (
          <p className="border-l-2 border-verde-500/40 pl-2 italic">“{state.comment}”</p>
        )}
        <p>The managing office will see this on the record. You can close this page.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="Note (optional)">
        <textarea name="comment" rows={2} className={inputClass} />
      </Field>
      {state.status === "error" && <FormStatus error={state.message} />}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="submit"
          name="decision"
          value="APPROVED"
          disabled={pending}
          className="rounded-md bg-navy-800 py-3 text-sm font-medium text-ivory-50 hover:bg-navy-700 disabled:opacity-50"
        >
          {pending ? "Recording…" : "Approve"}
        </button>
        <button
          type="submit"
          name="decision"
          value="REJECTED"
          disabled={pending}
          className="rounded-md border border-ivory-300 py-3 text-sm font-medium text-navy-700 hover:bg-ivory-100 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </form>
  );
}
