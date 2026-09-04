"use client";

import { useActionState } from "react";
import { requestOwnerApprovalAction, type OwnerApprovalState } from "./actions";

export function RequestOwnerApprovalForm({
  offerId,
  tenancyId,
  contactId,
}: {
  offerId: string;
  tenancyId: string;
  contactId: string;
}) {
  const [state, action, pending] = useActionState<OwnerApprovalState, FormData>(
    requestOwnerApprovalAction,
    null,
  );
  return (
    <div className="space-y-1">
      <form action={action}>
        <input type="hidden" name="offerId" value={offerId} />
        <input type="hidden" name="tenancyId" value={tenancyId} />
        <input type="hidden" name="contactId" value={contactId} />
        <button
          type="submit"
          disabled={pending}
          className="text-xs text-navy-500 underline-offset-2 hover:text-navy-700 underline underline-offset-2 disabled:opacity-50"
        >
          {pending ? "Requesting…" : "Request owner sign-off"}
        </button>
      </form>
      {state?.ok && (
        <div className="max-w-xs text-xs">
          <p className="text-verde-700">Share this one-time link. It is shown once:</p>
          <code className="mt-1 block break-all rounded border border-line bg-ivory-100 p-2 text-[11px] text-navy-900">
            {state.url}
          </code>
        </div>
      )}
      {state && !state.ok && <p className="text-xs text-claret-700">{state.error}</p>}
    </div>
  );
}
