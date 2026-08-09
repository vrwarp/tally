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
    const headers = registerCsvHeaders(context(makeEvent({ requiresCheckOut: false })));
    // A column of blanks reads as missing data; "this gathering does not do
    // that" is not something an empty cell can say.
    expect(headers).not.toContain('checked_out_at');
  });

  it('carries the check-out columns on a room children are collected from', () => {
    const headers = registerCsvHeaders(context(makeEvent({ requiresCheckOut: true })));
    expect(headers).toContain('checked_out_at');
    expect(headers).toContain('checked_out_by');
    expect(headers).toContain('checked_out_by_uid');
  });

  it('carries the RSVP columns only on a one-off', () => {
    expect(registerCsvHeaders(context(makeEvent({ mode: 'oneoff' })))).toContain('rsvp');
    expect(registerCsvHeaders(context(makeEvent({ mode: 'recurring' })))).not.toContain('rsvp');
  });

  it('never names its first column ID', () => {
    expect(registerCsvHeaders(context())[0]).toBe('student_id');
  });
});

describe('buildRegisterCsv — who recorded it', () => {
  function rowFor(record: ReturnType<typeof makeAttendance>) {
    const event = makeEvent();
    const rows = registerRows(event, [record], [], byId(AMARA));
    return cells(buildRegisterCsv(rows, context(event)), 0);
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

describe('buildRegisterCsv — a student the roster no longer names', () => {
  it('keeps the id and the times, and leaves the name blank', () => {
    const event = makeEvent();
    const rows = registerRows(event, [makeAttendance({ studentId: 'pco_99' })], [], byId());
    const row = cells(buildRegisterCsv(rows, context(event)), 0);

    expect(row.student_id).toBe('pco_99');
    expect(row.first_name).toBe('');
    expect(row.checked_in).toBe('yes');
    // The id prefix is still a claim about where they came from, and it
    // survives the roster forgetting them.
    expect(row.source_system).toBe('');
  });
});
