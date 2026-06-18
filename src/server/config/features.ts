// Pilot quarantine (single source of truth).
//
// `passport` (reusable tenant rental profile) and `listings` (marketplace supply
// side) are live, tested service code that is OUT of the current renewal-pilot
// scope. Rather than delete working logic, we make their reachable surface
// unreachable and fail-closed, and leave the services + tests dormant so revival
// is a deliberate flip — see QUARANTINE.md.
//
// Hardcoded, NOT env-driven: an env flag is one more way for production to be
// misconfigured *on*, and the whole point is fail-closed. Reviving a quarantined
// surface is therefore a code change + PR — the right amount of friction.
//
// Kept dependency-light (a plain constant) so it imports cleanly into both the
// Edge middleware runtime and Node server components/actions.

export type QuarantinedFeature = "passport" | "listings";

const QUARANTINED: Record<QuarantinedFeature, boolean> = {
  passport: true,
  listings: true,
};

export function isQuarantined(feature: QuarantinedFeature): boolean {
  return QUARANTINED[feature];
}

/** Thrown by server actions/handlers when a quarantined surface is hit directly. */
export class QuarantinedFeatureError extends Error {
  readonly status = 404;
  constructor(feature: QuarantinedFeature) {
    super(`Feature "${feature}" is not available`);
    this.name = "QuarantinedFeatureError";
  }
}

/** Fail-closed guard for server actions and route/API handlers. */
export function assertNotQuarantined(feature: QuarantinedFeature): void {
  if (isQuarantined(feature)) throw new QuarantinedFeatureError(feature);
}
