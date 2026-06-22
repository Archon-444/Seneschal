"use client";

import { ErrorState } from "./ui";

/**
 * Shared body for every route `error.tsx` boundary.
 *
 * CRITICAL: re-throws Next's control-flow errors (redirect / notFound) before
 * rendering anything. Auth gates `redirect()` to /login and out-of-scope or
 * missing records `notFound()` — both work by throwing. If the boundary
 * rendered its fallback for those, an unauthenticated user would see a
 * "try again" card instead of being bounced to login, and a 404 (a scoping
 * signal) would become a catchable, retryable error. Only genuine failures
 * reach ErrorState. Implement this once here; every group's error.tsx delegates.
 */
export function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const digest = error.digest ?? "";
  if (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_NOT_FOUND") ||
    digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")
  ) {
    throw error;
  }
  return (
    <div className="mx-auto max-w-2xl py-10">
      <ErrorState
        title="Something didn't load"
        message="We hit an unexpected error loading this view. Your records are safe — try again."
        onRetry={reset}
      />
    </div>
  );
}
