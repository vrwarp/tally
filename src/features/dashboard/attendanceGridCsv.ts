/**
 * Students down, nights across — the grid a Sunday School teacher has kept on
 * paper since before the app existed.
 *
 * No Tally screen shows this and none should: it is a wall of ticks, useless on
 * a phone, and this app's posture is "who do I phone" rather than "here is a
 * matrix". But it is what a spreadsheet is uniquely good at, and Tally is the
 * only thing holding the data.
 *
 * ## The one rule everything else follows from: absent is not zero
 *
 * A `0` in this file is a claim that a named child did not turn up to a
 * gathering that happened. There are three ways to write one by accident, and
 * all three end in somebody phoning a family about a night that was never held
 * or was never theirs:
 *
 *   - **A register the reader was refused.** `useEventSnapshots` keeps these in
 *     `denied` and *out* of `snapshots` precisely so nothing downstream reads
 *     the absence as an empty room. A column of zeros here would assert every
 *     student missed a night nobody was allowed to look at. So a denied night
 *     gets **no column at all**.
 *   - **A night nobody came to.** `sessionOutcome` already calls that
 *     `presumed-cancelled` and every other derivation drops it. So does this:
 *     no column.
 *   - **A night before the student was on the roster.** Their cell is **blank**,
 *     not `0`, and the night does not count against them in `nights`. Without
 *     that denominator a student added in May reads as 20% attendance over a
 *     year, which is the kind of number somebody acts on.
 *
 * Both exclusions are counted and handed back so the screen can say what it left
 * out, the way Insights already names the gatherings it could not see. A file
 * that is quietly shorter than the calendar reads as good news.
 *
 * ## Merged students
 *
 * A merge does not re-key attendance: the losing row keeps its records and the
 * profile unions the histories at read time. Doing anything less here would show
 * one child as two partial rows, neither of which sums to the truth — so the
 * keeper's row absorbs the ids folded into it, exactly as the profile does.
 */
import { sourceReadAt, studentSource } from '@/features/exports/studentSource';
import { isoDate, toCsv, type CsvColumn } from '@/lib/csv';
import { sessionOutcome } from '@/lib/sessionHistory';
import { gradeLabel } from '@/lib/utils';
import type { RosterBackendStatus } from '@/services/functions';
import type { EventAttendanceSnapshot, Student } from '@/types';

export interface AttendanceGridRow {
  student: Student;
  /** `true` present, `false` absent, `undefined` not yet on the roster. */
  cells: (boolean | undefined)[];
  attended: number;
  /** Nights this student was eligible for — the honest denominator. */
  nights: number;
}

export interface AttendanceGrid {
  /** Oldest first, so the columns read left to right like a calendar. */
  nights: EventAttendanceSnapshot[];
  rows: AttendanceGridRow[];
  /** Scheduled nights nobody was checked in at. Excluded, and counted. */
  presumedCancelled: number;
  /** Nights whose register this reader may not see. Excluded, and counted. */
  denied: number;
}

export interface AttendanceGridInput {
  snapshots: readonly EventAttendanceSnapshot[];
  students: readonly Student[];
  /** Event ids the read was refused, from `useEventSnapshots`. */
  denied?: ReadonlySet<string>;
}

/**
 * Every id whose attendance belongs to this student — their own, plus anything
 * merged into them.
 */
function idsOf(student: Student): string[] {
  return [student.id, ...(student.mergedFromStudentIds ?? [])];
}

export function buildAttendanceGrid({
  snapshots,
  students,
  denied,
}: AttendanceGridInput): AttendanceGrid {
  const usable = snapshots.filter((snapshot) => sessionOutcome(snapshot) === 'held');
  const nights = [...usable].sort(
    (a, b) => a.event.startAt.getTime() - b.event.startAt.getTime(),
  );

  const rows = students.map((student) => {
    const ids = idsOf(student);
    const cells: (boolean | undefined)[] = [];
    let attended = 0;
    let eligible = 0;

    for (const night of nights) {
      // A row cannot have missed a gathering held before they existed here.
      // `createdAt` rather than `firstAttendedAt`: somebody added in March who
      // has never come has missed every Friday since, and that is the point of
      // the list.
      if (night.event.startAt < student.createdAt) {
        cells.push(undefined);
        continue;
      }
      eligible += 1;
      const present = ids.some((id) => night.presentStudentIds.has(id));
      if (present) attended += 1;
      cells.push(present);
    }

    return { student, cells, attended, nights: eligible };
  });

  return {
    nights,
    rows,
    presumedCancelled: snapshots.filter(
      (snapshot) => sessionOutcome(snapshot) === 'presumed-cancelled',
    ).length,
    denied: denied?.size ?? 0,
  };
}

export interface AttendanceGridCsvContext {
  backends: readonly RosterBackendStatus[];
}

export function buildAttendanceGridCsv(
  grid: AttendanceGrid,
  context: AttendanceGridCsvContext,
): string {
  const columns: CsvColumn<AttendanceGridRow>[] = [
    { header: 'student_id', value: (row) => row.student.id },
    { header: 'first_name', value: (row) => row.student.firstName },
    { header: 'last_name', value: (row) => row.student.lastName },
    { header: 'grade', value: (row) => row.student.grade },
    { header: 'grade_label', value: (row) => gradeLabel(row.student) },
    { header: 'source_system', value: (row) => studentSource(row.student).system },
    {
      header: 'source_read_at',
      value: (row) => sourceReadAt(studentSource(row.student), context.backends),
    },
  ];

  grid.nights.forEach((night, index) => {
    columns.push({
      // A date, and unique within a chain by construction: an occurrence id is
      // the chain plus a calendar day. One chain at a time is what makes that
      // hold.
      header: isoDate(night.event.startAt),
      // Numbers, so a column sums and a row averages. `undefined` stays an
      // empty cell — see the module docstring.
      value: (row) => {
        const cell = row.cells[index];
        return cell === undefined ? '' : cell ? 1 : 0;
      },
    });
  });

  columns.push(
    { header: 'attended', value: (row) => row.attended },
    { header: 'nights', value: (row) => row.nights },
    {
      header: 'rate',
      value: (row) => (row.nights === 0 ? '' : Math.round((row.attended / row.nights) * 100)),
    },
  );

  // No totals row: it breaks one-row-per-entity, confuses a pivot table, and
  // `=SUM()` is one keystroke.
  return toCsv(columns, grid.rows);
}
