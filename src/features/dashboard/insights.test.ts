/**
 * Unit tests for the dashboard derivations (Journey 5).
 *
 * These functions produce a *call list*, so the interesting assertions are the
 * exclusions: a student who joined last week must not be accused of going
 * missing, and a retreat must not be counted as a missed Friday.
 */
import { describe, expect, it } from 'vitest';
import {
  computeAttendanceTrend,
  computeIncompleteProfiles,
  computeMia,
  computeNewVisitors,
  computeSummary,
  orderSnapshotsNewestFirst,
  recurringSnapshots,
} from '@/features/dashboard/insights';
import type { EventAttendanceSnapshot, TallyEvent } from '@/types';
import {
  NOW,
  makeEvent,
  makeSettings,
  makeSnapshot,
  makeStudent,
  makeWeeklyEvents,
} from '../../../tests/factories';

const FRIDAY = 'friday-fellowship';
const SUNDAY = 'sunday-school';

/** `count` past Fridays, oldest first. */
const fridays = (count: number) => makeWeeklyEvents({ count, seriesId: FRIDAY });

/** `makeEvent` coalesces with `??`, so a null `seriesId` has to be patched on. */
const makeOneOff = (overrides: Partial<TallyEvent>): TallyEvent => ({
  ...makeEvent({ mode: 'oneoff', ...overrides }),
  seriesId: null,
});

/** Long before any fixture event, so nothing is excluded by the join date. */
const LONG_AGO = new Date(2025, 8, 1, 12, 0);

/**
 * A student who never misses anything, and who no test ever asks about.
 *
 * A gathering with an empty attendance list is read as a cancelled session, so a
 * night that none of a test's *own* students attended still needs somebody
 * through the door to count as a night that happened. This id is deliberately
 * never passed to a derivation: it exists to make the gathering real.
 */
const REGULAR = 'regular-who-never-misses';

/** A gathering that definitely happened, plus whoever the test cares about. */
const held = (event: TallyEvent, present: readonly string[] = []) =>
  makeSnapshot(event, [REGULAR, ...present]);

const studentIds = (rows: readonly { student: { id: string } }[]) =>
  rows.map((row) => row.student.id);

/* -------------------------------------------------------------------------- */
/* Snapshot ordering helpers                                                   */
/* -------------------------------------------------------------------------- */

describe('orderSnapshotsNewestFirst', () => {
  it('sorts by start time descending without mutating the input', () => {
    const events = fridays(3);
    const input = [makeSnapshot(events[0]!, []), makeSnapshot(events[2]!, []), makeSnapshot(events[1]!, [])];

    const ordered = orderSnapshotsNewestFirst(input);

    expect(ordered.map((snapshot) => snapshot.event.id)).toEqual([
      `${FRIDAY}-1`,
      `${FRIDAY}-2`,
      `${FRIDAY}-3`,
    ]);
    expect(input[0]!.event.id).toBe(`${FRIDAY}-3`);
  });
});

describe('recurringSnapshots', () => {
  it('keeps only scheduled recurring instances, newest first', () => {
    const events = fridays(2);
    const input = [
      held(events[0]!),
      held(events[1]!),
      makeSnapshot(makeOneOff({ id: 'retreat', startAt: new Date(2026, 1, 12, 9, 0) }), ['a']),
      makeSnapshot(makeEvent({ ...events[1]!, id: 'cancelled', status: 'cancelled' }), ['a']),
    ];

    expect(recurringSnapshots(input).map((snapshot) => snapshot.event.id)).toEqual([
      `${FRIDAY}-1`,
      `${FRIDAY}-2`,
    ]);
  });

  /*
   * The cancelled-session rule. Nobody marks a snowed-out Friday as cancelled at
   * 6pm on a Friday, so the attendance is the only evidence left: an empty one
   * means the gathering did not happen, and a gathering that did not happen is
   * not something anybody can be absent from.
   */
  it('drops a gathering nobody was ever checked into', () => {
    const events = fridays(3);
    const input = [held(events[0]!), makeSnapshot(events[1]!, []), held(events[2]!)];

    expect(recurringSnapshots(input).map((snapshot) => snapshot.event.id)).toEqual([
      `${FRIDAY}-1`,
      `${FRIDAY}-3`,
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* computeMia                                                                  */
/* -------------------------------------------------------------------------- */

describe('computeMia', () => {
  const settings = makeSettings({ miaConsecutiveMisses: 3 });
  const events = fridays(4); // oldest first: -4, -3, -2, -1

  it('lists a student who missed exactly the threshold number in a row', () => {
    const student = makeStudent({ id: 'missing', createdAt: LONG_AGO });
    // Present four weeks ago, absent for the three since.
    const snapshots = [
      held(events[0]!, [student.id]),
      held(events[1]!),
      held(events[2]!),
      held(events[3]!),
    ];

    const mia = computeMia([student], snapshots, settings);

    expect(mia).toHaveLength(1);
    expect(mia[0]!.consecutiveMisses).toBe(3);
  });

  it('leaves out a student one miss below the threshold', () => {
    const student = makeStudent({ id: 'nearly', createdAt: LONG_AGO });
    const snapshots = [
      held(events[0]!),
      held(events[1]!, [student.id]),
      held(events[2]!),
      held(events[3]!),
    ];

    expect(computeMia([student], snapshots, settings)).toEqual([]);
  });

  it('includes a student who has never attended, once enough gatherings have passed', () => {
    const student = makeStudent({ id: 'never-came', createdAt: LONG_AGO });
    const snapshots = events.map((event) => held(event));

    const mia = computeMia([student], snapshots, settings);

    expect(studentIds(mia)).toEqual([student.id]);
    expect(mia[0]!.consecutiveMisses).toBe(4);
    expect(mia[0]!.lastAttendedAt).toBeNull();
    expect(mia[0]!.lastAttendedEventTitle).toBeNull();
  });

  it('does not accuse a student who joined last week of going missing', () => {
    // Added after the three older Fridays: only one gathering could have been missed.
    const student = makeStudent({
      id: 'brand-new',
      createdAt: new Date(events[2]!.startAt.getTime() + 86_400_000),
    });
    const snapshots = events.map((event) => held(event));

    expect(computeMia([student], snapshots, settings)).toEqual([]);
  });

  it('excludes inactive students, who have already been followed up on', () => {
    const gone = makeStudent({ id: 'graduated', status: 'inactive', createdAt: LONG_AGO });
    const snapshots = events.map((event) => held(event));

    expect(computeMia([gone], snapshots, settings)).toEqual([]);
  });

  it('does not count one-off events toward the streak', () => {
    const student = makeStudent({ id: 'retreat-skipper', createdAt: LONG_AGO });
    const recent = fridays(2);
    const snapshots = [
      held(recent[0]!),
      held(recent[1]!),
      // Two retreats they also missed. Counting these would push them to four.
      makeSnapshot(makeOneOff({ id: 'retreat-a', startAt: new Date(2026, 1, 7, 9, 0) }), [REGULAR]),
      makeSnapshot(makeOneOff({ id: 'retreat-b', startAt: new Date(2026, 1, 11, 9, 0) }), [REGULAR]),
    ];

    expect(computeMia([student], snapshots, settings)).toEqual([]);
  });

  it('ignores cancelled instances', () => {
    const student = makeStudent({ id: 'unlucky', createdAt: LONG_AGO });
    const snapshots = [
      held(events[0]!),
      held(events[1]!),
      // Attendance on a cancelled night — somebody turned up before the call was
      // made — so these are excluded on their status alone.
      makeSnapshot(makeEvent({ ...events[2]!, status: 'cancelled' }), [REGULAR]),
      makeSnapshot(makeEvent({ ...events[3]!, status: 'cancelled' }), [REGULAR]),
    ];

    // Only two real gatherings remain, which is under the threshold.
    expect(computeMia([student], snapshots, settings)).toEqual([]);
  });

  /*
   * The two halves of the cancelled-session rule, which have to hold together:
   * a night nobody attended is not a miss, and it is not a reprieve either.
   */
  it('does not count a gathering nobody attended as a miss', () => {
    const student = makeStudent({ id: 'snowed-out', createdAt: LONG_AGO });
    const snapshots = [
      held(events[0]!, [student.id]),
      held(events[1]!),
      // The storm night. Nobody was checked in, so nobody was absent.
      makeSnapshot(events[2]!, []),
      held(events[3]!),
    ];

    // Two misses rather than three. Counting the storm night would put every
    // student in the ministry on the call list the following week.
    expect(computeMia([student], snapshots, settings)).toEqual([]);
  });

  it('does not let a gathering nobody attended break a streak', () => {
    const student = makeStudent({ id: 'drifting', createdAt: LONG_AGO });
    const snapshots = [
      held(events[0]!),
      held(events[1]!),
      makeSnapshot(events[2]!, []),
      held(events[3]!),
    ];

    const mia = computeMia([student], snapshots, settings);

    // Three real gatherings missed in a row, with the empty night sitting in the
    // middle of them counting as neither.
    expect(mia).toHaveLength(1);
    expect(mia[0]!.consecutiveMisses).toBe(3);
  });

  it('orders longest-absent first, breaking ties by name', () => {
    const worst = makeStudent({ id: 'worst', lastName: 'Zane', createdAt: LONG_AGO });
    const tiedA = makeStudent({ id: 'tied-a', lastName: 'Ames', createdAt: LONG_AGO });
    const tiedB = makeStudent({ id: 'tied-b', lastName: 'Brook', createdAt: LONG_AGO });

    const snapshots = [
      held(events[0]!, [tiedA.id, tiedB.id]),
      held(events[1]!),
      held(events[2]!),
      held(events[3]!),
    ];

    const mia = computeMia([tiedB, worst, tiedA], snapshots, settings);

    expect(studentIds(mia)).toEqual([worst.id, tiedA.id, tiedB.id]);
    expect(mia.map((row) => row.consecutiveMisses)).toEqual([4, 3, 3]);
  });

  it('reports where the student was last seen, from the snapshot', () => {
    const student = makeStudent({ id: 'lapsed', createdAt: LONG_AGO });
    const lastSeen = makeEvent({ ...events[0]!, title: 'Friday Fellowship: Game Night' });
    const snapshots = [
      held(lastSeen, [student.id]),
      held(events[1]!),
      held(events[2]!),
      held(events[3]!),
    ];

    const mia = computeMia([student], snapshots, settings);

    expect(mia[0]!.lastAttendedEventTitle).toBe('Friday Fellowship: Game Night');
    expect(mia[0]!.lastAttendedAt).toEqual(lastSeen.startAt);
  });

  it('falls back to the student record when the loaded window predates their last visit', () => {
    const lastAttendedAt = new Date(2025, 11, 5, 19, 0);
    const student = makeStudent({ id: 'long-gone', createdAt: LONG_AGO, lastAttendedAt });
    const snapshots = events.map((event) => held(event));

    expect(computeMia([student], snapshots, settings)[0]!.lastAttendedAt).toEqual(lastAttendedAt);
  });

  it('returns nothing when there is no recurring history at all', () => {
    const student = makeStudent({ createdAt: LONG_AGO });
    expect(computeMia([student], [], settings)).toEqual([]);
    expect(
      computeMia([student], [makeSnapshot(makeOneOff({ id: 'retreat' }), [REGULAR])], settings),
    ).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* computeNewVisitors                                                          */
/* -------------------------------------------------------------------------- */

describe('computeNewVisitors', () => {
  const settings = makeSettings({ newVisitorWindowDays: 7 });
  const events = fridays(3); // -3, -2, -1 weeks

  it('includes a first visit inside the window and excludes one outside it', () => {
    const fresh = makeStudent({
      id: 'fresh',
      lastName: 'Ames',
      firstAttendedAt: new Date(NOW.getTime() - 2 * 86_400_000),
    });
    const stale = makeStudent({
      id: 'stale',
      lastName: 'Brook',
      firstAttendedAt: new Date(NOW.getTime() - 20 * 86_400_000),
    });

    const visitors = computeNewVisitors([fresh, stale], [], settings, NOW);

    expect(studentIds(visitors)).toEqual([fresh.id]);
  });

  it('excludes a student who has never attended', () => {
    const student = makeStudent({ id: 'no-shows', firstAttendedAt: null });
    expect(computeNewVisitors([student], [], settings, NOW)).toEqual([]);
  });

  it('includes a visit exactly on the window boundary', () => {
    const onEdge = makeStudent({
      id: 'edge',
      firstAttendedAt: new Date(NOW.getTime() - 7 * 86_400_000),
    });
    const justOutside = makeStudent({
      id: 'just-outside',
      firstAttendedAt: new Date(NOW.getTime() - 7 * 86_400_000 - 1),
    });

    expect(studentIds(computeNewVisitors([onEdge, justOutside], [], settings, NOW))).toEqual([
      onEdge.id,
    ]);
  });

  it('orders the newest arrival first', () => {
    const yesterday = makeStudent({
      id: 'yesterday',
      lastName: 'Zane',
      firstAttendedAt: new Date(NOW.getTime() - 86_400_000),
    });
    const lastWeek = makeStudent({
      id: 'last-week',
      lastName: 'Ames',
      firstAttendedAt: new Date(NOW.getTime() - 6 * 86_400_000),
    });

    expect(studentIds(computeNewVisitors([lastWeek, yesterday], [], settings, NOW))).toEqual([
      yesterday.id,
      lastWeek.id,
    ]);
  });

  it('resolves the first event to the earliest snapshot containing the student', () => {
    const student = makeStudent({
      id: 'returner',
      firstAttendedAt: new Date(NOW.getTime() - 3 * 86_400_000),
    });
    const firstNight = makeEvent({ ...events[1]!, title: 'Friday Fellowship: Pizza Night' });
    // Deliberately out of order, and the student appears in two of them.
    const snapshots: EventAttendanceSnapshot[] = [
      makeSnapshot(events[2]!, [student.id]),
      makeSnapshot(firstNight, [student.id]),
      makeSnapshot(events[0]!, []),
    ];

    const [visitor] = computeNewVisitors([student], snapshots, settings, NOW);

    expect(visitor!.firstEventId).toBe(firstNight.id);
    expect(visitor!.firstEventTitle).toBe('Friday Fellowship: Pizza Night');
    expect(visitor!.firstAttendedAt).toEqual(student.firstAttendedAt);
  });

  it('degrades to a placeholder when no loaded snapshot contains the student', () => {
    const student = makeStudent({
      id: 'off-window',
      firstAttendedAt: new Date(NOW.getTime() - 86_400_000),
    });

    const [visitor] = computeNewVisitors([student], [makeSnapshot(events[0]!, [])], settings, NOW);

    expect(visitor!.firstEventId).toBe('');
    expect(visitor!.firstEventTitle).toBe('Unknown event');
  });
});

/* -------------------------------------------------------------------------- */
/* computeIncompleteProfiles                                                   */
/* -------------------------------------------------------------------------- */

describe('computeIncompleteProfiles', () => {
  it('keeps only active students still missing parent contact', () => {
    const incomplete = makeStudent({ id: 'incomplete', profileComplete: false });
    const complete = makeStudent({ id: 'complete', profileComplete: true });
    const inactive = makeStudent({ id: 'inactive', profileComplete: false, status: 'inactive' });

    expect(
      computeIncompleteProfiles([complete, inactive, incomplete]).map((s) => s.id),
    ).toEqual([incomplete.id]);
  });

  it('sorts quick-added visitors first, then newest', () => {
    const oldVisitor = makeStudent({
      id: 'old-visitor',
      profileComplete: false,
      isVisitor: true,
      createdAt: new Date(2026, 0, 5, 19, 0),
    });
    const newVisitor = makeStudent({
      id: 'new-visitor',
      profileComplete: false,
      isVisitor: true,
      createdAt: new Date(2026, 1, 6, 19, 0),
    });
    const oldRegular = makeStudent({
      id: 'old-regular',
      profileComplete: false,
      createdAt: new Date(2025, 9, 1, 19, 0),
    });
    const newRegular = makeStudent({
      id: 'new-regular',
      profileComplete: false,
      createdAt: new Date(2026, 1, 10, 19, 0),
    });

    expect(
      computeIncompleteProfiles([oldRegular, newVisitor, newRegular, oldVisitor]).map((s) => s.id),
    ).toEqual([newVisitor.id, oldVisitor.id, newRegular.id, oldRegular.id]);
  });

  it('breaks a same-timestamp tie by name', () => {
    const createdAt = new Date(2026, 1, 6, 19, 0);
    const zane = makeStudent({ id: 'zane', lastName: 'Zane', profileComplete: false, createdAt });
    const ames = makeStudent({ id: 'ames', lastName: 'Ames', profileComplete: false, createdAt });

    expect(computeIncompleteProfiles([zane, ames]).map((s) => s.id)).toEqual([ames.id, zane.id]);
  });
});

/* -------------------------------------------------------------------------- */
/* computeAttendanceTrend                                                      */
/* -------------------------------------------------------------------------- */

describe('computeAttendanceTrend', () => {
  const events = fridays(3);

  it('returns points oldest first, so the strip reads left to right', () => {
    const trend = computeAttendanceTrend([
      makeSnapshot(events[2]!, ['a', 'b', 'c']),
      makeSnapshot(events[0]!, ['a']),
      makeSnapshot(events[1]!, ['a', 'b']),
    ]);

    expect(trend.map((point) => point.eventId)).toEqual([
      `${FRIDAY}-3`,
      `${FRIDAY}-2`,
      `${FRIDAY}-1`,
    ]);
    expect(trend.map((point) => point.count)).toEqual([1, 2, 3]);
    expect(trend[0]).toMatchObject({ title: 'Friday Fellowship', seriesId: FRIDAY });
    expect(trend[0]!.date).toEqual(events[0]!.startAt);
  });

  it('filters to a single series when asked', () => {
    const sundays = makeWeeklyEvents({ count: 2, seriesId: SUNDAY, title: 'Sunday School' });
    const snapshots = [
      ...events.map((event) => makeSnapshot(event, ['a'])),
      ...sundays.map((event) => makeSnapshot(event, ['b', 'c'])),
    ];

    const trend = computeAttendanceTrend(snapshots, { seriesId: SUNDAY });

    expect(trend).toHaveLength(2);
    expect(trend.every((point) => point.seriesId === SUNDAY)).toBe(true);
  });

  it('excludes one-off and cancelled gatherings', () => {
    const snapshots = [
      makeSnapshot(events[0]!, ['a']),
      makeSnapshot(makeOneOff({ id: 'retreat', startAt: new Date(2026, 1, 7, 9, 0) }), ['a', 'b']),
      // With attendance on it, so the exclusion is the status and nothing else.
      makeSnapshot(makeEvent({ ...events[1]!, status: 'cancelled' }), ['a']),
    ];

    expect(computeAttendanceTrend(snapshots).map((point) => point.eventId)).toEqual([
      `${FRIDAY}-3`,
    ]);
  });

  it('leaves out a gathering with no attendance rather than plotting a zero', () => {
    const trend = computeAttendanceTrend([
      makeSnapshot(events[0]!, ['a', 'b']),
      makeSnapshot(events[1]!, []),
      makeSnapshot(events[2]!, ['a', 'b', 'c']),
    ]);

    // A zero bar mid-strip reads as attendance collapsing, not as a night that
    // never happened — and the average underneath it would be wrong too.
    expect(trend.map((point) => point.eventId)).toEqual([`${FRIDAY}-3`, `${FRIDAY}-1`]);
    expect(trend.every((point) => point.count > 0)).toBe(true);
  });

  it('keeps the most recent `limit` points and still returns them oldest first', () => {
    const many = makeWeeklyEvents({ count: 10, seriesId: FRIDAY });
    const trend = computeAttendanceTrend(
      many.map((event) => makeSnapshot(event, ['a'])),
      { limit: 3 },
    );

    expect(trend.map((point) => point.eventId)).toEqual([
      `${FRIDAY}-3`,
      `${FRIDAY}-2`,
      `${FRIDAY}-1`,
    ]);
  });

  it('defaults to the last eight gatherings', () => {
    const many = makeWeeklyEvents({ count: 12, seriesId: FRIDAY });
    const trend = computeAttendanceTrend(many.map((event) => makeSnapshot(event, ['a'])));

    expect(trend).toHaveLength(8);
    expect(trend.at(-1)!.eventId).toBe(`${FRIDAY}-1`);
  });
});

/* -------------------------------------------------------------------------- */
/* computeSummary                                                              */
/* -------------------------------------------------------------------------- */

describe('computeSummary', () => {
  const events = fridays(3);

  it('compares the last head-count against the one before it', () => {
    const summary = computeSummary({
      snapshots: [
        makeSnapshot(events[0]!, ['a', 'b', 'c', 'd']),
        makeSnapshot(events[1]!, ['a', 'b', 'c']),
        makeSnapshot(events[2]!, ['a', 'b']),
      ],
      mia: [],
      newVisitors: [],
      incomplete: [],
    });

    expect(summary.lastEventCount).toBe(2);
    expect(summary.previousEventCount).toBe(3);
  });

  it('counts distinct students across the whole loaded window', () => {
    const summary = computeSummary({
      snapshots: [
        makeSnapshot(events[0]!, ['a', 'b']),
        makeSnapshot(events[1]!, ['b', 'c']),
        makeSnapshot(events[2]!, ['c', 'd']),
      ],
      mia: [],
      newVisitors: [],
      incomplete: [],
    });

    expect(summary.uniqueStudents).toBe(4);
  });

  it('ignores one-off and cancelled gatherings in both head-counts and the unique tally', () => {
    const summary = computeSummary({
      snapshots: [
        makeSnapshot(events[2]!, ['a', 'b']),
        makeSnapshot(makeOneOff({ id: 'retreat', startAt: new Date(2026, 1, 12, 9, 0) }), [
          'x',
          'y',
          'z',
        ]),
        makeSnapshot(makeEvent({ ...events[1]!, status: 'cancelled' }), ['q']),
      ],
      mia: [],
      newVisitors: [],
      incomplete: [],
    });

    expect(summary.lastEventCount).toBe(2);
    expect(summary.previousEventCount).toBe(0);
    expect(summary.uniqueStudents).toBe(2);
  });

  it('reads both head counts from the gatherings that happened', () => {
    const summary = computeSummary({
      snapshots: [
        makeSnapshot(events[0]!, ['a', 'b']),
        makeSnapshot(events[1]!, ['a', 'b', 'c']),
        // The most recent gathering on the calendar, which nobody came to.
        makeSnapshot(events[2]!, []),
      ],
      mia: [],
      newVisitors: [],
      incomplete: [],
    });

    // "Last gathering 0, down 3" reports a cancelled night as a catastrophe.
    expect(summary.lastEventCount).toBe(3);
    expect(summary.previousEventCount).toBe(2);
  });

  it('passes the list lengths straight through', () => {
    const student = makeStudent({ id: 'someone' });
    const summary = computeSummary({
      snapshots: [],
      mia: [{ student, consecutiveMisses: 3, lastAttendedAt: null, lastAttendedEventTitle: null }],
      newVisitors: [
        {
          student,
          firstEventId: 'e1',
          firstEventTitle: 'Friday Fellowship',
          firstAttendedAt: NOW,
        },
      ],
      incomplete: [student, student],
    });

    expect(summary).toMatchObject({
      lastEventCount: 0,
      previousEventCount: 0,
      uniqueStudents: 0,
      miaCount: 1,
      newVisitorCount: 1,
      incompleteCount: 2,
    });
  });
});
