/**
 * The two dates the seeded world has to agree about, and the rule between them.
 *
 * Extracted from `scripts/seed.ts` so the rule can be tested. The seeder writes
 * to Firestore at import time, so nothing in it can be reached from the unit
 * suite; this pair can, and it is the pair that has now broken the dashboard
 * twice — both times on a clock, on a branch that changed nothing, months after
 * anyone last thought about it. See `tests/seedCalendar.test.ts`.
 */

/**
 * How many weeks of gatherings sit behind `now` when the world is built.
 *
 * The Friday series is the longer of the two (Sunday School goes back six), so
 * it sets the depth of the whole seeded history — and it is what
 * `rosterAnchor` has to stand behind. The two numbers are a pair: read one
 * without the other and the seed produces a roster younger than its own
 * attendance.
 */
export const HISTORY_WEEKS = 8;

/**
 * How far behind `now` the roster's anchor must fall.
 *
 * The whole of the seeded history, plus a fortnight. The fortnight is for the
 * derivations that need something *before* the oldest night to judge it
 * against, and for the `firstAttendedAt` fallback five days after the anchor,
 * which must itself stay comfortably in the past.
 */
export const ANCHOR_MARGIN_DAYS = HISTORY_WEEKS * 7 + 14;

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * The most recent September 1st that is comfortably behind `now` — when the
 * roster was set up, and every seeded student's `createdAt`.
 *
 * It has to stand behind the oldest gathering the seed generates, and the
 * margin is the whole of that history rather than a week, because a week is
 * only long enough for one of the things that hang off this date.
 *
 * Twice now it has not been.
 *
 * The first time it anchored on the *calendar* school year, treating August as
 * already belonging to the next one, so for the whole of August it returned a
 * date in the future: `createdAt` said no regular could have attended anything
 * (MIA count 0) and `firstAttendedAt` put the entire roster inside the New
 * Visitors window (42 "new faces"). The dashboard suite failed for a month each
 * year, starting at midnight UTC on August 1st. The fix was a week's margin,
 * sized for the `firstAttendedAt` fallback five days after this date.
 *
 * The second time was 09:00 UTC on 2026-09-08, when that week elapsed and the
 * anchor stepped from 372 days old to 7 while the seed went on writing eight
 * weeks of gatherings behind it. Every drifted student's last visit was then
 * four weeks before they existed. `standingIn` counts only nights on or after
 * `createdAt`, so nobody had enough eligible nights to be missing from
 * anything, the MIA list emptied, and three dashboard specs failed on every
 * branch at once — none of which had touched the dashboard.
 *
 * So the margin is not a cushion around a date. It is the statement that the
 * roster predates its own attendance, and `tests/seedCalendar.test.ts` holds it
 * to that at every hour of a year rather than at whatever hour CI last ran.
 */
export function rosterAnchor(now: Date): Date {
  const candidate = new Date(now.getFullYear(), 8, 1, 9, 0, 0, 0);
  return addDays(candidate, ANCHOR_MARGIN_DAYS) <= now
    ? candidate
    : new Date(now.getFullYear() - 1, 8, 1, 9, 0, 0, 0);
}
