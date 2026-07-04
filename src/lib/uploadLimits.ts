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
// boundaries and the other form fields (note, token). Enforced client-side
// before submit, since the framework rejects an oversized request before any
// server action code runs — there is no server-side hook to give a friendly
// error for this one.
export const MAX_UPLOAD_TOTAL_BYTES = 14 * 1024 * 1024;
export const MAX_UPLOAD_TOTAL_LABEL = "14 MB";
