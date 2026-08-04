/**
 * The payloads both entry points write, held to one shape.
 *
 * These are golden-output claims: the extraction from services/attendance.ts
 * must not have changed a single field, because the documents it produces are
 * the permanent record and the rules validate them field by field. The main
 * app's own behaviour is covered in attendance.test.ts; this file pins the
 * builders themselves, with the clock injected the way the kiosk injects it.
 */
import { describe, expect, it } from 'vitest';
import {
  attendancePayload,
  isFirstEver,
  studentDatePatch,
  type CheckInStudent,
} from '@/services/attendancePayloads';

const SENTINEL = Symbol('serverTimestamp');
const clock = { serverTimestamp: () => SENTINEL };

const event = { id: 'event-1', seriesId: 'friday', startAt: new Date('2026-08-07T19:00:00Z') };

function student(overrides: Partial<CheckInStudent> = {}): CheckInStudent {
  return {
    id: 'pco_123',
    firstName: 'Maya',
    lastName: 'Chen',
    grade: 9,
    gradeOnFile: undefined,
    searchName: 'maya chen',
    firstAttendedAt: null,
    lastAttendedAt: null,
    ...overrides,
  };
}

describe('attendancePayload', () => {
  it('produces exactly the stored shape, server clock included', () => {
    expect(
      attendancePayload(clock, {
        event,
        studentId: 'pco_123',
        uid: 'uid-1',
        method: 'kiosk',
        isFirstEver: true,
      }),
    ).toEqual({
      studentId: 'pco_123',
      eventId: 'event-1',
      seriesId: 'friday',
      checkedInAt: SENTINEL,
      checkedInBy: 'uid-1',
      method: 'kiosk',
      isFirstEver: true,
    });
  });

  it('keeps a supplied moment instead of the clock — the swap case', () => {
    const arrived = new Date('2026-08-07T19:04:00Z');
    const payload = attendancePayload(clock, {
      event,
      studentId: 'pco_123',
      uid: 'uid-2',
      method: 'tap',
      isFirstEver: false,
      checkedInAt: arrived,
    });
    expect(payload.checkedInAt).toBe(arrived);
  });
});

describe('studentDatePatch', () => {
  it('writes both dates, the identity fields and the clock for a first-timer', () => {
    expect(studentDatePatch(clock, student(), event, 'uid-1')).toEqual({
      firstAttendedAt: event.startAt,
      lastAttendedAt: event.startAt,
      firstName: 'Maya',
      lastName: 'Chen',
      grade: 9,
      searchName: 'maya chen',
      updatedAt: SENTINEL,
      updatedBy: 'uid-1',
    });
  });

  it('never moves firstAttendedAt, and only moves lastAttendedAt forward', () => {
    const past = new Date('2026-01-02T19:00:00Z');
    const future = new Date('2026-12-11T19:00:00Z');
    const settled = student({ firstAttendedAt: past, lastAttendedAt: future });
    expect(studentDatePatch(clock, settled, event, 'uid-1')).toBeNull();
  });

  it('advances lastAttendedAt when the event is newer', () => {
    const past = new Date('2026-01-02T19:00:00Z');
    const patch = studentDatePatch(
      clock,
      student({ firstAttendedAt: past, lastAttendedAt: past }),
      event,
      'uid-1',
    );
    expect(patch).toMatchObject({ lastAttendedAt: event.startAt });
    expect(patch).not.toHaveProperty('firstAttendedAt');
  });

  it('omits the grade when nobody actually holds one', () => {
    const patch = studentDatePatch(clock, student({ gradeOnFile: false }), event, 'uid-1');
    expect(patch).not.toHaveProperty('grade');
  });
});

describe('isFirstEver', () => {
  it('is exactly "no first attendance on record"', () => {
    expect(isFirstEver(student())).toBe(true);
    expect(isFirstEver(student({ firstAttendedAt: new Date() }))).toBe(false);
  });
});
