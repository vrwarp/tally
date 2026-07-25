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
  computeNewVisitors,
  computeSummary,
} from './insights';
import type { EventAttendanceSnapshot, Student } from '@/types';

const NOW = new Date('2026-02-13T19:30:00');

interface DashboardInput {
  students: Student[];
  snapshots: EventAttendanceSnapshot[];
  settings: ReturnType<typeof arbitrarySettings>;
}

function arbitraryDashboard(rng: Rng): DashboardInput {
  const students = Array.from({ length: rng.int(0, 20) }, () => arbitraryStudent(rng));
  const snapshots = Array.from({ length: rng.int(0, 12) }, (_, index) => {
    const startAt = new Date(NOW.getTime() - (index + 1) * 7 * 86_400_000);
    const event = arbitraryEvent(rng, {
      startAt,
      endAt: new Date(startAt.getTime() + 2 * 3_600_000),
      mode: rng.bool(0.85) ? 'recurring' : 'oneoff',
      status: rng.bool(0.9) ? 'scheduled' : 'cancelled',
    });
    return {
      event,
      presentStudentIds: new Set(students.filter(() => rng.bool(0.5)).map((s) => s.id)),
    };
  });

  return { students, snapshots, settings: arbitrarySettings(rng) };
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
   * `profileComplete` has three states, and only one of them is a problem.
   * `null` means a roster read did not hydrate households and so nobody has
   * checked — listing those as "no way to reach a parent" would hand the core
   * team a follow-up list containing the entire ministry.
   */
  forAll('incomplete profiles are exactly the active, known-unreachable ones', arbitraryDashboard, (input) => {
    const incomplete = computeIncompleteProfiles(input.students);

    for (const student of incomplete) {
      expect(student.status).toBe('active');
      expect(student.profileComplete).toBe(false);
    }

    const expected = input.students.filter(
      (student) => student.status === 'active' && student.profileComplete === false,
    ).length;
    expect(incomplete).toHaveLength(expected);
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
