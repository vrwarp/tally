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
  computeMiaByGathering,
  computeNewVisitors,
  computeOneOffOnly,
  computeOneOffRecaps,
  computeSummary,
  computeUnseen,
  groupByGathering,
  hasNoParentContact,
  isUnreachable,
  orderSnapshotsNewestFirst,
  recurringSnapshots,
  seenAt,
  standingIn,
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
 * A last visit that predates every fixture window.
 *
 * The unnamed half of the MIA list only speaks about students Tally has checked
 * in at some point — the roster is a church directory, and somebody who has
 * never come to youth group is not missing from it.
 */
const CAME_ONCE_LONG_AGO = new Date(2025, 10, 7, 19, 0);

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

  /*
   * This list used to hold a student with no attendance at all, on the grounds
   * that they were the person most worth a phone call. They are not: Tally's
   * roster is the ministry's Planning Center directory, which is full of young
   * people who have never come to youth group, and none of them is missing.
   * Nobody has met them.
   */
  it('says nothing about a student who has never been checked in anywhere', () => {
    const student = makeStudent({ id: 'never-came', createdAt: LONG_AGO });
    const snapshots = events.map((event) => held(event));

    expect(computeMia([student], snapshots, settings)).toEqual([]);
  });

  it('keeps a student who used to come and has since vanished', () => {
    // Their last visit predates the loaded window, so no gathering can name it.
    const student = makeStudent({
      id: 'gone',
      createdAt: LONG_AGO,
      lastAttendedAt: new Date(2025, 10, 7, 19, 0),
    });
    const snapshots = events.map((event) => held(event));

    const mia = computeMia([student], snapshots, settings);

    expect(studentIds(mia)).toEqual([student.id]);
    expect(mia[0]!.consecutiveMisses).toBe(4);
    expect(mia[0]!.gatheringKey).toBeNull();
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
    const student = makeStudent({
      id: 'drifting',
      createdAt: LONG_AGO,
      lastAttendedAt: CAME_ONCE_LONG_AGO,
    });
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
    const worst = makeStudent({
      id: 'worst',
      lastName: 'Zane',
      createdAt: LONG_AGO,
      lastAttendedAt: CAME_ONCE_LONG_AGO,
    });
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
/* groupByGathering                                                            */
/* -------------------------------------------------------------------------- */

describe('groupByGathering', () => {
  const sundays = () => makeWeeklyEvents({ count: 2, seriesId: SUNDAY, title: 'Sunday School' });

  it('splits the history into one group per chain of repeats, newest first', () => {
    const snapshots = [
      ...fridays(3).map((event) => held(event)),
      ...sundays().map((event) => held(event)),
    ];

    const gatherings = groupByGathering(snapshots);

    expect(gatherings.map((gathering) => gathering.key)).toEqual([FRIDAY, SUNDAY]);
    expect(gatherings[0]!.snapshots.map((snapshot) => snapshot.event.id)).toEqual([
      `${FRIDAY}-1`,
      `${FRIDAY}-2`,
      `${FRIDAY}-3`,
    ]);
    expect(gatherings[0]!.lastHeldAt).toEqual(gatherings[0]!.snapshots[0]!.event.startAt);
  });

  /*
   * A weekly gathering created in the app has a recurrence root and no series
   * document. Grouping on `seriesId` alone would file every such gathering
   * under one "no series" heap — Tuesday small group pooled with Wednesday
   * prayer, and a streak spanning both that describes neither.
   */
  it('groups a series-less chain by its recurrence root, not with every other one', () => {
    const tuesday = makeWeeklyEvents({ count: 2, seriesId: 'ignored' }).map((event) =>
      makeEvent({ ...event, id: `tue-${event.id}`, seriesId: null, recurrenceRootId: 'tuesday' }),
    );
    const wednesday = makeWeeklyEvents({ count: 2, seriesId: 'ignored' }).map((event) =>
      makeEvent({ ...event, id: `wed-${event.id}`, seriesId: null, recurrenceRootId: 'wednesday' }),
    );

    const gatherings = groupByGathering([...tuesday, ...wednesday].map((event) => held(event)));

    expect(gatherings.map((gathering) => gathering.key).sort()).toEqual(['tuesday', 'wednesday']);
  });

  it('names a group from its series document when there is one', () => {
    const gatherings = groupByGathering(
      fridays(2).map((event) => held(event)),
      [
        {
          id: FRIDAY,
          title: 'Friday Fellowship (renamed)',
          dayOfWeek: 5,
          startTime: '19:00',
          endTime: '21:00',
          checkInOpensMinutesBefore: 60,
          checkInClosesMinutesAfter: 60,
          active: true,
          order: 1,
        },
      ],
    );

    expect(gatherings[0]!.title).toBe('Friday Fellowship (renamed)');
  });

  it('leaves out one-off events and nights that did not happen', () => {
    const events = fridays(2);
    const snapshots = [
      held(events[0]!),
      makeSnapshot(events[1]!, []),
      makeSnapshot(makeOneOff({ id: 'retreat' }), ['a']),
    ];

    const gatherings = groupByGathering(snapshots);

    expect(gatherings).toHaveLength(1);
    expect(gatherings[0]!.snapshots).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* standingIn                                                                  */
/* -------------------------------------------------------------------------- */

describe('standingIn', () => {
  const events = fridays(3);
  const settings = makeSettings();

  it('reports no misses for a student who was at the most recent night', () => {
    const student = makeStudent({ id: 'regular', createdAt: LONG_AGO });
    const [gathering] = groupByGathering(events.map((event) => held(event, [student.id])));

    expect(standingIn(gathering!, student, settings)).toMatchObject({ consecutiveMisses: 0, eligible: 3 });
  });

  it('counts back to the last night they were at', () => {
    const student = makeStudent({ id: 'drifting', createdAt: LONG_AGO });
    const [gathering] = groupByGathering([
      held(events[0]!, [student.id]),
      held(events[1]!),
      held(events[2]!),
    ]);

    const standing = standingIn(gathering!, student, settings);

    expect(standing.consecutiveMisses).toBe(2);
    expect(standing.lastAttended!.event.id).toBe(events[0]!.id);
  });

  it('reads a regular from the Recent rule, as of their last visit', () => {
    const student = makeStudent({ id: 'regular', createdAt: LONG_AGO });
    const [gathering] = groupByGathering([
      held(events[0]!, [student.id]),
      held(events[1]!, [student.id]),
      held(events[2]!),
    ]);

    expect(standingIn(gathering!, student, settings)).toMatchObject({
      attended: 2,
      wasRegular: true,
    });
  });

  it('does not call a single drop-in a regular', () => {
    const student = makeStudent({ id: 'drop-in', createdAt: LONG_AGO });
    const nights = fridays(4);
    const [gathering] = groupByGathering([
      held(nights[0]!),
      held(nights[1]!, [student.id]),
      held(nights[2]!),
      held(nights[3]!),
    ]);

    expect(standingIn(gathering!, student, settings)).toMatchObject({
      attended: 1,
      wasRegular: false,
    });
  });

  it('does not count nights held before the student joined the roster', () => {
    const student = makeStudent({
      id: 'new',
      createdAt: new Date(events[1]!.startAt.getTime() + 86_400_000),
    });
    const [gathering] = groupByGathering(events.map((event) => held(event)));

    expect(standingIn(gathering!, student, settings)).toMatchObject({ consecutiveMisses: 1, eligible: 1 });
  });
});

/* -------------------------------------------------------------------------- */
/* computeMia, split by gathering                                              */
/* -------------------------------------------------------------------------- */

describe('computeMia across several gatherings', () => {
  const settings = makeSettings({ miaConsecutiveMisses: 3 });
  const fridayNights = fridays(5);
  const sundayNights = makeWeeklyEvents({ count: 5, seriesId: SUNDAY, title: 'Sunday School' });

  /*
   * The bug the split exists to fix, in its sharpest form. A student who comes
   * every Sunday and has never once been to a Friday has missed no Sundays —
   * and is not "missing" from Friday either, because Friday was never theirs.
   * The pooled list phoned this family; the per-gathering list without this
   * rule phoned them about the wrong gathering.
   */
  it('says nothing about a student who simply does not come to that gathering', () => {
    const student = makeStudent({ id: 'sunday-only', createdAt: LONG_AGO });
    const snapshots = [
      ...fridayNights.map((event) => held(event)),
      ...sundayNights.map((event) => held(event, [student.id])),
    ];

    expect(computeMiaByGathering([student], snapshots, settings)).toEqual([]);
  });

  it('lists a student who used to come to a gathering and stopped', () => {
    const student = makeStudent({ id: 'lapsed-friday', createdAt: LONG_AGO });
    const snapshots = [
      held(fridayNights[0]!, [student.id]),
      ...fridayNights.slice(1).map((event) => held(event)),
      ...sundayNights.map((event) => held(event, [student.id])),
    ];

    const rows = computeMiaByGathering([student], snapshots, settings);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gatheringKey: FRIDAY, gatheringTitle: 'Friday Fellowship' });
  });

  /*
   * The eligibility half of the same rule. Two Fridays and two Sundays is four
   * nights, and pooling them cleared a three-miss threshold that neither
   * gathering could clear on its own.
   */
  it('measures the threshold against one gathering at a time', () => {
    const student = makeStudent({ id: 'thin-history', createdAt: LONG_AGO });
    const snapshots = [
      held(fridayNights[2]!, [student.id]),
      ...fridayNights.slice(3).map((event) => held(event)),
      held(sundayNights[2]!, [student.id]),
      ...sundayNights.slice(3).map((event) => held(event)),
    ];

    expect(computeMia([student], snapshots, settings)).toEqual([]);
  });

  it('gives a student one row per gathering they have drifted from', () => {
    const student = makeStudent({ id: 'gone-quiet', createdAt: LONG_AGO });
    const snapshots = [
      held(fridayNights[0]!, [student.id]),
      ...fridayNights.slice(1).map((event) => held(event)),
      held(sundayNights[1]!, [student.id]),
      ...sundayNights.slice(2).map((event) => held(event)),
    ];

    const rows = computeMiaByGathering([student], snapshots, settings);

    expect(rows.map((row) => [row.gatheringKey, row.consecutiveMisses])).toEqual([
      [FRIDAY, 4],
      [SUNDAY, 3],
    ]);
  });

  it('merges those rows into one call, keeping the worst streak', () => {
    const student = makeStudent({ id: 'gone-quiet', createdAt: LONG_AGO });
    const snapshots = [
      held(fridayNights[0]!, [student.id]),
      ...fridayNights.slice(1).map((event) => held(event)),
      held(sundayNights[1]!, [student.id]),
      ...sundayNights.slice(2).map((event) => held(event)),
    ];

    const merged = computeMia([student], snapshots, settings);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      consecutiveMisses: 4,
      gatheringKey: FRIDAY,
      alsoMissingCount: 1,
    });
  });

  it('leaves alsoMissingCount at zero when only one gathering is affected', () => {
    const student = makeStudent({ id: 'friday-only', createdAt: LONG_AGO });
    const snapshots = [
      held(fridayNights[0]!, [student.id]),
      ...fridayNights.slice(1).map((event) => held(event)),
      ...sundayNights.map((event) => held(event, [student.id])),
    ];

    expect(computeMia([student], snapshots, settings)[0]).toMatchObject({
      gatheringKey: FRIDAY,
      alsoMissingCount: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Who a gathering may expect                                                  */
/* -------------------------------------------------------------------------- */

/*
 * The roster is every student in the ministry, not a promise that each of them
 * attends everything. So a miss needs an expectation behind it, and the
 * expectation is the one check-in already computes: the Recent rule, asked as
 * of the student's last visit. Without it the MIA list fills up with people who
 * dropped in once in the spring and were never coming weekly.
 */
describe('computeMia and the expectation behind a miss', () => {
  const settings = makeSettings({
    miaConsecutiveMisses: 3,
    predictiveMinAttended: 2,
    predictiveOfLastN: 3,
  });
  // Oldest first: nights[0] is eight weeks back, nights[7] is the most recent.
  const nights = fridays(8);
  const snapshotsWith = (present: readonly number[]) =>
    nights.map((event, index) => held(event, present.includes(index) ? ['drop-in'] : []));

  it('says nothing about somebody who only ever dropped in once', () => {
    const student = makeStudent({ id: 'drop-in', createdAt: LONG_AGO });

    // One visit, with three nights behind it they were not at: 1 of 3 has never
    // been the Recent bar, so nobody was expecting them the following week.
    expect(computeMia([student], snapshotsWith([3]), settings)).toEqual([]);
  });

  it('lists a regular who stopped, counting only the nights since', () => {
    const student = makeStudent({ id: 'drop-in', createdAt: LONG_AGO });

    // Three in a row, then three missed: the shape of somebody drifting away.
    const mia = computeMia([student], snapshotsWith([2, 3, 4]), settings);

    expect(mia).toHaveLength(1);
    expect(mia[0]!.consecutiveMisses).toBe(3);
  });

  it('takes its idea of a regular from the predictive settings', () => {
    const student = makeStudent({ id: 'drop-in', createdAt: LONG_AGO });
    const snapshots = snapshotsWith([3]);
    const looser = makeSettings({
      miaConsecutiveMisses: 3,
      predictiveMinAttended: 1,
      predictiveOfLastN: 3,
    });

    // A ministry that counts one visit in three as "we expect them" gets the
    // longer list it asked for, from the same field the door screen reads.
    expect(computeMia([student], snapshots, settings)).toEqual([]);
    expect(computeMia([student], snapshots, looser)).toHaveLength(1);
  });

  /*
   * The quick-added visitor, and the reason `wasRegular` is measured over the
   * gathering's history rather than over the nights since the student joined:
   * measured the second way, their first night is the oldest one they are
   * eligible for, nothing sits behind it, and the clamp waves every one-visit
   * visitor through as a regular.
   */
  it('does not turn a visitor who came once into a regular', () => {
    const visitor = makeStudent({
      id: 'drop-in',
      isVisitor: true,
      // Quick-added at the door on the night they first came, as `checkIn` does.
      createdAt: new Date(nights[3]!.startAt.getTime() - 12 * 60_000),
      firstAttendedAt: nights[3]!.startAt,
    });

    expect(computeMia([visitor], snapshotsWith([3]), settings)).toEqual([]);
  });

  /*
   * The clamp, and the reason for it: there is nothing behind the oldest night
   * in the window to judge a visit by. Excluding them would drop a genuine
   * drifter whose last night is exactly where the window ends.
   */
  it('trusts a visit at the very edge of the window, having nothing behind it', () => {
    const student = makeStudent({ id: 'drop-in', createdAt: LONG_AGO });

    expect(computeMia([student], snapshotsWith([0]), settings)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* computeUnseen                                                               */
/* -------------------------------------------------------------------------- */

describe('computeUnseen', () => {
  const settings = makeSettings({ miaConsecutiveMisses: 3 });
  // Three Fridays, so one gathering on its own reaches the threshold — see the
  // "three gatherings' first nights" case below for why that matters.
  const fridayNights = fridays(3);
  const sundayNights = makeWeeklyEvents({ count: 2, seriesId: SUNDAY, title: 'Sunday School' });
  const everything = [
    ...fridayNights.map((event) => held(event)),
    ...sundayNights.map((event) => held(event)),
  ];

  /*
   * The student no gathering can claim. Naming one on their row would be a
   * guess about which crowd they used to belong to, so the row names none —
   * and the count is pooled, because missing everything is the whole point.
   */
  it('lists a student the window has not seen at anything, naming no gathering', () => {
    const student = makeStudent({
      id: 'ghost',
      createdAt: LONG_AGO,
      lastAttendedAt: CAME_ONCE_LONG_AGO,
    });

    const rows = computeUnseen([student], everything, settings);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      // Every night, everywhere, since they joined — which is what the row says.
      consecutiveMisses: 5,
      gatheringKey: null,
      gatheringTitle: null,
      lastAttendedEventTitle: null,
    });
  });

  it('says nothing about a student some gathering has seen', () => {
    const student = makeStudent({ id: 'seen-once', createdAt: LONG_AGO });
    const snapshots = [held(fridayNights[0]!, [student.id]), ...everything.slice(1)];

    expect(computeUnseen([student], snapshots, settings)).toEqual([]);
  });

  /* "Met once, never since" tells their story better, and two lists asking for
     the same phone call is how a call list stops being worked. */
  it('leaves a student we met at a one-off to the one-off list', () => {
    const guest = makeStudent({ id: 'guest', createdAt: LONG_AGO });
    const retreat = makeOneOff({ id: 'retreat', startAt: new Date(2026, 0, 26, 9, 0) });

    expect(
      computeUnseen([guest], [...everything, makeSnapshot(retreat, [guest.id])], settings),
    ).toEqual([]);
  });

  /*
   * Reported from a real setup: three recurring gatherings, each one meeting
   * once, and every student who had not been to any of them appeared as "3
   * unseen" after a single week. Pooled, the trigger measured how many
   * gatherings the ministry runs rather than how long anybody had been away.
   */
  it('does not add three gatherings\u2019 first nights into one streak', () => {
    const student = makeStudent({
      id: 'ghost',
      createdAt: LONG_AGO,
      lastAttendedAt: CAME_ONCE_LONG_AGO,
    });
    const openingNight = [FRIDAY, SUNDAY, 'wednesday-prayer'].map((seriesId, index) =>
      held(
        makeEvent({
          id: `${seriesId}-opening`,
          seriesId,
          startAt: new Date(2026, 1, 9 + index, 19, 0),
          endAt: new Date(2026, 1, 9 + index, 21, 0),
        }),
      ),
    );

    expect(computeUnseen([student], openingNight, settings)).toEqual([]);

    // A third night of one of them, and now something really has been missed.
    const twoMore = [1, 2].map((week) =>
      held(
        makeEvent({
          id: `${FRIDAY}-week-${week}`,
          seriesId: FRIDAY,
          startAt: new Date(2026, 1, 9 + week * 7, 19, 0),
          endAt: new Date(2026, 1, 9 + week * 7, 21, 0),
        }),
      ),
    );

    expect(computeUnseen([student], [...openingNight, ...twoMore], settings)).toHaveLength(1);
  });

  it('waits until enough nights have passed since they joined the roster', () => {
    const student = makeStudent({
      id: 'brand-new',
      createdAt: new Date(fridayNights[1]!.startAt.getTime() - 3_600_000),
    });

    expect(computeUnseen([student], everything, settings)).toEqual([]);
  });

  it('excludes inactive students, who have already been followed up on', () => {
    const gone = makeStudent({
      id: 'graduated',
      status: 'inactive',
      createdAt: LONG_AGO,
      lastAttendedAt: CAME_ONCE_LONG_AGO,
    });

    expect(computeUnseen([gone], everything, settings)).toEqual([]);
  });

  /*
   * The roster is the ministry's Planning Center directory, which is full of
   * young people who have never come to youth group. None of them is missing —
   * nobody has met them — and listing them is the same "nobody was expecting
   * them" mistake the named rows already avoid.
   */
  it('says nothing about somebody Tally has never checked in', () => {
    const stranger = makeStudent({ id: 'never-came', createdAt: LONG_AGO });

    expect(stranger.lastAttendedAt).toBeNull();
    expect(computeUnseen([stranger], everything, settings)).toEqual([]);
  });

  it('ignores a last-seen timestamp that is not a date', () => {
    const corrupt = makeStudent({
      id: 'corrupt',
      createdAt: LONG_AGO,
      lastAttendedAt: new Date(Number.NaN),
    });

    // An unusable date fails every comparison silently, which is how a student
    // ends up on a call list nobody can explain.
    expect(computeUnseen([corrupt], everything, settings)).toEqual([]);
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

  it('attributes a first-timer to the gathering they walked into', () => {
    const student = makeStudent({
      id: 'friday-arrival',
      firstAttendedAt: new Date(NOW.getTime() - 3 * 86_400_000),
    });
    const sundays = makeWeeklyEvents({ count: 2, seriesId: SUNDAY, title: 'Sunday School' });

    const [visitor] = computeNewVisitors(
      [student],
      [
        makeSnapshot(events[1]!, [student.id]),
        ...sundays.map((event) => makeSnapshot(event, ['someone-else'])),
      ],
      settings,
      NOW,
    );

    expect(visitor!.gatheringKey).toBe(FRIDAY);
    expect(visitor!.viaOneOff).toBe(false);
  });

  /*
   * Somebody met on the retreat bus is a different follow-up: there is no next
   * instance of a trip for them to come back to, so the invitation has to name
   * a gathering. The row is flagged rather than filed under one.
   */
  it('flags a first-timer we met at a one-off, and files them under no gathering', () => {
    const student = makeStudent({
      id: 'retreat-arrival',
      firstAttendedAt: new Date(NOW.getTime() - 3 * 86_400_000),
    });
    const retreat = makeOneOff({
      id: 'retreat',
      title: 'Winter Retreat',
      startAt: new Date(NOW.getTime() - 3 * 86_400_000),
    });

    const [visitor] = computeNewVisitors([student], [makeSnapshot(retreat, [student.id])], settings, NOW);

    expect(visitor!.viaOneOff).toBe(true);
    expect(visitor!.gatheringKey).toBeNull();
    expect(visitor!.firstEventTitle).toBe('Winter Retreat');
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

  /*
   * The bug this list had for as long as a roster came from Planning Center: a
   * roster row carries `profileComplete: null`, so a filter that only accepted
   * `false` found nothing — on a screen whose follow-up rows above were saying
   * "Planning Center has no parent contact for this student" out loud.
   */
  it('lists a roster student Planning Center holds no parent contact for', () => {
    const unreachable = makeStudent({ id: 'pco_1', profileComplete: null });
    const reachable = makeStudent({ id: 'pco_2', profileComplete: null });

    const incomplete = computeIncompleteProfiles(
      [unreachable, reachable],
      new Map([
        ['pco_1', false],
        ['pco_2', true],
      ]),
    );

    expect(incomplete.map((s) => s.id)).toEqual(['pco_1']);
  });

  it('says nothing about a student nobody has checked', () => {
    // An unanswered roster row is not an unreachable one. Reading the two the
    // same way would put the whole ministry on a follow-up list the moment
    // Planning Center went quiet.
    const unchecked = makeStudent({ id: 'pco_1', profileComplete: null });

    expect(computeIncompleteProfiles([unchecked])).toEqual([]);
    expect(computeIncompleteProfiles([unchecked], new Map())).toEqual([]);
  });

  it('keeps a quick-added visitor Planning Center has never heard of', () => {
    // They exist only in Tally, so the check has no answer for them — and their
    // document already knows there is no parent contact on it.
    const visitor = makeStudent({ id: 'tally-1', profileComplete: false, isVisitor: true });

    expect(computeIncompleteProfiles([visitor], new Map()).map((s) => s.id)).toEqual(['tally-1']);
  });

  /*
   * The gap between a push and the next roster read, which used to be for ever.
   *
   * A visitor quick-added at a door keeps the id Tally gave them until a roster
   * read brings them back as a Planning Center person. Their document said
   * `profileComplete: false` throughout, and the flag outranks Planning
   * Center's answer — so a parent contact typed into Tally, written upstream
   * and confirmed by the very next read left them on this list anyway, with
   * nothing anybody could do about it.
   */
  it('takes Planning Center\'s answer for a visitor whose push has landed', () => {
    const pushed = makeStudent({
      id: 'tally-1',
      isVisitor: true,
      pcoPersonId: '4200099',
      // What `toStudent` reports once a document carries an upstream id: the
      // answer is Planning Center's now, and nobody has asked yet.
      profileComplete: null,
    });

    // Filed under the id Planning Center gave them, which is not the id their
    // row still has.
    expect(computeIncompleteProfiles([pushed], new Map([['pco_4200099', false]]))).toHaveLength(1);
    expect(computeIncompleteProfiles([pushed], new Map([['pco_4200099', true]]))).toEqual([]);
  });

  it('still trusts Tally about a visitor who exists nowhere else', () => {
    // No upstream id, so there is no upstream answer to prefer — and a stray
    // entry under their own id must not talk the list out of a fact their
    // document is certain about.
    const own = makeStudent({ id: 'tally-1', isVisitor: true, profileComplete: false });

    expect(computeIncompleteProfiles([own], new Map([['tally-1', true]])).map((s) => s.id)).toEqual([
      'tally-1',
    ]);
  });

  it('sorts a roster student behind the visitors, oldest last', () => {
    const visitor = makeStudent({
      id: 'tally-1',
      profileComplete: false,
      isVisitor: true,
      createdAt: new Date(2026, 1, 6, 19, 0),
    });
    // Roster students carry the epoch as `createdAt` — see `fromRosterPerson`.
    const rosterStudent = makeStudent({
      id: 'pco_1',
      profileComplete: null,
      createdAt: new Date(0),
    });

    const incomplete = computeIncompleteProfiles(
      [rosterStudent, visitor],
      new Map([['pco_1', false]]),
    );

    expect(incomplete.map((s) => s.id)).toEqual(['tally-1', 'pco_1']);
  });

  /*
   * The students directory offers this same count as a filter chip, and used to
   * compute it itself from `profileComplete === false` — which is `null` for
   * every roster student — so the two screens showed different numbers under
   * the same three words, one click apart in the same sidebar. They share the
   * predicate now; this is the test that keeps them sharing it.
   */
  /*
   * The row-level form and the map-level form are the same rule. They were
   * written out by hand in three places at one point and one copy had already
   * dropped the `status` check, which is what a shared predicate is for.
   */
  it('resolves a single student the same way as the whole map', () => {
    const rosterUnreachable = makeStudent({ id: 'pco_1', profileComplete: null });
    const visitor = makeStudent({ id: 'tally-1', profileComplete: false });
    const reachable = new Map([['pco_1', false]]);

    for (const student of [rosterUnreachable, visitor]) {
      expect(hasNoParentContact(student.profileComplete, reachable.get(student.id))).toBe(
        isUnreachable(student, reachable),
      );
    }
  });

  it('is the predicate the students directory filters on', () => {
    const rosterUnreachable = makeStudent({ id: 'pco_1', profileComplete: null });
    const rosterReachable = makeStudent({ id: 'pco_2', profileComplete: null });
    const visitor = makeStudent({ id: 'tally-1', profileComplete: false, isVisitor: true });
    const inactive = makeStudent({ id: 'pco_3', profileComplete: false, status: 'inactive' });
    const roster = [rosterUnreachable, rosterReachable, visitor, inactive];
    const reachable = new Map([
      ['pco_1', false],
      ['pco_2', true],
    ]);

    // Sorted on both sides: the list orders visitors first for the screen that
    // works it, and the chip only ever asks who is in the set.
    const filtered = roster.filter((student) => isUnreachable(student, reachable)).map((s) => s.id);
    const listed = computeIncompleteProfiles(roster, reachable).map((s) => s.id);

    expect(filtered.toSorted()).toEqual(listed.toSorted());
    expect(filtered).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* seenAt                                                                      */
/* -------------------------------------------------------------------------- */

describe('seenAt', () => {
  const events = fridays(3);
  const friday = (snapshots: EventAttendanceSnapshot[]) =>
    groupByGathering(snapshots)[0]!;

  it('keeps the students this gathering has actually seen', () => {
    const gathering = friday([
      held(events[0]!, ['a']),
      held(events[1]!),
      held(events[2]!, ['b']),
    ]);
    const students = [makeStudent({ id: 'a' }), makeStudent({ id: 'b' }), makeStudent({ id: 'c' })];

    expect(seenAt(gathering, students).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('leaves the order it was given alone', () => {
    // The lists that pass through here are already sorted for the screen —
    // freshest to-do first — and re-sorting them by attendance would shuffle a
    // call list every time a tab was pressed.
    const gathering = friday([held(events[0]!, ['b', 'a'])]);
    const students = [makeStudent({ id: 'b' }), makeStudent({ id: 'a' })];

    expect(seenAt(gathering, students).map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('says nobody when this gathering has not seen them', () => {
    /*
     * Which is the honest answer under a tab, not a reason to fall back to the
     * whole ministry: a Sunday-only student with no parent contact is still on
     * "All", where a leader looking at the roster rather than at one night will
     * find them.
     */
    const gathering = friday([held(events[0]!, ['a'])]);

    expect(seenAt(gathering, [makeStudent({ id: 'sunday-only' })])).toEqual([]);
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

    expect(trend.flatMap((point) => point.eventIds)).toEqual([
      `${FRIDAY}-3`,
      `${FRIDAY}-2`,
      `${FRIDAY}-1`,
    ]);
    expect(trend.map((point) => point.count)).toEqual([1, 2, 3]);
    expect(trend[0]).toMatchObject({ title: 'Friday Fellowship' });
    expect(trend[0]!.date).toEqual(events[0]!.startAt);
  });

  it('filters to a single gathering when asked', () => {
    const sundays = makeWeeklyEvents({ count: 2, seriesId: SUNDAY, title: 'Sunday School' });
    const snapshots = [
      ...events.map((event) => makeSnapshot(event, ['a'])),
      ...sundays.map((event) => makeSnapshot(event, ['b', 'c'])),
    ];

    const trend = computeAttendanceTrend(snapshots, { gatheringKey: SUNDAY });

    expect(trend).toHaveLength(2);
    expect(trend.every((point) => point.title === 'Sunday School')).toBe(true);
  });

  /*
   * A weekly gathering created in the app has a recurrence root and no series
   * document. Keying the strip on `seriesId` drew it a chart of nothing.
   */
  it('groups a series-less chain of repeats by its recurrence root', () => {
    const rooted = makeWeeklyEvents({ count: 2, seriesId: 'small-group' }).map((event) =>
      makeEvent({ ...event, seriesId: null, recurrenceRootId: 'tuesday-root' }),
    );
    const snapshots = [
      ...events.map((event) => makeSnapshot(event, ['a'])),
      ...rooted.map((event) => makeSnapshot(event, ['b'])),
    ];

    const trend = computeAttendanceTrend(snapshots, { gatheringKey: 'tuesday-root' });

    expect(trend).toHaveLength(2);
  });

  it('excludes one-off and cancelled gatherings', () => {
    const snapshots = [
      makeSnapshot(events[0]!, ['a']),
      makeSnapshot(makeOneOff({ id: 'retreat', startAt: new Date(2026, 1, 7, 9, 0) }), ['a', 'b']),
      // With attendance on it, so the exclusion is the status and nothing else.
      makeSnapshot(makeEvent({ ...events[1]!, status: 'cancelled' }), ['a']),
    ];

    expect(computeAttendanceTrend(snapshots).flatMap((point) => point.eventIds)).toEqual([
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
    expect(trend.flatMap((point) => point.eventIds)).toEqual([`${FRIDAY}-3`, `${FRIDAY}-1`]);
    expect(trend.every((point) => point.count > 0)).toBe(true);
  });

  it('keeps the most recent `limit` points and still returns them oldest first', () => {
    const many = makeWeeklyEvents({ count: 10, seriesId: FRIDAY });
    const trend = computeAttendanceTrend(
      many.map((event) => makeSnapshot(event, ['a'])),
      { limit: 3 },
    );

    expect(trend.flatMap((point) => point.eventIds)).toEqual([
      `${FRIDAY}-3`,
      `${FRIDAY}-2`,
      `${FRIDAY}-1`,
    ]);
  });

  it('defaults to the last eight days', () => {
    const many = makeWeeklyEvents({ count: 12, seriesId: FRIDAY });
    const trend = computeAttendanceTrend(many.map((event) => makeSnapshot(event, ['a'])));

    expect(trend).toHaveLength(8);
    expect(trend.at(-1)!.eventIds).toEqual([`${FRIDAY}-1`]);
  });

  /*
   * Two gatherings on one Sunday drew two bars a day apart on a strip labelled
   * by date, which reads as two days — one of them apparently half-attended.
   */
  describe('a day that held more than one gathering', () => {
    // Sunday School in the morning, an evening service the same night.
    const morning = makeEvent({
      id: 'sunday-morning',
      title: 'Sunday School',
      seriesId: SUNDAY,
      startAt: new Date(2026, 1, 8, 9, 30),
      endAt: new Date(2026, 1, 8, 10, 45),
    });
    const evening = makeEvent({
      id: 'sunday-evening',
      title: 'Evening Service',
      seriesId: 'sunday-evening',
      startAt: new Date(2026, 1, 8, 18, 0),
      endAt: new Date(2026, 1, 8, 19, 30),
    });

    it('draws one bar, adding the gatherings up', () => {
      const trend = computeAttendanceTrend([
        makeSnapshot(morning, ['a', 'b', 'c']),
        makeSnapshot(evening, ['a', 'd']),
      ]);

      expect(trend).toHaveLength(1);
      expect(trend[0]!.count).toBe(5);
      expect(trend[0]!.eventIds).toEqual(['sunday-evening', 'sunday-morning']);
      // Named so a tooltip can say what the bar is made of.
      expect(trend[0]!.title).toBe('Evening Service + Sunday School');
      // Stamped with when the day started, not with whichever was read first.
      expect(trend[0]!.date).toEqual(morning.startAt);
    });

    it('still charts each gathering on its own when one is asked for', () => {
      const snapshots = [makeSnapshot(morning, ['a', 'b', 'c']), makeSnapshot(evening, ['a', 'd'])];

      expect(computeAttendanceTrend(snapshots, { gatheringKey: SUNDAY })).toMatchObject([
        { count: 3, title: 'Sunday School' },
      ]);
    });

    it('counts days rather than events against the limit', () => {
      const fridayNights = fridays(8);
      const trend = computeAttendanceTrend(
        [
          ...fridayNights.map((event) => makeSnapshot(event, ['a'])),
          makeSnapshot(morning, ['a']),
          makeSnapshot(evening, ['a']),
        ],
        { limit: 3 },
      );

      // Three bars, and the busy Sunday is one of them rather than two.
      expect(trend).toHaveLength(3);
    });
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
      mia: [
        {
          student,
          consecutiveMisses: 3,
          lastAttendedAt: null,
          lastAttendedEventTitle: null,
          gatheringKey: FRIDAY,
          gatheringTitle: 'Friday Fellowship',
          alsoMissingCount: 0,
        },
      ],
      newVisitors: [
        {
          student,
          firstEventId: 'e1',
          firstEventTitle: 'Friday Fellowship',
          firstAttendedAt: NOW,
          gatheringKey: FRIDAY,
          viaOneOff: false,
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

/* -------------------------------------------------------------------------- */
/* One-off events                                                              */
/* -------------------------------------------------------------------------- */

describe('computeOneOffRecaps', () => {
  const retreat = makeOneOff({
    id: 'retreat',
    title: 'Winter Retreat',
    startAt: new Date(2026, 0, 26, 9, 0),
  });
  const busTrip = makeOneOff({
    id: 'bus-trip',
    title: 'Six Flags',
    startAt: new Date(2026, 1, 7, 8, 0),
  });

  it('recaps the head count of each one-off, newest first', () => {
    const recaps = computeOneOffRecaps([
      makeSnapshot(retreat, ['a', 'b']),
      makeSnapshot(busTrip, ['a', 'b', 'c']),
      held(fridays(1)[0]!),
    ]);

    expect(recaps.map((recap) => [recap.event.id, recap.count])).toEqual([
      ['bus-trip', 3],
      ['retreat', 2],
    ]);
  });

  it('leaves out a trip nobody was checked into', () => {
    expect(computeOneOffRecaps([makeSnapshot(retreat, [])])).toEqual([]);
  });

  it('keeps the most recent `limit` of them', () => {
    const trips = [retreat, busTrip].map((event) => makeSnapshot(event, ['a']));

    expect(computeOneOffRecaps(trips, { limit: 1 }).map((recap) => recap.event.id)).toEqual([
      'bus-trip',
    ]);
  });
});

describe('computeOneOffOnly', () => {
  // Fridays fall on Jan 23, Jan 30 and Feb 6 relative to the fixed NOW.
  const fridayNights = fridays(3);
  const retreat = makeOneOff({
    id: 'retreat',
    title: 'Winter Retreat',
    startAt: new Date(2026, 0, 26, 9, 0),
  });

  /*
   * The friend somebody brought on the retreat bus. They are invisible in every
   * other list: never MIA, because they belong to no gathering, and off the
   * new-faces list the moment their first visit ages out of the window.
   */
  it('lists a student met at a one-off who has been to no gathering since', () => {
    const guest = makeStudent({ id: 'guest', createdAt: LONG_AGO });
    const rows = computeOneOffOnly(
      [guest],
      [...fridayNights.map((event) => held(event)), makeSnapshot(retreat, [guest.id, REGULAR])],
    );

    expect(studentIds(rows)).toEqual([guest.id]);
    expect(rows[0]).toMatchObject({ missedSince: 2, metAt: retreat.startAt });
    expect(rows[0]!.events.map((event) => event.id)).toEqual(['retreat']);
  });

  it('leaves out a student who has also been to a regular gathering', () => {
    const regular = makeStudent({ id: 'regular', createdAt: LONG_AGO });
    const rows = computeOneOffOnly(
      [regular],
      [
        held(fridayNights[0]!, [regular.id]),
        held(fridayNights[1]!),
        held(fridayNights[2]!),
        makeSnapshot(retreat, [regular.id, REGULAR]),
      ],
    );

    expect(rows).toEqual([]);
  });

  /*
   * A retreat that finished on Sunday has had no Friday after it. Telling a
   * leader to chase somebody they will see tomorrow night is how a call list
   * stops being read.
   */
  it('waits until a gathering has actually been held since the trip', () => {
    const guest = makeStudent({ id: 'guest', createdAt: LONG_AGO });
    const lastNight = makeOneOff({ id: 'lock-in', startAt: new Date(2026, 1, 12, 18, 0) });
    const rows = computeOneOffOnly(
      [guest],
      [...fridayNights.map((event) => held(event)), makeSnapshot(lastNight, [guest.id, REGULAR])],
    );

    expect(rows).toEqual([]);
  });

  it('excludes inactive students and unheld trips', () => {
    const gone = makeStudent({ id: 'moved-away', status: 'inactive', createdAt: LONG_AGO });
    const guest = makeStudent({ id: 'guest', createdAt: LONG_AGO });

    expect(
      computeOneOffOnly(
        [gone],
        [...fridayNights.map((event) => held(event)), makeSnapshot(retreat, [gone.id, REGULAR])],
      ),
    ).toEqual([]);

    // An empty trip is a trip that did not happen, so nobody was met on it.
    expect(
      computeOneOffOnly(
        [guest],
        [...fridayNights.map((event) => held(event)), makeSnapshot(retreat, [])],
      ),
    ).toEqual([]);
  });

  it('orders the freshest meeting first', () => {
    const early = makeStudent({ id: 'early', createdAt: LONG_AGO });
    const late = makeStudent({ id: 'late', createdAt: LONG_AGO });
    const lockIn = makeOneOff({ id: 'lock-in', startAt: new Date(2026, 1, 2, 18, 0) });

    const rows = computeOneOffOnly(
      [early, late],
      [
        ...fridayNights.map((event) => held(event)),
        makeSnapshot(retreat, [early.id, REGULAR]),
        makeSnapshot(lockIn, [late.id, REGULAR]),
      ],
    );

    expect(studentIds(rows)).toEqual([late.id, early.id]);
  });
});
