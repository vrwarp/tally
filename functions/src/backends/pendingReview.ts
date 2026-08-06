/**
 * The hold that keeps a self-registered family out of the church's database
 * until somebody has looked at them.
 *
 * A family who registered themselves at the lobby kiosk typed their own names
 * on a public screen with a queue behind them. Everything that follows from
 * that — is this the Jacob Smith we already have, is "Sam" the same child as
 * last week's "Samuel", is this adult the David Kim in the office database — is
 * a judgement, and nothing upstream is reversible: there is no delete anywhere
 * in this codebase, and Attendees has no merges at all. So the door records and
 * a person decides, rather than the other way round.
 *
 * `pendingReview: true` is what a registration writes onto each child, and it
 * is the *only* thing that gates the push. Every path that could put a student
 * into a backend consults this: both adapters' `pushStudent`, both of their
 * pending sweeps, the on-create trigger and the re-create repair. Approving is
 * what clears it, and clearing it is what lets the ordinary machinery run — so
 * a reviewer who approves and then loses the network still ends up with the
 * family pushed, by the sweep, on the next press of the button.
 *
 * Written by the server and by nothing else; `firestore.rules` refuses a client
 * that tries to set or clear it, because a kiosk that could clear its own hold
 * would be a kiosk with a direct line into Planning Center.
 */

/** What a skipped push says. Reaches a leader on the Students screen. */
export const HELD_FOR_REVIEW_MESSAGE =
  'This family registered themselves and is waiting to be reviewed. Approve them on the Review screen to add them.';

/** Whether this student document is on hold. */
export function isHeldForReview(data: Record<string, unknown> | null | undefined): boolean {
  return (data ?? {}).pendingReview === true;
}
