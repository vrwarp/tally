/**
 * Which past gatherings actually happened.
 *
 * An event carries `status: 'cancelled'`, but that field is only true when
 * somebody remembered to open Tally and say so — and on the night a gathering is
 * called off, nobody is thinking about the app. What does survive is the
 * attendance: a session that ran has somebody through the door, and a session
 * that never ran has an empty `attendance` subcollection.
 *
 * So every derivation over history reads zero attendance at a finished gathering
 * as "this one did not happen" rather than as "everybody missed it". Without
 * that reading, one snowed-out Friday puts the whole ministry on the MIA list,
 * empties the Recent list of its regulars, and drops a zero into the trend strip
 * that looks like a collapse in attendance.
 *
 * The unavoidable cost is that a gathering somebody genuinely forgot to take
 * attendance at also stops counting. That is the forgiving direction, and it is
 * the honest one: Tally has no evidence the session ran, and the two cases are
 * indistinguishable from the data. Nobody should get a "we've missed you" phone
 * call over a night with no record of anybody at all.
 *
 * Pure functions over `EventAttendanceSnapshot`, so the check-in screen, the
 * dashboard and the student page all reach the same verdict about the same night.
 */
import type { EventAttendanceSnapshot } from '@/types';

/**
 * `held`               — somebody was checked in, so it definitely happened.
 * `cancelled`          — called off, and somebody marked it.
 * `presumed-cancelled` — nobody was ever checked in. Treated as cancelled.
 */
export type SessionOutcome = 'held' | 'cancelled' | 'presumed-cancelled';

export function sessionOutcome(snapshot: EventAttendanceSnapshot): SessionOutcome {
  if (snapshot.event.status === 'cancelled') return 'cancelled';
  return snapshot.presentStudentIds.size > 0 ? 'held' : 'presumed-cancelled';
}

/** True only for a gathering there is evidence for. The gate every window uses. */
export function wasHeld(snapshot: EventAttendanceSnapshot): boolean {
  return sessionOutcome(snapshot) === 'held';
}

/**
 * The gatherings a history window may reason over, in the order given.
 *
 * Callers that then take the most recent N must filter *before* slicing, so a
 * cancelled week costs the window nothing instead of eating one of its slots.
 */
export function heldSessions(
  snapshots: readonly EventAttendanceSnapshot[],
): EventAttendanceSnapshot[] {
  return snapshots.filter(wasHeld);
}

/**
 * Scheduled gatherings with nobody checked in.
 *
 * Screens use this to say out loud what they inferred — a count that quietly
 * differs from "the last ten gatherings" reads as a bug in the numbers.
 */
export function presumedCancelled(
  snapshots: readonly EventAttendanceSnapshot[],
): EventAttendanceSnapshot[] {
  return snapshots.filter((snapshot) => sessionOutcome(snapshot) === 'presumed-cancelled');
}
