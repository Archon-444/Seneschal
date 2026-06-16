// Pure ordering guard for the live notification badge.
//
// The badge's unread count is updated by two kinds of async events that can resolve out of
// order: interval polls of /unread-count, and the user's own mark-read actions. Each event
// is stamped with a monotonic sequence number at the moment it is issued. A fetched count is
// only applied if its sequence is at least the sequence already reflected in the badge — so a
// poll that started before a later mark action is dropped on arrival no matter when it lands.
//
// Kept React-free (no "use client") so it can be unit-tested in the node-env suite.
export function shouldApplyCount(responseSeq: number, appliedSeq: number): boolean {
  return responseSeq >= appliedSeq;
}
