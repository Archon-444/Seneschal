"use client";

import { useActionState, type ReactNode } from "react";
import { FormStatus } from "@/components/ui";
import {
  commitReviewedExtractionAction,
  rejectExtractionFormAction,
  type ReviewCommitState,
} from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Button } from "@/components/ui";

export function ExtractionReviewForm({
  jobId,
  children,
}: {
  jobId: string;
  children: ReactNode;
}) {
  const [state, formAction] = useActionState<ReviewCommitState, FormData>(
    commitReviewedExtractionAction,
    null,
  );

  return (
    <form action={formAction} className="max-w-3xl space-y-6">
      <input type="hidden" name="jobId" value={jobId} />
      {state?.error && <FormStatus error={state.error} />}
      {children}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <SubmitButton pendingLabel="Writing records…">Confirm & create tenancy</SubmitButton>
        <Button type="submit" variant="danger" formAction={rejectExtractionFormAction}>
          Reject extraction
        </Button>
        <p className="t-caption text-muted">
          Nothing is written to trusted records until you confirm. Rollback stays available on the import batch.
        </p>
      </div>
    </form>
  );
}
