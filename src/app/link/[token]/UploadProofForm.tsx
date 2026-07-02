"use client";

import { useActionState } from "react";
import { Field, FormStatus, inputClass } from "@/components/ui";
import { MAX_UPLOAD_LABEL, MAX_FILES_PER_REQUEST } from "@/lib/uploadLimits";
import { submitProofAction, type SubmitState } from "./actions";

export function UploadProofForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(submitProofAction, { status: "idle" } as SubmitState);

  if (state.status === "done") {
    const names = state.fileNames ?? [];
    return (
      <div className="space-y-2 rounded-md bg-verde-100 p-4 text-sm text-verde-700">
        <p className="font-semibold">
          Thank you — {names.length === 1 ? "your file was" : `your ${names.length} files were`}{" "}
          received and recorded.
        </p>
        {names.length > 0 && (
          <ul className="list-inside list-disc">
            {names.slice(0, 5).map((n) => (
              <li key={n} className="truncate">{n}</li>
            ))}
            {names.length > 5 && <li>…and {names.length - 5} more</li>}
          </ul>
        )}
        <p>You can close this page.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field
        label="Photo or document"
        hint={`Up to ${MAX_FILES_PER_REQUEST} files, ${MAX_UPLOAD_LABEL} each. Images or PDF.`}
      >
        <input
          type="file"
          name="files"
          multiple
          required
          accept="image/*,application/pdf"
          className="block w-full text-sm text-navy-700 file:mr-3 file:rounded-md file:border-0 file:bg-navy-800 file:px-4 file:py-2 file:text-sm file:text-ivory-50"
        />
      </Field>
      <Field label="Note (optional)">
        <textarea name="note" rows={2} className={inputClass} />
      </Field>
      {state.status === "error" && <FormStatus error={state.message} />}
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
