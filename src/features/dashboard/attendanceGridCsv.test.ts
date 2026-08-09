/**
 * The grid, and the four ways a `0` in it would be a lie.
 *
 * Every assertion here is about a cell that must *not* say a named child missed
 * a gathering: one nobody was allowed to read, one that never happened, one held
 * before they were on the roster, and one whose attendance is filed under the
 * row they were merged out of.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAttendanceGrid,
  buildAttendanceGridCsv,
} from '@/features/dashboard/attendanceGridCsv';
import { makeEvent, makeStudent } from '../../../tests/factories';
import type { EventAttendanceSnapshot, Student, TallyEvent } from '@/types';

function snapshot(
  event: TallyEvent,
  present: string[],
  held = present.length > 0,
): EventAttendanceSnapshot {
  return {
    event,
    presentStudentIds: new Set(present),
    checkedOutStudentIds: new Set(),
    held,
  };
}

function night(day: number, id = `evt-${day}`): TallyEvent {
  return makeEvent({ id, startAt: new Date(2026, 4, day, 19, 0), endAt: new Date(2026, 4, day, 21, 0) });
}

const JOINED_LONG_AGO = new Date(2026, 0, 1);
const AMARA = makeStudent({ id: 'pco_1', firstName: 'Amara', lastName: 'Okafor', createdAt: JOINED_LONG_AGO });
const BEN = makeStudent({ id: 'pco_2', firstName: 'Ben', lastName: 'Cole', createdAt: JOINED_LONG_AGO });

function grid(snapshots: EventAttendanceSnapshot[], students: Student[], denied?: Set<string>) {
  return buildAttendanceGrid({ snapshots, students, denied });
}

function csvRows(csv: string): string[][] {
  return csv.trimEnd().split('\r\n').map((line) => line.split(','));
}

describe('buildAttendanceGrid — columns', () => {
  it('orders nights oldest first, so the columns read like a calendar', () => {
    const result = grid([snapshot(night(15), ['pco_1']), snapshot(night(1), ['pco_1'])], [AMARA]);
    expect(result.nights.map((entry) => entry.event.id)).toEqual(['evt-1', 'evt-15']);
  });

  it('leaves out a night nobody was checked in at, and counts it', () => {
    // `presumed-cancelled` everywhere else in the app. A column of zeros here
    // would say every student missed a gathering that did not happen.
    const result = grid(
      [snapshot(night(1), ['pco_1']), snapshot(night(8), [], false)],
      [AMARA],
    );
    expect(result.nights).toHaveLength(1);
    expect(result.presumedCancelled).toBe(1);
  });

  it('leaves out a cancelled night', () => {
    const cancelled = makeEvent({ id: 'evt-8', status: 'cancelled', startAt: new Date(2026, 4, 8) });
    const result = grid([snapshot(night(1), ['pco_1']), snapshot(cancelled, [])], [AMARA]);
    expect(result.nights).toHaveLength(1);
  });

  it('counts the nights this reader was refused, which have no column at all', () => {
    // The worst available failure: a spreadsheet asserting a child missed
    // gatherings nobody was allowed to look at.
    const result = grid([snapshot(night(1), ['pco_1'])], [AMARA], new Set(['evt-8', 'evt-15']));
    expect(result.nights).toHaveLength(1);
    expect(result.denied).toBe(2);
  });
});

describe('buildAttendanceGrid — eligibility', () => {
  it('blanks the nights held before a student joined, and excludes them from the rate', () => {
    const late = makeStudent({
      id: 'pco_3',
      firstName: 'Chidi',
      lastName: 'Eze',
      createdAt: new Date(2026, 4, 10),
    });
    const result = grid(
      [snapshot(night(1), ['pco_1']), snapshot(night(15), ['pco_1', 'pco_3'])],
      [late],
    );

    const row = result.rows[0]!;
    expect(row.cells).toEqual([undefined, true]);
    // One eligible night, attended — 100%, not the 50% a zero would produce.
    expect(row.nights).toBe(1);
    expect(row.attended).toBe(1);
  });

  it('counts a night somebody was eligible for and missed', () => {
    const result = grid(
      [snapshot(night(1), ['pco_1']), snapshot(night(15), ['pco_1'])],
      [BEN],
    );
    expect(result.rows[0]!.cells).toEqual([false, false]);
    expect(result.rows[0]!.nights).toBe(2);
    expect(result.rows[0]!.attended).toBe(0);
  });
});

describe('buildAttendanceGrid — merged students', () => {
  it('folds a merged row’s attendance into the keeper, as the profile does', () => {
    // A merge does not re-key attendance. Without this the same child is two
    // partial rows and neither one sums to the truth.
    const keeper = {
      ...makeStudent({ id: 'pco_1', createdAt: JOINED_LONG_AGO }),
      mergedFromStudentIds: ['pco_9'],
    };
    const result = grid(
      [snapshot(night(1), ['pco_9']), snapshot(night(15), ['pco_1'])],
      [keeper],
    );
    expect(result.rows[0]!.cells).toEqual([true, true]);
    expect(result.rows[0]!.attended).toBe(2);
  });
});

describe('buildAttendanceGridCsv', () => {
  const result = grid(
    [snapshot(night(1), ['pco_1']), snapshot(night(15), ['pco_1', 'pco_2'])],
    [AMARA, BEN],
  );
  const csv = buildAttendanceGridCsv(result, { backends: [] });
  const rows = csvRows(csv);

  it('heads each night column with its date, sortable and locale-free', () => {
    expect(rows[0]).toContain('2026-05-01');
    expect(rows[0]).toContain('2026-05-15');
  });

  it('never names its first column ID', () => {
    expect(rows[0]![0]).toBe('student_id');
  });

  it('writes cells as bare numbers, so a column sums', () => {
    const dateIndex = rows[0]!.indexOf('2026-05-01');
    expect(rows[1]![dateIndex]).toBe('1');
    expect(rows[2]![dateIndex]).toBe('0');
  });

  it('carries attended, nights and rate at the end', () => {
    const headers = rows[0]!;
    expect(headers.slice(-3)).toEqual(['attended', 'nights', 'rate']);
    expect(rows[1]![headers.indexOf('rate')]).toBe('100');
    expect(rows[2]![headers.indexOf('rate')]).toBe('50');
  });

  it('writes an empty cell, never a zero, for a night before the student joined', () => {
    const late = makeStudent({ id: 'pco_3', createdAt: new Date(2026, 4, 10) });
    const lateGrid = grid(
      [snapshot(night(1), ['pco_1']), snapshot(night(15), ['pco_3'])],
      [late],
    );
    const lateRows = csvRows(buildAttendanceGridCsv(lateGrid, { backends: [] }));
    const dateIndex = lateRows[0]!.indexOf('2026-05-01');
    expect(lateRows[1]![dateIndex]).toBe('');
  });

  it('leaves the rate blank rather than dividing by zero', () => {
    const brandNew = makeStudent({ id: 'pco_4', createdAt: new Date(2026, 6, 1) });
    const emptyGrid = grid([snapshot(night(1), ['pco_1'])], [brandNew]);
    const emptyRows = csvRows(buildAttendanceGridCsv(emptyGrid, { backends: [] }));
    expect(emptyRows[1]![emptyRows[0]!.indexOf('rate')]).toBe('');
  });

  it('has no totals row', () => {
    // It breaks one-row-per-entity and confuses a pivot table.
    expect(rows).toHaveLength(3);
    expect(rows.some((line) => line[0]?.startsWith('__'))).toBe(false);
  });
});
