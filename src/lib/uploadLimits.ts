// Upload caps shared between the server guards and the client-facing hint
// text, so the number a user reads can never drift from the number the server
// enforces. The request body itself is hard-capped by serverActions.
// bodySizeLimit in next.config.ts — keep all three in step.

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "15 MB";
export const MAX_FILES_PER_REQUEST = 10;
