/**
 * The seeded world has to be internally consistent at every hour, not at the
 * hour CI happens to run.
 *
 * `scripts/seed.ts` builds a demo church from two dates: `rosterAnchor(now)`,
 * which every seeded student carries as `createdAt`, and the eight weeks of
 * gatherings `buildEvents` lays down behind `now`. The dashboard's derivations
 * read both — `standingIn` counts only nights on or after a student's
 * `createdAt` — so a roster younger than its own attendance is not a slightly
 * odd data set, it is an empty MIA list and three failing dashboard specs.
 *
 * That has now happened twice, both times on a clock rather than on a commit:
 * once for a month each August, and once at 09:00 UTC on 2026-09-08, when the
 * anchor stepped from 372 days old to 7 and every branch in the repo went red
 * at the same instant. Neither was reachable by the unit suite, because the
 * seeder writes to Firestore at import time and can only be run against an
 * emulator — which is why the rule now lives in `scripts/seedCalendar.ts` and
 * is held here instead.
 *
 * The loops walk real clocks rather than the boundary somebody thought of: an
 * hour at a time across two years, so a margin that is one day short is caught
 * by the day it is short on, and the September step — the one both failures
 * went through — is walked minute by minute.
 */
import { describe, expect, it } from 'vitest';

import { ANCHOR_MARGIN_DAYS, HISTORY_WEEKS, rosterAnchor } from '../scripts/seedCalendar';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** How old the roster is, in days, when the world is built at `now`. */
function anchorAgeDays(now: Date): number {
  return (now.getTime() - rosterAnchor(now).getTime()) / DAY_MS;
}

/**
 * The oldest gathering the seeder writes: `HISTORY_WEEKS` back from the next
 * Friday, which is up to a week ahead of `now`. Deliberately the *most
 * forgiving* reading — the real oldest night can only be older than this, so a
 * margin that clears this clears the seed.
 */
function oldestGatheringAgeDays(): number {
  return HISTORY_WEEKS * 7 - 7;
}

describe('the seeded roster predates its own attendance', () => {
  it('anchors behind the oldest gathering at every hour of two years', () => {
    const start = Date.UTC(2026, 0, 1, 0, 0, 0);
    let worst = { at: '', age: Number.POSITIVE_INFINITY };

    for (let hour = 0; hour < 2 * 365 * 24; hour += 1) {
      const now = new Date(start + hour * HOUR_MS);
      const age = anchorAgeDays(now);
      if (age < worst.age) worst = { at: now.toISOString(), age };
    }

    // Stated as the worst hour rather than as a pass/fail count, so a failure
    // names the clock to reproduce on.
    expect({ at: worst.at, clears: worst.age > oldestGatheringAgeDays() }).toEqual({
      at: worst.at,
      clears: true,
    });
    expect(worst.age).toBeGreaterThan(oldestGatheringAgeDays());
  });

  /**
   * The step itself, walked a minute at a time.
   *
   * Both failures were a discontinuity rather than a drift: the anchor is fine,
   * then one minute later it is a week old and everything derived from it is
   * wrong. An hourly sweep would step over the exact minute; this does not.
   */
  it('never lands short across the September step', () => {
    for (const year of [2026, 2027]) {
      const from = Date.UTC(year, 7, 25, 0, 0, 0);
      const to = Date.UTC(year, 8, 15, 0, 0, 0);
      for (let t = from; t <= to; t += 60_000) {
        const now = new Date(t);
        if (anchorAgeDays(now) <= oldestGatheringAgeDays()) {
          throw new Error(
            `roster anchored ${anchorAgeDays(now).toFixed(1)} days behind ` +
              `${now.toISOString()}, inside its own ${oldestGatheringAgeDays()} days of history`,
          );
        }
      }
    }
  });

  /**
   * The margin is the history plus a fortnight, and it is the coupling that
   * matters: someone who lengthens the seeded history has to come through here.
   */
  it('sizes the margin from the history it has to clear', () => {
    expect(ANCHOR_MARGIN_DAYS).toBeGreaterThan(HISTORY_WEEKS * 7);
  });

  /**
   * The regression, named by its clock.
   *
   * At 08:59 UTC on 2026-09-08 the anchor was 372 days old and the dashboard
   * suite was green; at 09:01 it was 7 days old under the old margin, and three
   * specs failed on every branch. Both instants must now answer the same.
   */
  it('answers the same on both sides of 2026-09-08 09:00 UTC', () => {
    const before = new Date('2026-09-08T08:59:00Z');
    const after = new Date('2026-09-08T09:01:00Z');

    expect(rosterAnchor(before).getTime()).toBe(rosterAnchor(after).getTime());
    expect(anchorAgeDays(after)).toBeGreaterThan(oldestGatheringAgeDays());
  });
});
