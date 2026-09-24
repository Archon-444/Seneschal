"use client";

import { useActionState } from "react";
import { APPROVAL_COMMENT_MAX } from "@/lib/approvalLimits";
import { COPY, errorPair, type LinkLang } from "@/lib/linkCopy";
import { formatDubaiDateTime } from "@/server/calculators/dates";
import { decideApprovalAction, type ApprovalDecisionState } from "./actions";
import {
  Bi,
  ButtonLabel,
  FieldLabel,
  LinkError,
  ReceiptBox,
  ReceiptRow,
  linkInputClass,
  primaryButtonClass,
  secondaryButtonClass,
  valueLocale,
} from "./parts";

export function ApprovalForm({ token, lang }: { token: string; lang: LinkLang }) {
  const [state, formAction, pending] = useActionState(
    decideApprovalAction,
    { status: "idle" } as ApprovalDecisionState,
  );

  if (state.status === "done") {
    return (
      <ReceiptBox>
        <p className="font-semibold text-onfile">
          <Bi pair={state.decision === "APPROVED" ? COPY.approvedTitle : COPY.rejectedTitle} lang={lang} />
        </p>
        <div className="space-y-1.5">
          <ReceiptRow label={COPY.receiptRecorded} lang={lang}>
            <span className="figure">{formatDubaiDateTime(new Date(state.recordedAt), valueLocale(lang))}</span>
          </ReceiptRow>
          {state.comment && (
            <ReceiptRow label={COPY.receiptNote} lang={lang}>
              <span dir="auto">“{state.comment}”</span>
            </ReceiptRow>
          )}
        </div>
        <p>
          <Bi pair={COPY.approvalAfter} lang={lang} />
        </p>
      </ReceiptBox>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <FieldLabel pair={COPY.noteOptional} lang={lang} htmlFor="approval-comment" />
        <textarea id="approval-comment" name="comment" rows={3} maxLength={APPROVAL_COMMENT_MAX} className={linkInputClass} />
      </div>
      {state.status === "error" && <LinkError pair={errorPair(state.message)} lang={lang} />}
      <div className="space-y-2.5">
        <button type="submit" name="decision" value="APPROVED" disabled={pending} className={primaryButtonClass}>
          <ButtonLabel pair={pending ? COPY.recording : COPY.approve} lang={lang} />
        </button>
        <button type="submit" name="decision" value="REJECTED" disabled={pending} className={secondaryButtonClass}>
          <ButtonLabel pair={COPY.reject} lang={lang} />
        </button>
      </div>
    </form>
  );
}
