"use client";

import { useActionState, useState } from "react";
import { COPY, errorPair, type LinkLang } from "@/lib/linkCopy";
import { MAX_FILES_PER_REQUEST, MAX_UPLOAD_TOTAL_BYTES, MAX_UPLOAD_TOTAL_LABEL } from "@/lib/uploadLimits";
import { submitProofAction, type SubmitState } from "./actions";
import { Bi, ButtonLabel, FieldLabel, LinkError, ReceiptBox, linkInputClass, primaryButtonClass } from "./parts";

export function UploadProofForm({ token, lang }: { token: string; lang: LinkLang }) {
  const [state, formAction, pending] = useActionState(submitProofAction, { status: "idle" } as SubmitState);
  const [tooLarge, setTooLarge] = useState(false);

  function onFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const total = Array.from(e.target.files ?? []).reduce((sum, f) => sum + f.size, 0);
    setTooLarge(total > MAX_UPLOAD_TOTAL_BYTES);
  }

  if (state.status === "done") {
    const names = state.fileNames ?? [];
    return (
      <ReceiptBox>
        <p className="font-semibold text-onfile">
          <Bi pair={COPY.filesReceived(Math.max(names.length, 1))} lang={lang} />
        </p>
        {names.length > 0 && (
          <ul className="list-inside list-disc" dir="ltr">
            {names.slice(0, 5).map((n, i) => (
              <li key={i} className="truncate">
                {n}
              </li>
            ))}
            {names.length > 5 && (
              <li>
                <Bi pair={COPY.andMore(names.length - 5)} lang={lang} />
              </li>
            )}
          </ul>
        )}
        <p>
          <Bi pair={COPY.canClose} lang={lang} />
        </p>
      </ReceiptBox>
    );
  }

  const hint = COPY.uploadHint(MAX_FILES_PER_REQUEST, MAX_UPLOAD_TOTAL_LABEL);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="lang" value={lang} />
      <div>
        <FieldLabel pair={COPY.photoOrDocument} lang={lang} htmlFor="proof-files" />
        <input
          id="proof-files"
          type="file"
          name="files"
          multiple
          required
          accept="image/*,application/pdf"
          onChange={onFilesChange}
          aria-describedby="proof-files-hint"
          className="block w-full text-sm text-ink-soft file:me-3 file:min-h-11 file:rounded-md file:border-0 file:bg-ink file:px-4 file:text-sm file:text-white"
        />
        <p id="proof-files-hint" className="mt-1 text-xs text-ink-muted">
          <Bi pair={hint} lang={lang} />
        </p>
      </div>
      <div>
        <FieldLabel pair={COPY.noteOptional} lang={lang} htmlFor="proof-note" />
        <textarea id="proof-note" name="note" rows={3} className={linkInputClass} />
      </div>
      {tooLarge && <LinkError pair={COPY.tooLarge(MAX_UPLOAD_TOTAL_LABEL)} lang={lang} />}
      {state.status === "error" && <LinkError pair={errorPair(state.message)} lang={lang} />}
      <button type="submit" disabled={pending || tooLarge} className={primaryButtonClass}>
        <ButtonLabel pair={pending ? COPY.uploading : COPY.submitProof} lang={lang} />
      </button>
    </form>
  );
}
