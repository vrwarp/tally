/**
 * What the roster file says, and the four ways it could quietly lie.
 *
 * A spreadsheet is read by somebody who was not sitting at the screen it came
 * from, so every ambiguity the badges resolve by being hoverable has to be
 * resolved by the column itself.
 */
import { describe, expect, it } from 'vitest';
import { buildRosterCsv, rosterCsvHeaders } from '@/features/students/rosterCsv';
import type { RosterBackendStatus } from '@/services/functions';
import { makeStudent } from '../../../tests/factories';
import type { Student } from '@/types';

const NO_CONTEXT = { reachable: new Map<string, boolean>(), backends: [] as RosterBackendStatus[] };

/** The cells of one data row, split naively — no test value contains a comma. */
function row(csv: string, index: number): string[] {
  return csv.trimEnd().split('\r\n')[index + 1]!.split(',');
}

function cell(csv: string, rowIndex: number, header: string): string {
  const headers = rosterCsvHeaders(NO_CONTEXT);
  return row(csv, rowIndex)[headers.indexOf(header)]!;
}

describe('buildRosterCsv — shape', () => {
  it('never names its first column ID, which Excel would read as SYLK', () => {
    expect(rosterCsvHeaders(NO_CONTEXT)[0]).toBe('student_id');
  });

  it('writes a header and one row per student', () => {
    const csv = buildRosterCsv([makeStudent({ id: 'pco_1' }), makeStudent({ id: 'pco_2' })], NO_CONTEXT);
    expect(csv.trimEnd().split('\r\n')).toHaveLength(3);
  });

  it('holds no parent contact details, no allergy note and no birthday', () => {
    const headers = rosterCsvHeaders(NO_CONTEXT).join(' ');
    expect(headers).not.toMatch(/parent_name|parent_phone|parent_email|allergy_note|birthday/);
  });
});

describe('buildRosterCsv — grade', () => {
  it('carries the number and the label separately', () => {
    const csv = buildRosterCsv([makeStudent({ id: 'pco_1', grade: 9 })], NO_CONTEXT);
    expect(cell(csv, 0, 'grade')).toBe('9');
    expect(cell(csv, 0, 'grade_label')).toBe('9th');
  });

  it('renders kindergarten as 0 and K, never as a blank or "0th"', () => {
    const csv = buildRosterCsv([makeStudent({ id: 'pco_1', grade: 0 })], NO_CONTEXT);
    expect(cell(csv, 0, 'grade')).toBe('0');
    expect(cell(csv, 0, 'grade_label')).toBe('K');
  });

  it('leaves both blank for somebody who holds no grade', () => {
    // No grade is an answer, not a gap to be filled in with a zero — which
    // would claim a nursery child is in kindergarten.
    const csv = buildRosterCsv([makeStudent({ id: 'pco_1', grade: null })], NO_CONTEXT);
    expect(cell(csv, 0, 'grade')).toBe('');
    expect(cell(csv, 0, 'grade_label')).toBe('');
  });
});

describe('buildRosterCsv — the three-state contact column', () => {
  function contact(student: Student, reachable = new Map<string, boolean>()): string {
    return cell(buildRosterCsv([student], { ...NO_CONTEXT, reachable }), 0, 'parent_contact_on_file');
  }

  it('is blank when nobody has looked', () => {
    // The honest answer for most of a roster: a read does not fetch households,
    // so it cannot tell an unreachable family from one it never asked about.
    expect(contact(makeStudent({ id: 'pco_1', profileComplete: null }))).toBe('');
  });

  it('is no when the backend has been asked and holds nobody', () => {
    expect(contact(makeStudent({ id: 'pco_1', profileComplete: false }))).toBe('no');
  });

  it('is yes when somebody can be reached', () => {
    expect(contact(makeStudent({ id: 'pco_1', profileComplete: true }))).toBe('yes');
  });

  it('reads the session-held answer for a student the roster did not hydrate', () => {
    const student = makeStudent({ id: 'pco_7', profileComplete: null });
    expect(contact(student, new Map([['pco_7', false]]))).toBe('no');
  });
});

describe('buildRosterCsv — multi-backend', () => {
  const backends: RosterBackendStatus[] = [
    {
      backendId: 'pco',
      displayName: 'Planning Center',
      ok: true,
      error: null,
      people: 2,
      unresolved: 0,
      missing: 0,
      cached: false,
      fetchedAt: '2026-08-09T12:00:00.000Z',
    },
    {
      backendId: 'a32',
      displayName: 'Attendees',
      ok: false,
      error: 'timed out',
      people: 1,
      unresolved: 0,
      missing: 0,
      cached: true,
      fetchedAt: '2026-08-06T09:30:00.000Z',
    },
  ];

  it('names each row’s own backend and dates it against that backend’s read', () => {
    const csv = buildRosterCsv(
      [makeStudent({ id: 'pco_1' }), makeStudent({ id: 'a32_abc' })],
      { reachable: new Map(), backends },
    );
    expect(cell(csv, 0, 'source_system')).toBe('pco');
    expect(cell(csv, 0, 'source_person_id')).toBe('1');
    expect(cell(csv, 1, 'source_system')).toBe('a32');
    expect(cell(csv, 1, 'source_person_id')).toBe('abc');

    // The stale backend's row says so, in a file that otherwise looks whole.
    expect(cell(csv, 0, 'source_read_at')).toMatch(/^2026-08-09/);
    expect(cell(csv, 1, 'source_read_at')).toMatch(/^2026-08-0[56]/);
  });

  it('leaves the system blank for a visitor no backend holds', () => {
    const csv = buildRosterCsv([makeStudent({ id: 'tallyId', upstreamPushPending: true })], {
      reachable: new Map(),
      backends,
    });
    expect(cell(csv, 0, 'source_system')).toBe('');
    expect(cell(csv, 0, 'upstream_state')).toBe('queued');
    expect(cell(csv, 0, 'source_read_at')).toBe('');
  });
});

describe('buildRosterCsv — awkward values', () => {
  it('neutralises a note that would execute as a formula on open', () => {
    const student = makeStudent({ id: 'pco_1', notes: '=HYPERLINK("http://x","click")' });
    const csv = buildRosterCsv([student], NO_CONTEXT);
    expect(csv).toContain('"\'=HYPERLINK');
  });

  it('carries a nickname composite through unharmed', () => {
    const student = makeStudent({ id: 'pco_1', firstName: 'Benson “蔡秉洲”', lastName: 'Tsai' });
    expect(buildRosterCsv([student], NO_CONTEXT)).toContain('Benson “蔡秉洲”,Tsai');
  });

  it('names the keeper on a merged row rather than dropping it silently', () => {
    const student = { ...makeStudent({ id: 'pco_1' }), mergedIntoStudentId: 'pco_9' };
    expect(cell(buildRosterCsv([student], NO_CONTEXT), 0, 'merged_into_student_id')).toBe('pco_9');
  });
});
