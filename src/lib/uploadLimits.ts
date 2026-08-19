// Upload caps shared between the server guards and the client-facing hint
// text, so the number a user reads can never drift from the number the server
// enforces. The request body itself is hard-capped by serverActions.
// bodySizeLimit in next.config.ts — keep all three in step.

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "15 MB";
export const MAX_FILES_PER_REQUEST = 10;

// The server-action body cap (next.config.ts serverActions.bodySizeLimit)
// applies to the WHOLE multipart request, not per file — so a multi-file
// submission is bound by this total, not files x MAX_UPLOAD_BYTES. Kept
// safely under the 15mb config value to leave headroom for multipart
// boundaries and the other form fields (note, token).
//
// Because this sits BELOW the body cap, a request between the two reaches the
// server action with the framework's guard satisfied — so submitProofAction
// enforces this total itself. UploadProofForm also sums client-side, but only
// to warn before a long upload; the server check is the one that binds.
export const MAX_UPLOAD_TOTAL_BYTES = 14 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_LABEL = "14 MB";
