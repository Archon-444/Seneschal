"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "./ui";

/**
 * Submit button that reflects its form's pending state. Works inside any
 * `<form action={serverAction}>` via useFormStatus — it does NOT touch the
 * action, so it is safe on every form regardless of whether the action returns
 * a value. (Error/success display is a separate concern: see FormStatus, which
 * is only wired where the action already exposes a status channel.)
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}
