/**
 * How far back a student's attendance history reaches.
 *
 * Its own module rather than a closure inside the page, for the reason
 * `predictiveRoster` and `insights` are theirs: this is a rule about what the
 * app claims, not a detail of how one screen renders, and a rule is worth
 * stating once where it can be read and tested on its own.
 */
import type { TallyEvent } from '@/types';

/**
 * A year, and a date rather than a count.
 *
 * The counts this replaced — eight nights of each gathering, twenty-four in all
 * — were a read budget wearing the costume of an answer. They made the depth of
 * the history depend on how often a gathering happens, so a weekly chain showed
 * two months and a monthly one showed two years, on the same page, under the
 * same heading, with nothing saying so.
 *
 * A year is the unit every neighbouring rule already uses:
 * `PARTICIPATION_MAX_AGE_DAYS` for whether a student belongs to a gathering at
 * all, and `EVENT_WINDOW_DAYS` for the calendar the provider holds live. Asking
 * the same span of all three means "is this student drifting?" is answered over
 * a ministry's year instead of over whatever fitted in the budget.
 *
 * It is not free, and the cost is the reason the old ceiling existed. Each night
 * costs one attendance read — that is what pays for the absences and for "No
 * one", neither of which can be derived from the student's own records — so a
 * year across several gatherings is a few hundred reads the first time a profile
 * is opened. `useEventSnapshots` caches them for the session and shares that
 * cache with the dashboard, and `fetchAttendanceByEvent` bounds how many are in
 * flight at once so they arrive in waves rather than all at once.
 */
export const HISTORY_MAX_AGE_DAYS = 365;

const DAY_MS = 86_400_000;

/**
 * The finished nights that history covers, newest first.
 *
 * Three conditions, and each of them is load-bearing:
 *
 * `checkInClosesAt < now` — a night still in progress is not an absence. The
 * gathering somebody is standing in has not been missed, and counting it would
 * put every student who has not yet been tapped onto a streak, mid-evening.
 *
 * `status !== 'cancelled'` — a night called off is not one they failed to come
 * to. A night nobody happened to attend is a different thing and stays: the grid
 * labels it "No one" rather than counting it, which is what `sessionOutcome`
 * decides from the attendance itself.
 *
 * `startAt >= since` — the year. Every night inside it, of every gathering, so
 * how deep a gathering's history runs is a fact about the window rather than
 * about how often that gathering meets.
 */
export function historyWindow(events: readonly TallyEvent[], now: Date): TallyEvent[] {
  const since = new Date(now.getTime() - HISTORY_MAX_AGE_DAYS * DAY_MS);

  return events
    .filter(
      (event) =>
        event.status !== 'cancelled' && event.checkInClosesAt < now && event.startAt >= since,
    )
    .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
}
