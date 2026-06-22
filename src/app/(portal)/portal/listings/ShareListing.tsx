"use client";

import { useActionState } from "react";
import { Button, inputClass } from "@/components/ui";
import { createListingShareLinkAction } from "./actions";

// Surfaces the public listing link's raw token exactly once, in the browser only —
// the server returns it from the action and never logs or re-displays it.
export function ShareListing({ listingId }: { listingId: string }) {
  const [state, action, pending] = useActionState(createListingShareLinkAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={listingId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Creating…" : "Create public link"}
      </Button>
      {state.error && <p className="text-sm text-claret-700">{state.error}</p>}
      {state.url && (
        <input
          readOnly
          value={state.url}
          onFocus={(e) => e.currentTarget.select()}
          className={inputClass}
          aria-label="Public listing link"
        />
      )}
    </form>
  );
}
