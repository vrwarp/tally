/**
 * Properties of the dashboard derivations.
 *
 * These lists become phone calls. A student wrongly on the MIA list gets an
 * awkward "we've missed you" from someone who saw them last Friday; a student
 * wrongly *off* it gets forgotten. Both matter, so the invariants below are
 * about membership being justified rather than about exact counts.
 */
import { describe, expect } from 'vitest';
import { forAll } from '../../../tests/fuzz/property';
import {
  arbitraryEvent,
  arbitrarySettings,
  arbitraryStudent,
} from '../../../tests/fuzz/arbitrary';
import type { Rng } from '../../../tests/fuzz/prng';
import {
  computeAttendanceTrend,
  computeIncompleteProfiles,
  computeMia,
  computeMiaByGathering,
  computeNewVisitors,
  computeOneOffOnly,
  computeSummary,
  groupByGathering,
  mergeMia,
  recurringSnapshots,
  seenAt,
  standingIn,
} from './insights';
import { chainKey } from '@/lib/materialize';
import type { EventAttendanceSnapshot, Student } from '@/types';

const NOW = new Date('2026-02-13T19:30:00');

interface DashboardInput {
  students: Student[];
  snapshots: EventAttendanceSnapshot[];
  settings: ReturnType<typeof arbitrarySettings>;
  /**
   * What the separate parent-contact read came back with, which for any given
   * student may not have come back at all. See `computeIncompleteProfiles`.
   */
  reachable: Map<string, boolean>;
}

function arbitraryDashboard(rng: Rng): DashboardInput {
  const students = Array.from({ length: rng.int(0, 20) }, () => arbitraryStudent(rng));
  const reachable = new Map<string, boolean>();
  for (const student of students) {
    if (rng.bool(0.3)) continue;
    reachable.set(student.id, rng.bool(0.5));
  }
  const snapshots = Array.from({ length: rng.int(0, 12) }, (_, index) => {
    const startAt = new Date(NOW.getTime() - (index + 1) * 7 * 86_400_000);
    const event = arbitraryEvent(rng, {
      startAt,
      endAt: new Date(startAt.getTime() + 2 * 3_600_000),
      mode: rng.bool(0.85) ? 'recurring' : 'oneoff',
      status: rng.bool(0.9) ? 'scheduled' : 'cancelled',
    });
    const present = new Set(students.filter(() => rng.bool(0.5)).map((s) => s.id));
    // A whole register, so an empty one is a gathering nobody came to — which is
    // exactly the case several of these properties are about.
    return {
      event,
      presentStudentIds: present,
      checkedOutStudentIds: new Set<string>(),
      held: present.size > 0,
    };
  });

  return { students, snapshots, settings: arbitrarySettings(rng), reachable };
}

describe('dashboard insight properties', () => {
  forAll('nothing throws, whatever the history looks like', arbitraryDashboard, (input) => {
    expect(() => computeMia(input.students, input.snapshots, input.settings)).not.toThrow();
    expect(() => computeNewVisitors(input.students, input.snapshots, input.settings, NOW)).not.toThrow();
    expect(() => computeIncompleteProfiles(input.students)).not.toThrow();
    expect(() => computeAttendanceTrend(input.snapshots)).not.toThrow();
  });

  forAll('every MIA entry is an active student who really missed enough', arbitraryDashboard, (input) => {
    const mia = computeMia(input.students, input.snapshots, input.settings);
    const known = new Set(input.students.map((student) => student.id));

    for (const entry of mia) {
      expect(known.has(entry.student.id)).toBe(true);
      // Inactive students have already been followed up on; calling them again
      // is the mistake this excludes.
      expect(entry.student.status).toBe('active');
      expect(entry.consecutiveMisses).toBeGreaterThanOrEqual(input.settings.miaConsecutiveMisses);
    }

    expect(new Set(mia.map((entry) => entry.student.id)).size).toBe(mia.length);
  });

  forAll('MIA is ordered longest-absent first, which is the order to work it', arbitraryDashboard, (input) => {
    const mia = computeMia(input.students, input.snapshots, input.settings);

    for (let i = 1; i < mia.length; i += 1) {
      expect(mia[i - 1]!.consecutiveMisses).toBeGreaterThanOrEqual(mia[i]!.consecutiveMisses);
    }
  });

  forAll('a one-off event never counts toward a missed streak', arbitraryDashboard, (input) => {
    const onlyOneOffs = input.snapshots.map((snapshot) => ({
      ...snapshot,
      event: { ...snapshot.event, mode: 'oneoff' as const },
    }));

    // Missing a retreat is not the same as drifting away from the ministry.
    expect(computeMia(input.students, onlyOneOffs, input.settings)).toEqual([]);
  });

  forAll('new visitors are only ever first-timers inside the window', arbitraryDashboard, (input) => {
    const visitors = computeNewVisitors(input.students, input.snapshots, input.settings, NOW);
    const windowStart = NOW.getTime() - input.settings.newVisitorWindowDays * 86_400_000;

    for (const visitor of visitors) {
      expect(visitor.student.firstAttendedAt).not.toBeNull();
      expect(visitor.firstAttendedAt.getTime()).toBeGreaterThanOrEqual(windowStart);
    }

    for (let i = 1; i < visitors.length; i += 1) {
      expect(visitors[i - 1]!.firstAttendedAt.getTime()).toBeGreaterThanOrEqual(
        visitors[i]!.firstAttendedAt.getTime(),
      );
    }
  });

  /*
   * The row names a night to a leader about to phone a family, so it may only
   * ever name one it can justify: either the attendance says they were there,
   * or the gathering began on the very instant check-in stamped onto them. An
   * instant two gatherings share justifies neither.
   */
  forAll('a named first event is one the data can account for', arbitraryDashboard, (input) => {
    const calendar = input.snapshots.map((snapshot) => snapshot.event);
    const visitors = computeNewVisitors(
      input.students,
      input.snapshots,
      input.settings,
      NOW,
      calendar,
    );

    for (const visitor of visitors) {
      if (!visitor.firstEventId) continue;

      const named = calendar.filter((event) => event.id === visitor.firstEventId);
      expect(named.length).toBeGreaterThan(0);

      const attended = input.snapshots.some(
        (snapshot) =>
          snapshot.event.id === visitor.firstEventId &&
          snapshot.presentStudentIds.has(visitor.student.id),
      );
      const startedThen =
        named.every((event) => event.startAt.getTime() === visitor.firstAttendedAt.getTime()) &&
        calendar.filter(
          (event) => event.startAt.getTime() === visitor.firstAttendedAt.getTime(),
        ).length === 1;

      expect(attended || startedThen).toBe(true);
    }
  });

  /*
   * The whole point of the split. A streak is a fact about one gathering, and a
   * row that counted another gathering's nights would put a Sunday regular on
   * the Friday call list — the exact phone call this list exists to avoid.
   */
  forAll('a streak never reaches past its own gathering', arbitraryDashboard, (input) => {
    const rows = computeMiaByGathering(input.students, input.snapshots, input.settings);
    const held = recurringSnapshots(input.snapshots);

    for (const row of rows.filter((candidate) => candidate.gatheringKey !== null)) {
      const nights = held.filter((snapshot) => chainKey(snapshot.event) === row.gatheringKey);

      expect(row.consecutiveMisses).toBeLessThanOrEqual(nights.length);
      // Whatever else is true, they were not at the most recent one.
      expect(nights[0]!.presentStudentIds.has(row.student.id)).toBe(false);
      // And this gathering could expect them, or it has no business naming
      // them: a roster is not a promise that everybody attends everything.
      const gathering = groupByGathering(input.snapshots).find(
        (candidate) => candidate.key === row.gatheringKey,
      );
      expect(standingIn(gathering!, row.student, input.settings).wasRegular).toBe(true);
    }
  });

  /*
   * The unnamed rows are the other half, and the halves must not overlap: a
   * student some gathering has seen belongs to that gathering's list, and one
   * nothing has seen belongs to nobody's.
   */
  forAll('a row that names no gathering is a student nothing has seen', arbitraryDashboard, (input) => {
    const rows = computeMiaByGathering(input.students, input.snapshots, input.settings);
    const held = recurringSnapshots(input.snapshots);

    for (const row of rows.filter((candidate) => candidate.gatheringKey === null)) {
      expect(row.gatheringTitle).toBeNull();
      expect(held.some((snapshot) => snapshot.presentStudentIds.has(row.student.id))).toBe(false);
      expect(row.consecutiveMisses).toBeGreaterThanOrEqual(input.settings.miaConsecutiveMisses);
      // Never both kinds of row for one student.
      expect(
        rows.filter((candidate) => candidate.student.id === row.student.id),
      ).toHaveLength(1);
    }
  });

  forAll('merging leaves one call per student, and says what it merged', arbitraryDashboard, (input) => {
    const rows = computeMiaByGathering(input.students, input.snapshots, input.settings);
    const merged = mergeMia(rows);

    expect(new Set(merged.map((row) => row.student.id)).size).toBe(merged.length);

    for (const row of merged) {
      const mine = rows.filter((candidate) => candidate.student.id === row.student.id);
      expect(row.alsoMissingCount).toBe(mine.length - 1);
      // The worst streak wins the row: it is the one worth leading with.
      expect(row.consecutiveMisses).toBe(
        Math.max(...mine.map((candidate) => candidate.consecutiveMisses)),
      );
    }

    expect(merged).toEqual(computeMia(input.students, input.snapshots, input.settings));
  });

  /*
   * "Met once, never since" is only ever about people no gathering has seen.
   * Anybody a Friday knows belongs to the MIA list instead, and appearing on
   * both would mean two leaders phoning the same family about opposite things.
   */
  forAll('the one-off list holds nobody a gathering has seen', arbitraryDashboard, (input) => {
    const rows = computeOneOffOnly(input.students, input.snapshots);
    const held = recurringSnapshots(input.snapshots);

    for (const row of rows) {
      expect(row.student.status).toBe('active');
      expect(row.events.length).toBeGreaterThan(0);
      // A gathering has been held since we met them, and they were at none.
      expect(row.missedSince).toBeGreaterThan(0);
      expect(held.some((snapshot) => snapshot.presentStudentIds.has(row.student.id))).toBe(false);
    }
  });

  /*
   * `profileComplete` has three states, and only one of them is a problem.
   * `null` means a roster read did not hydrate households and so the document
   * has not checked — the separate parent-contact read answers for those, and
   * where *it* is silent too nobody has checked at all. Listing an unchecked
   * student as "no way to reach a parent" would hand the core team a follow-up
   * list containing the entire ministry.
   */
  forAll('incomplete profiles are exactly the active, known-unreachable ones', arbitraryDashboard, (input) => {
    const incomplete = computeIncompleteProfiles(input.students, input.reachable);
    const unreachable = (student: Student) =>
      (student.profileComplete ?? input.reachable.get(student.id) ?? null) === false;

    for (const student of incomplete) {
      expect(student.status).toBe('active');
      expect(unreachable(student)).toBe(true);
    }

    const expected = input.students.filter(
      (student) => student.status === 'active' && unreachable(student),
    ).length;
    expect(incomplete).toHaveLength(expected);
  });

  forAll('an unanswered contact check never puts anybody on the list', arbitraryDashboard, (input) => {
    // The failure mode that matters here is a Planning Center outage reading as
    // "nobody in the ministry has a parent on file".
    const unchecked = computeIncompleteProfiles(input.students, new Map());

    for (const student of unchecked) {
      expect(student.profileComplete).toBe(false);
    }
  });

  /*
   * A tab may only ever hide rows, never invent one and never reorder what is
   * left. The lists it narrows are already sorted for the screen, and a call
   * list that reshuffles itself when somebody presses a tab is one nobody can
   * work down.
   */
  forAll('narrowing to a gathering is a subset, in order', arbitraryDashboard, (input) => {
    const incomplete = computeIncompleteProfiles(input.students, input.reachable);

    for (const gathering of groupByGathering(input.snapshots)) {
      const scoped = seenAt(gathering, incomplete);
      const attended = (id: string) =>
        gathering.snapshots.some((snapshot) => snapshot.presentStudentIds.has(id));

      expect(scoped.every((student) => attended(student.id))).toBe(true);
      expect(scoped).toEqual(incomplete.filter((student) => attended(student.id)));
    }
  });

  forAll('the trend is oldest-first and never longer than asked for', arbitraryDashboard, (input, rng) => {
    const limit = rng.int(1, 10);
    const trend = computeAttendanceTrend(input.snapshots, { limit });

    expect(trend.length).toBeLessThanOrEqual(limit);
    for (let i = 1; i < trend.length; i += 1) {
      expect(trend[i]!.date.getTime()).toBeGreaterThanOrEqual(trend[i - 1]!.date.getTime());
    }
    for (const point of trend) expect(point.count).toBeGreaterThanOrEqual(0);
  });

  /*
   * The cancelled-session rule, as a property. Zero attendance at a gathering
   * means it did not happen, so a window in which nobody was ever checked into
   * anything supports no conclusion at all: no phone calls, no bars, no numbers.
   */
  forAll('a history nobody attended yields no MIA list and no trend', arbitraryDashboard, (input) => {
    const nobodyCame = input.snapshots.map((snapshot) => ({
      ...snapshot,
      presentStudentIds: new Set<string>(),
      checkedOutStudentIds: new Set<string>(),
      held: false,
    }));

    expect(computeMia(input.students, nobodyCame, input.settings)).toEqual([]);
    expect(computeAttendanceTrend(nobodyCame)).toEqual([]);
  });

  forAll('the trend never plots a gathering with nobody at it', arbitraryDashboard, (input, rng) => {
    const trend = computeAttendanceTrend(input.snapshots, { limit: rng.int(1, 10) });

    // A zero bar is indistinguishable from a collapse in attendance, and the
    // average printed under the strip would be dragged down by a night off.
    for (const point of trend) expect(point.count).toBeGreaterThan(0);
  });

  forAll('the summary never counts more people than exist', arbitraryDashboard, (input) => {
    const mia = computeMia(input.students, input.snapshots, input.settings);
    const newVisitors = computeNewVisitors(input.students, input.snapshots, input.settings, NOW);
    const incomplete = computeIncompleteProfiles(input.students);
    const summary = computeSummary({ snapshots: input.snapshots, mia, newVisitors, incomplete });

    expect(summary.uniqueStudents).toBeLessThanOrEqual(input.students.length);
    expect(summary.miaCount).toBe(mia.length);
    expect(summary.newVisitorCount).toBe(newVisitors.length);
    expect(summary.incompleteCount).toBe(incomplete.length);
    for (const value of Object.values(summary)) expect(value).toBeGreaterThanOrEqual(0);
  });
});
