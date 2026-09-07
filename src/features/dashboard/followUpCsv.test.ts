/**
 * The three call lists as files, and the columns that are empty on purpose.
 *
 * The blank trio is the whole reason these exist: Tally stores no assignment,
 * so the spreadsheet is where the leader's own "who is calling, and what
 * happened" lives. A future change that fills them in from Firestore is the
 * schema this app decided not to have, and this file is where that gets caught.
 */
import { describe, expect, it } from 'vitest';
import {
  buildIncompleteProfileCsv,
  buildMiaCsv,
  buildNewVisitorCsv,
  NO_EXPORT_CONTEXT,
} from '@/features/dashboard/followUpCsv';
import { makeStudent } from '../../../tests/factories';
import type { MiaStudent, NewVisitor } from '@/types';

const AMARA = makeStudent({ id: 'pco_1', firstName: 'Amara', lastName: 'Okafor', grade: 9 });
const CHIDI = makeStudent({ id: 'a32_2', firstName: 'Chidi', lastName: 'Eze', grade: null });

function headers(csv: string): string[] {
  return csv.split('\r\n')[0]!.split(',');
}

function cells(csv: string, rowIndex = 0): Record<string, string> {
  const lines = csv.trimEnd().split('\r\n');
  const keys = lines[0]!.split(',');
  const values = lines[rowIndex + 1]!.split(',');
  return Object.fromEntries(keys.map((key, index) => [key, values[index] ?? '']));
}

const MIA: MiaStudent[] = [
  {
    student: AMARA,
    consecutiveMisses: 3,
    lastAttendedAt: new Date(2026, 4, 15, 19, 0),
    lastAttendedEventTitle: 'Friday Fellowship',
    gatheringKey: 'friday-fellowship',
    gatheringTitle: 'Friday Fellowship',
    alsoMissingCount: 1,
  },
  {
    // Somebody who used to come and has since been at nothing: the window holds
    // no sighting to name a gathering from.
    student: CHIDI,
    consecutiveMisses: 5,
    lastAttendedAt: null,
    lastAttendedEventTitle: null,
    gatheringKey: null,
    gatheringTitle: null,
    alsoMissingCount: 0,
  },
];

const VISITORS: NewVisitor[] = [
  {
    student: AMARA,
    firstEventId: 'evt-1',
    firstEventTitle: 'Summer Retreat',
    firstAttendedAt: new Date(2026, 6, 4, 9, 0),
    gatheringKey: null,
    viaOneOff: true,
  },
];

describe('the three columns that stay empty', () => {
  it.each([
    ['mia', buildMiaCsv(MIA, NO_EXPORT_CONTEXT)],
    ['new visitors', buildNewVisitorCsv(VISITORS, NO_EXPORT_CONTEXT)],
    [
      'incomplete profiles',
      buildIncompleteProfileCsv([AMARA], NO_EXPORT_CONTEXT, new Date(2026, 4, 20)),
    ],
  ])('%s carries assigned_to, contacted_on and outcome, all blank', (_name, csv) => {
    expect(headers(csv).slice(-3)).toEqual(['assigned_to', 'contacted_on', 'outcome']);
    const row = cells(csv);
    expect(row.assigned_to).toBe('');
    expect(row.contacted_on).toBe('');
    expect(row.outcome).toBe('');
  });

  it.each([
    ['mia', buildMiaCsv(MIA, NO_EXPORT_CONTEXT)],
    ['new visitors', buildNewVisitorCsv(VISITORS, NO_EXPORT_CONTEXT)],
  ])('%s holds no parent contact details', (_name, csv) => {
    // Even here, where the point is phoning families. The badge answer is on
    // the row; the numbers are not, and never leave the app in bulk.
    expect(headers(csv).join(' ')).not.toMatch(/parent_name|parent_phone|parent_email/);
  });
});

describe('buildMiaCsv', () => {
  const csv = buildMiaCsv(MIA, NO_EXPORT_CONTEXT);

  it('names the gathering a streak belongs to', () => {
    expect(cells(csv, 0).gathering).toBe('Friday Fellowship');
    expect(cells(csv, 0).consecutive_misses).toBe('3');
    expect(cells(csv, 0).also_missing_count).toBe('1');
  });

  it('leaves the gathering blank for a student the window saw nowhere', () => {
    // Not "unknown" and not a guess: they belong to no chain of repeats, which
    // is a real answer rather than missing data.
    expect(cells(csv, 1).gathering).toBe('');
    expect(cells(csv, 1).gathering_key).toBe('');
    expect(cells(csv, 1).last_attended).toBe('');
  });

  it('writes counts as numbers, so a column of them can be summed', () => {
    expect(cells(csv, 0).consecutive_misses).toMatch(/^\d+$/);
  });

  it('leaves the grade blank for somebody who holds none', () => {
    expect(cells(csv, 1).grade).toBe('');
    expect(cells(csv, 1).grade_label).toBe('');
  });
});

describe('buildNewVisitorCsv', () => {
  it('says which gathering we met them at, and whether it was a one-off', () => {
    const row = cells(buildNewVisitorCsv(VISITORS, NO_EXPORT_CONTEXT));
    expect(row.first_event).toBe('Summer Retreat');
    expect(row.via_one_off).toBe('yes');
    expect(row.first_attended).toBe('2026-07-04');
  });
});

describe('buildIncompleteProfileCsv', () => {
  it('ages a row from when it was added, not from the clock inside the module', () => {
    const student = makeStudent({ id: 'pco_1', createdAt: new Date(2026, 4, 1) });
    const row = cells(buildIncompleteProfileCsv([student], NO_EXPORT_CONTEXT, new Date(2026, 4, 20)));
    expect(row.added_on).toBe('2026-05-01');
    expect(row.days_waiting).toBe('19');
  });

  it('never reports a negative wait for a row added in the future', () => {
    const student = makeStudent({ id: 'pco_1', createdAt: new Date(2026, 5, 1) });
    const row = cells(buildIncompleteProfileCsv([student], NO_EXPORT_CONTEXT, new Date(2026, 4, 20)));
    expect(row.days_waiting).toBe('0');
  });
});

describe('contact_on_file', () => {
  it('is blank when nobody has looked, in every one of the three', () => {
    const student = makeStudent({ id: 'pco_1', profileComplete: null });
    const csv = buildIncompleteProfileCsv([student], NO_EXPORT_CONTEXT, new Date());
    expect(cells(csv).contact_on_file).toBe('');
  });

  it('is no once the backend has been asked and holds nobody', () => {
    const student = makeStudent({ id: 'pco_1', profileComplete: false });
    const csv = buildIncompleteProfileCsv([student], NO_EXPORT_CONTEXT, new Date());
    expect(cells(csv).contact_on_file).toBe('no');
  });
});
