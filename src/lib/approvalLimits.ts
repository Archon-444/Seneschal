// Owner sign-off comment cap. Shared so the public form, the server action,
// and the insert-only evidence writer cannot drift. EvidenceEvent is
// insert-only — an uncapped free-text field would live on the timeline forever.

export const APPROVAL_COMMENT_MAX = 2_000;
