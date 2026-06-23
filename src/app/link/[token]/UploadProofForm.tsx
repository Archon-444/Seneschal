"use client";

import { useActionState } from "react";
import { inputClass } from "@/components/ui";
import { submitProofAction, type SubmitState } from "./actions";

export function UploadProofForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(submitProofAction, { status: "idle" } as SubmitState);

  if (state.status === "done") {
    return (
      <div className="rounded-md bg-verde-100 p-4 text-sm text-verde-700">
        Thank you — your proof was received and recorded. You can close this page.
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy-500">
          Photo or document
        </label>
        <input
          type="file"
          name="files"
          multiple
          required
          accept="image/*,application/pdf"
          className="block w-full text-sm text-navy-700 file:mr-3 file:rounded-md file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-sm file:text-ivory-50"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy-500">
          Note (optional)
        </label>
        <textarea name="note" rows={2} className={inputClass} />
      </div>
      {state.status === "error" && <p className="text-sm text-claret-500">{state.message}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-navy-800 py-3 text-sm font-medium text-ivory-50 hover:bg-navy-700 disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Submit proof"}
      </button>
    </form>
  );
}
