/**
 * One night's register as a file, and the three things it must not blur.
 *
 * Who was here, who *said* they would be and was not, and who actually recorded
 * each of those facts. The third is the one a spreadsheet gets wrong most
 * easily, because `checkedInBy` is a uid on most rows and something else
 * entirely on two kinds of row.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRegisterCsv,
  registerCsvHeaders,
  registerRows,
} from '@/features/events/registerCsv';
import { makeAttendance, makeEvent, makeRsvp, makeStudent } from '../../../tests/factories';
import type { Student } from '@/types';
import { testGrades } from '@/test/translator';

const grades = testGrades();

const NAMES = new Map([['u1', 'Miriam']]);

const AMARA = makeStudent({ id: 'pco_1', firstName: 'Amara', lastName: 'Okafor', grade: 9 });
const BEN = makeStudent({ id: 'a32_2', firstName: 'Ben', lastName: 'Cole', grade: 8 });

function byId(...students: Student[]): Map<string, Student> {
  return new Map(students.map((student) => [student.id, student]));
}

function context(event = makeEvent()) {
  return { event, namesByUid: NAMES, backends: [] };
}

function cells(csv: string, rowIndex: number): Record<string, string> {
  const lines = csv.trimEnd().split('\r\n');
  const headers = lines[0]!.split(',');
  const values = lines[rowIndex + 1]!.split(',');
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
}

describe('registerRows', () => {
  it('lists everybody checked in, by name', () => {
    const event = makeEvent();
    const rows = registerRows(
      event,
      [makeAttendance({ studentId: 'a32_2' }), makeAttendance({ studentId: 'pco_1' })],
      [],
      byId(AMARA, BEN),
    );
    expect(rows.map((row) => row.studentId)).toEqual(['a32_2', 'pco_1']); // Cole, then Okafor
  });

  it('adds the no-shows on a one-off, so a bus manifest is a manifest', () => {
    const event = makeEvent({ mode: 'oneoff', requiresRsvp: true });
    const rows = registerRows(
      event,
      [makeAttendance({ studentId: 'pco_1' })],
      [makeRsvp({ studentId: 'a32_2', status: 'yes' })],
      byId(AMARA, BEN),
    );

    expect(rows).toHaveLength(2);
    const noShow = rows.find((row) => row.studentId === 'a32_2')!;
    expect(noShow.attendance).toBeNull();
    expect(noShow.rsvp?.status).toBe('yes');
  });

  it('does not invent RSVP rows on a recurring gathering', () => {
    const rows = registerRows(
      makeEvent({ mode: 'recurring' }),
      [makeAttendance({ studentId: 'pco_1' })],
      [makeRsvp({ studentId: 'a32_2', status: 'yes' })],
      byId(AMARA, BEN),
    );
    expect(rows).toHaveLength(1);
  });
});

describe('buildRegisterCsv — conditional columns', () => {
  it('omits the check-out columns on a gathering that does not track it', () => {
    const headers = registerCsvHeaders(grades, context(makeEvent({ requiresCheckOut: false })));
    // A column of blanks reads as missing data; "this gathering does not do
    // that" is not something an empty cell can say.
    expect(headers).not.toContain('checked_out_at');
  });

  it('carries the check-out columns on a room children are checked out from', () => {
    const headers = registerCsvHeaders(grades, context(makeEvent({ requiresCheckOut: true })));
    expect(headers).toContain('checked_out_at');
    expect(headers).toContain('checked_out_by');
    expect(headers).toContain('checked_out_by_uid');
    expect(headers).toContain('checked_out_recorded_at');
    expect(headers).toContain('later_checked_out_at');
    expect(headers).toContain('later_checked_out_by');
  });

  it('carries when a record reached Tally, and the entry an earlier tap replaced, on every gathering', () => {
    for (const requiresCheckOut of [true, false]) {
      const headers = registerCsvHeaders(grades, context(makeEvent({ requiresCheckOut })));
      expect(headers).toContain('recorded_at');
      expect(headers).toContain('later_checked_in_at');
      expect(headers).toContain('later_checked_in_by');
    }
    expect(registerCsvHeaders(grades, context(makeEvent({ requiresCheckOut: false })))).not.toContain(
      'later_checked_out_at',
    );
  });

  it('carries the RSVP columns only on a one-off', () => {
    expect(registerCsvHeaders(grades, context(makeEvent({ mode: 'oneoff' })))).toContain('rsvp');
    expect(registerCsvHeaders(grades, context(makeEvent({ mode: 'recurring' })))).not.toContain('rsvp');
  });

  it('never names its first column ID', () => {
    expect(registerCsvHeaders(grades, context())[0]).toBe('student_id');
  });
});

describe('buildRegisterCsv — who recorded it', () => {
  function rowFor(record: ReturnType<typeof makeAttendance>) {
    const event = makeEvent();
    const rows = registerRows(event, [record], [], byId(AMARA));
    return cells(buildRegisterCsv(grades, rows, context(event)), 0);
  }

  it('resolves a uid to a name and keeps the raw value beside it', () => {
    const row = rowFor(makeAttendance({ studentId: 'pco_1', checkedInBy: 'u1', method: 'tap' }));
    expect(row.checked_in_by).toBe('Miriam');
    expect(row.checked_in_by_uid).toBe('u1');
  });

  it('says planning-center for an imported row rather than resolving it to nothing', () => {
    const row = rowFor(
      makeAttendance({ studentId: 'pco_1', checkedInBy: 'planning-center', method: 'import' }),
    );
    expect(row.checked_in_by).toBe('planning-center');
    expect(row.method).toBe('import');
  });

  it('leaves the name blank rather than printing a bare uid', () => {
    // A leader who has since been removed from the team. The uid is still in
    // its own column, so nothing is lost — but a raw uid in a name column
    // reads as a person's name to whoever opens this next.
    const row = rowFor(makeAttendance({ studentId: 'pco_1', checkedInBy: 'ghost' }));
    expect(row.checked_in_by).toBe('');
    expect(row.checked_in_by_uid).toBe('ghost');
  });

  it('keeps the method beside it, so a kiosk row can be read for what it is', () => {
    // `method: 'kiosk'` carries the uid of whoever paired the device, not
    // whoever touched the screen — the two columns together are what let a
    // reader tell the difference.
    const row = rowFor(makeAttendance({ studentId: 'pco_1', checkedInBy: 'u1', method: 'kiosk' }));
    expect(row.method).toBe('kiosk');
    expect(row.checked_in_by).toBe('Miriam');
  });
});

describe('buildRegisterCsv — a lobby kiosk', () => {
  function rowFor(record: ReturnType<typeof makeAttendance>) {
    const event = makeEvent({ requiresCheckOut: true });
    const rows = registerRows(event, [record], [], byId(AMARA));
    return cells(buildRegisterCsv(grades, rows, context(event)), 0);
  }

  it('says "Lobby kiosk" for a row the kiosk wrote, with the device beside it', () => {
    // A kiosk signs in as `kiosk_<deviceId>` (see `src/lib/kioskDevice.ts`):
    // not on the team, so no name to resolve — and the truer custody record
    // than the volunteer who happened to pair it.
    const row = rowFor(
      makeAttendance({
        studentId: 'pco_1',
        checkedInBy: 'kiosk_kiosk-3f9a1c2e7b4d5e6f7a8b9c0d',
        checkedOutBy: 'kiosk_kiosk-3f9a1c2e7b4d5e6f7a8b9c0d',
        method: 'kiosk',
      }),
    );
    expect(row.checked_in_by).toBe('Lobby kiosk');
    expect(row.checked_in_by_uid).toBe('kiosk_kiosk-3f9a1c2e7b4d5e6f7a8b9c0d');
    expect(row.checked_out_by).toBe('Lobby kiosk');
    expect(row.method).toBe('kiosk');
  });

  it('says when a kiosk record reached Tally, and keeps the entry an earlier tap replaced', () => {
    // 9:41 at the door, reaching Tally on Monday — and the counselor's 10:05
    // entry, which the earlier tap moved aside rather than erased.
    const row = rowFor(
      makeAttendance({
        studentId: 'pco_1',
        checkedInAt: new Date('2026-09-27T16:41:00Z'),
        recordedAt: new Date('2026-09-28T16:02:00Z'),
        laterCheckIn: { at: new Date('2026-09-27T17:05:00Z'), by: 'u1' },
        checkedOutAt: new Date('2026-09-27T17:52:00Z'),
        checkedOutRecordedAt: new Date('2026-09-28T16:02:00Z'),
        laterCheckOut: { at: new Date('2026-09-27T18:15:00Z'), by: 'kiosk_kiosk-8b13aa2c90ff' },
        method: 'kiosk',
      }),
    );
    expect(row.recorded_at).toMatch(/^2026-09-28T/);
    expect(row.later_checked_in_at).toMatch(/^2026-09-27T/);
    expect(row.later_checked_in_by).toBe('Miriam');
    expect(row.checked_out_recorded_at).toMatch(/^2026-09-28T/);
    expect(row.later_checked_out_by).toBe('Lobby kiosk');
  });

  it('leaves those blank for a record that never came from a kiosk', () => {
    const row = rowFor(makeAttendance({ studentId: 'pco_1', checkedInBy: 'u1', method: 'tap' }));
    expect(row.recorded_at).toBe('');
    expect(row.later_checked_in_at).toBe('');
    expect(row.later_checked_in_by).toBe('');
    expect(row.later_checked_out_by).toBe('');
  });

  it('names nobody for a displaced entry whose recorder is unknown', () => {
    const row = rowFor(
      makeAttendance({ studentId: 'pco_1', laterCheckIn: { at: null, by: 'ghost' }, method: 'kiosk' }),
    );
    expect(row.later_checked_in_at).toBe('');
    expect(row.later_checked_in_by).toBe('');
  });

  it('leaves a time blank that came from a tablet whose clock could not be believed', () => {
    // The stored moment is the bound it was pulled to — plausible, and not what
    // happened. The row still says they came.
    const row = rowFor(
      makeAttendance({
        studentId: 'pco_1',
        checkedInAt: new Date('2026-09-27T09:00:00Z'),
        checkedOutAt: new Date('2026-09-27T10:30:00Z'),
        timeUncertain: true,
        checkedOutTimeUncertain: true,
        method: 'kiosk',
      }),
    );
    expect(row.checked_in).toBe('yes');
    expect(row.checked_in_at).toBe('');
    expect(row.checked_out_at).toBe('');
  });
});

describe('buildRegisterCsv — a student the roster no longer names', () => {
  it('keeps the id and the times, and leaves the name blank', () => {
    const event = makeEvent();
    const rows = registerRows(event, [makeAttendance({ studentId: 'pco_99' })], [], byId());
    const row = cells(buildRegisterCsv(grades, rows, context(event)), 0);

    expect(row.student_id).toBe('pco_99');
    expect(row.first_name).toBe('');
    expect(row.checked_in).toBe('yes');
    // The id prefix is still a claim about where they came from, and it
    // survives the roster forgetting them.
    expect(row.source_system).toBe('');
  });
});
