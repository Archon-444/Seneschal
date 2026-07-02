"use client";

import { useId, useRef, type ReactNode } from "react";
import { Button } from "./ui";
import { SubmitButton } from "./SubmitButton";

/**
 * Confirmation gate for irreversible one-click actions. Wraps an EXISTING
 * server action — the dialog only interposes a confirm step before the same
 * form submit; it never introduces a new mutation path, so evidence/audit
 * writes inside the action are untouched.
 *
 * Built on native <dialog>: showModal() gives us the focus trap, Escape to
 * close, and focus return to the trigger for free. The confirm button reflects
 * the form's pending state via SubmitButton.
 */
export function ConfirmDialog({
  trigger,
  triggerClassName = "",
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  action,
  hiddenFields,
}: {
  /** Content of the button that opens the dialog. */
  trigger: ReactNode;
  triggerClassName?: string;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  /** The existing server action — submitted unchanged on confirm. */
  action: (formData: FormData) => void | Promise<void>;
  /** Fields the action expects, rendered as hidden inputs. */
  hiddenFields?: Record<string, string>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => dialogRef.current?.showModal()}
      >
        {trigger}
      </button>
      <dialog
        ref={dialogRef}
        role="alertdialog"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="seneschal-dialog m-auto w-full max-w-sm rounded-xl border border-line bg-white p-6 shadow-lg"
      >
        <h2 id={titleId} className="font-display text-lg font-semibold text-navy-900">
          {title}
        </h2>
        <div id={messageId} className="mt-2 text-sm text-muted">
          {message}
        </div>
        <form
          action={action}
          onSubmit={() => dialogRef.current?.close()}
          className="mt-5 flex justify-end gap-2"
        >
          {hiddenFields &&
            Object.entries(hiddenFields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()}>
            {cancelLabel}
          </Button>
          <SubmitButton variant={tone === "danger" ? "danger" : "primary"}>
            {confirmLabel}
          </SubmitButton>
        </form>
      </dialog>
    </>
  );
}
