/**
 * The rule these assert is one of precedence, not of arithmetic: inside the
 * window the register decides, outside it the student document does, and the
 * boundary between them is what every case here is really about.
 */
import { describe, expect, it } from 'vitest';
import { reconcileSeen } from '@/features/students/seenDates';
import type { EventAttendanceSnapshot } from '@/types';
import { makeEvent, makeStudent } from '../../../tests/factories';

const STUDENT_ID = 'jamie';

/** A loaded night, with or without the student on it. */
function night(iso: string, present: boolean): EventAttendanceSnapshot {
  const startAt = new Date(iso);
  return {
    event: makeEvent({ id: `night-${iso}`, startAt, endAt: new Date(startAt.getTime() + 7_200_000) }),
    presentStudentIds: new Set(present ? [STUDENT_ID] : []),
    checkedOutStudentIds: new Set<string>(),
    held: true,
  };
}

function student(first: string | null, last: string | null) {
  return makeStudent({
    id: STUDENT_ID,
    firstAttendedAt: first ? new Date(first) : null,
    lastAttendedAt: last ? new Date(last) : null,
  });
}

describe('reconcileSeen', () => {
  it('overrules a stored date the window has disproved', () => {
    // The reported bug: a tap on 26 July that was taken back leaves the field
    // standing, and the profile printed it above a grid whose newest mark is a
    // month earlier.
    const seen = reconcileSeen(student('2026-07-26T19:00:00', '2026-07-26T19:00:00'), [
      night('2026-06-26T19:00:00', true),
      night('2026-07-26T19:00:00', false),
      night('2026-07-31T19:00:00', false),
    ]);

    expect(seen.lastSeenAt).toEqual(new Date('2026-06-26T19:00:00'));
    expect(seen.firstSeenAt).toEqual(new Date('2026-06-26T19:00:00'));
    expect(seen.unseenInWindow).toBe(false);
  });

  it('keeps a stored date no loaded night speaks to', () => {
    // Checked in an hour ago: `historyWindow` drops a gathering whose check-in
    // is still open, so tonight is not in the snapshots and nothing has
    // disproved it.
    const seen = reconcileSeen(student('2026-06-26T19:00:00', '2026-08-03T19:00:00'), [
      night('2026-06-26T19:00:00', true),
      night('2026-07-31T19:00:00', false),
    ]);

    expect(seen.lastSeenAt).toEqual(new Date('2026-08-03T19:00:00'));
  });

  it('reports the window sighting when the stored date is older', () => {
    const seen = reconcileSeen(student('2025-09-05T19:00:00', '2025-09-05T19:00:00'), [
      night('2026-06-26T19:00:00', true),
    ]);

    expect(seen.lastSeenAt).toEqual(new Date('2026-06-26T19:00:00'));
    // Nothing disproved the older date, and it reaches further back than the
    // window can see.
    expect(seen.firstSeenAt).toEqual(new Date('2025-09-05T19:00:00'));
  });

  it('moves first-seen back to a sighting earlier than the date on file', () => {
    // What a Planning Center history import fixes at the source, for the rows
    // it did not reach: the field says July, the register says June.
    const seen = reconcileSeen(student('2026-07-26T19:00:00', '2026-07-26T19:00:00'), [
      night('2026-06-26T19:00:00', true),
      night('2026-07-26T19:00:00', true),
    ]);

    expect(seen.firstSeenAt).toEqual(new Date('2026-06-26T19:00:00'));
    expect(seen.lastSeenAt).toEqual(new Date('2026-07-26T19:00:00'));
  });

  it('separates "not this year" from "never"', () => {
    const disproved = reconcileSeen(student('2026-07-26T19:00:00', '2026-07-26T19:00:00'), [
      night('2026-07-26T19:00:00', false),
    ]);
    expect(disproved.lastSeenAt).toBeNull();
    expect(disproved.unseenInWindow).toBe(true);

    const never = reconcileSeen(student(null, null), [night('2026-07-26T19:00:00', false)]);
    expect(never.lastSeenAt).toBeNull();
    expect(never.unseenInWindow).toBe(false);
  });

  it('hands back the stored pair while there is nothing to reconcile against', () => {
    // The history has not landed, or failed to. The page must not start
    // claiming a student was never seen because a read is in flight.
    const seen = reconcileSeen(student('2025-09-05T19:00:00', '2026-07-26T19:00:00'), []);

    expect(seen.firstSeenAt).toEqual(new Date('2025-09-05T19:00:00'));
    expect(seen.lastSeenAt).toEqual(new Date('2026-07-26T19:00:00'));
    expect(seen.unseenInWindow).toBe(false);
  });

  it('counts a night nobody attended as evidence of absence', () => {
    // `held: false` says the gathering did not happen, not that the register
    // went unread — the student's own records were still asked, and they are
    // not in them.
    const seen = reconcileSeen(student('2026-06-26T19:00:00', '2026-07-26T19:00:00'), [
      { ...night('2026-07-26T19:00:00', false), held: false },
      night('2026-06-26T19:00:00', true),
    ]);

    expect(seen.lastSeenAt).toEqual(new Date('2026-06-26T19:00:00'));
  });

  it('ignores a timestamp that is not a date', () => {
    const seen = reconcileSeen(
      makeStudent({
        id: STUDENT_ID,
        firstAttendedAt: new Date(Number.NaN),
        lastAttendedAt: new Date(Number.NaN),
      }),
      [night('2026-06-26T19:00:00', true)],
    );

    expect(seen.firstSeenAt).toEqual(new Date('2026-06-26T19:00:00'));
    expect(seen.lastSeenAt).toEqual(new Date('2026-06-26T19:00:00'));
  });
});
