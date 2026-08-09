/**
 * One night's register, as a spreadsheet.
 *
 * For the person doing follow-up who was not on the bus, the parent asking
 * whether their child was collected on the 12th, and whoever is reconciling the
 * register against a paper sign-up sheet.
 *
 * ## Two columns for who checked somebody in, deliberately
 *
 * `checkedInBy` is a uid — except when it is not. A row imported from Planning
 * Center Check-Ins carries the literal `planning-center`, and a row written at
 * the lobby kiosk carries the uid of whoever *paired the device*, not whoever
 * touched the screen. So the file carries both the resolved name and the raw
 * value, beside `method`: a reader can then see that a `kiosk` row's name is a
 * paired session rather than an eyewitness, which is exactly the distinction
 * somebody reconstructing a morning needs. A bare uid never appears in the name
 * column on its own.
 *
 * ## Conditional columns rather than a stable header
 *
 * Check-out columns appear only on a gathering that tracks check-out, and RSVP
 * columns only on a one-off. A column of blanks reads as missing data — the
 * event page itself hides the same stat rather than showing an empty one — and
 * "this gathering does not do that" is not something a blank cell can say.
 *
 * ## The no-shows
 *
 * On an event whose roster is closed to the RSVP list, the file carries the
 * students who said yes and did not come, with empty check-in times. A bus
 * manifest that lists only the people who boarded is not a manifest.
 */
import { sourceReadAt, studentSource } from '@/features/exports/studentSource';
import { isoDate, isoDateTime, toCsv, type CsvColumn } from '@/lib/csv';
import { gradeLabel } from '@/lib/utils';
import type { RosterBackendStatus } from '@/services/functions';
import type { AttendanceRecord, Rsvp, Student, TallyEvent } from '@/types';

/** One line of the file: a student, and whatever is known about their night. */
export interface RegisterRow {
  studentId: string;
  student: Student | null;
  attendance: AttendanceRecord | null;
  rsvp: Rsvp | null;
}

export interface RegisterCsvContext {
  event: TallyEvent;
  /**
   * uid → the name to print, resolved by the caller.
   *
   * Passed in rather than read here, the way `contactList.ts` takes its
   * contacts: the team is a Firestore subscription the export has no business
   * opening, and keeping it out leaves this module pure and testable without a
   * Firebase config.
   */
  namesByUid: ReadonlyMap<string, string>;
  backends: readonly RosterBackendStatus[];
}

/**
 * Everybody the file should name, in a stable order.
 *
 * Attendance first, then the RSVP-only rows. Sorted by name so two exports of
 * the same night are diffable, which is the whole point of handing one to
 * somebody else.
 */
export function registerRows(
  event: TallyEvent,
  attendance: readonly AttendanceRecord[],
  rsvps: readonly Rsvp[],
  studentsById: ReadonlyMap<string, Student>,
): RegisterRow[] {
  const rsvpById = new Map(rsvps.map((rsvp) => [rsvp.studentId, rsvp]));
  const rows = new Map<string, RegisterRow>();

  for (const record of attendance) {
    rows.set(record.studentId, {
      studentId: record.studentId,
      student: studentsById.get(record.studentId) ?? null,
      attendance: record,
      rsvp: rsvpById.get(record.studentId) ?? null,
    });
  }

  if (event.mode === 'oneoff') {
    for (const rsvp of rsvps) {
      if (rows.has(rsvp.studentId)) continue;
      rows.set(rsvp.studentId, {
        studentId: rsvp.studentId,
        student: studentsById.get(rsvp.studentId) ?? null,
        attendance: null,
        rsvp,
      });
    }
  }

  return [...rows.values()].sort((a, b) => {
    const left = a.student ? `${a.student.lastName} ${a.student.firstName}` : a.studentId;
    const right = b.student ? `${b.student.lastName} ${b.student.firstName}` : b.studentId;
    return left.localeCompare(right);
  });
}

function columns(context: RegisterCsvContext): CsvColumn<RegisterRow>[] {
  const { event, namesByUid, backends } = context;

  const base: CsvColumn<RegisterRow>[] = [
    { header: 'student_id', value: (row) => row.studentId },
    // Blank rather than the "Former student" the page renders: that phrase is
    // an explanation for a reader looking at one row, not a name.
    { header: 'first_name', value: (row) => row.student?.firstName ?? '' },
    { header: 'last_name', value: (row) => row.student?.lastName ?? '' },
    { header: 'grade', value: (row) => row.student?.grade ?? null },
    { header: 'grade_label', value: (row) => (row.student ? gradeLabel(row.student) : '') },
    { header: 'event_id', value: () => event.id },
    { header: 'event_title', value: () => event.title },
    { header: 'event_date', value: () => isoDate(event.startAt) },
    { header: 'event_start', value: () => isoDateTime(event.startAt) },
    { header: 'checked_in', value: (row) => row.attendance !== null },
    { header: 'checked_in_at', value: (row) => isoDateTime(row.attendance?.checkedInAt) },
    {
      header: 'checked_in_by',
      value: (row) => {
        const by = row.attendance?.checkedInBy;
        if (!by) return '';
        // The one value that is not a uid, and saying so beats resolving it to
        // nothing.
        if (by === 'planning-center') return 'planning-center';
        // Blank rather than the raw uid: a uid in a name column reads as a
        // person's name to whoever opens this next, and the value is already in
        // its own column beside it.
        return namesByUid.get(by) ?? '';
      },
    },
    { header: 'checked_in_by_uid', value: (row) => row.attendance?.checkedInBy ?? '' },
    { header: 'method', value: (row) => row.attendance?.method ?? '' },
    { header: 'first_ever', value: (row) => (row.attendance ? row.attendance.isFirstEver : '') },
  ];

  if (event.requiresCheckOut) {
    base.push(
      { header: 'checked_out_at', value: (row) => isoDateTime(row.attendance?.checkedOutAt) },
      {
        header: 'checked_out_by',
        value: (row) => {
          const by = row.attendance?.checkedOutBy;
          return by ? (namesByUid.get(by) ?? '') : '';
        },
      },
      { header: 'checked_out_by_uid', value: (row) => row.attendance?.checkedOutBy ?? '' },
    );
  }

  if (event.mode === 'oneoff') {
    base.push(
      { header: 'rsvp', value: (row) => row.rsvp?.status ?? '' },
      { header: 'rsvp_notes', value: (row) => row.rsvp?.notes ?? '' },
    );
  }

  base.push(
    {
      header: 'source_system',
      value: (row) => (row.student ? studentSource(row.student).system : ''),
    },
    {
      header: 'source_person_id',
      value: (row) => (row.student ? studentSource(row.student).personId : ''),
    },
    {
      header: 'source_read_at',
      value: (row) => (row.student ? sourceReadAt(studentSource(row.student), backends) : ''),
    },
  );

  return base;
}

export function buildRegisterCsv(
  rows: readonly RegisterRow[],
  context: RegisterCsvContext,
): string {
  return toCsv(columns(context), rows);
}

/** Exported for the tests that pin the conditional header shapes. */
export function registerCsvHeaders(context: RegisterCsvContext): string[] {
  return columns(context).map((column) => column.header);
}
