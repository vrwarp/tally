/**
 * The roster, as a spreadsheet.
 *
 * The sibling of `features/dashboard/contactList.ts`, which it does not replace.
 * That module argues plain text because its destination is a group chat; this
 * one exists for the jobs whose destination is a document — name tags for the
 * retreat, the small-group assignment sheet, the list the caterer needs, the
 * figure the elders want in June.
 *
 * ## What is deliberately not here
 *
 * No parent name, phone or email. Tally holds none of them — they live in the
 * people backend and are read one student at a time, by a screen that shows
 * them — and building a file of four hundred would mean four hundred upstream
 * reads to put a screenful of parents' phone numbers on somebody's laptop. That
 * is the permanent second copy `docs/minors-data.md` exists to prevent, and
 * `CopyContactsButton` already refuses it for a clipboard, which is the weaker
 * case.
 *
 * No allergy note either — only the flag the roster row already shows. And no
 * birthday: Tally holds `MM-DD` on purpose, Excel would coerce it into a date in
 * the current year, and a birthday column invites an age column beside it, which
 * is the thing the roster refuses to hold at all.
 *
 * ## The three-state contact column
 *
 * `parent_contact_on_file` is blank when *nobody has looked*, which is the
 * honest answer for most students — a roster read does not fetch households, so
 * it cannot tell an unreachable family from one it never asked about. Rendering
 * that as "no" in a file nobody can hover over is worse than doing it in a
 * badge. `isUnreachable` is what the chip counts on the screen use, so the
 * column and the count can never disagree.
 */
import { isUnreachable } from '@/features/dashboard/insights';
import { sourceReadAt, studentSource } from '@/features/exports/studentSource';
import { isoDate, toCsv, type CsvColumn } from '@/lib/csv';
import { gradeLabel } from '@/lib/utils';
import type { RosterBackendStatus } from '@/services/functions';
import type { Student } from '@/types';

export interface RosterCsvContext {
  /** Planning Center's answer about who can be reached, as the screen has it. */
  reachable: ReadonlyMap<string, boolean>;
  /** Per-backend outcomes of the last roster read, for `source_read_at`. */
  backends: readonly RosterBackendStatus[];
}

function columns(context: RosterCsvContext): CsvColumn<Student>[] {
  return [
    // Never `id`: a file whose first header cell is `ID` is parsed as SYLK by
    // Excel and refused outright.
    { header: 'student_id', value: (student) => student.id },
    // The composite including any nickname — `Benson “蔡秉洲”` — because that is
    // what every screen shows and what a search would have matched.
    { header: 'first_name', value: (student) => student.firstName },
    { header: 'last_name', value: (student) => student.lastName },
    // Numeric, so a column of grades sorts and averages.
    { header: 'grade', value: (student) => student.grade },
    // …and the label beside it, because `gradeName` answers `K` for 0 and
    // `Pre-K` for -1, and a spreadsheet cannot sort those back into place.
    { header: 'grade_label', value: (student) => gradeLabel(student) },
    { header: 'status', value: (student) => student.status },
    { header: 'is_visitor', value: (student) => student.isVisitor },
    { header: 'first_attended', value: (student) => isoDate(student.firstAttendedAt) },
    { header: 'last_attended', value: (student) => isoDate(student.lastAttendedAt) },
    {
      header: 'parent_contact_on_file',
      value: (student) => {
        // Three states. Blank is "nobody looked", not "nobody can be reached".
        if (student.status !== 'active') return '';
        const unreachable = isUnreachable(student, context.reachable);
        if (unreachable) return 'no';
        const known = student.profileComplete ?? context.reachable.get(student.id);
        return known === undefined ? '' : 'yes';
      },
    },
    // That there is an allergy, never what it is.
    { header: 'has_allergies', value: (student) => student.hasAllergies },
    { header: 'notes', value: (student) => student.notes },
    // A merged loser keeps its attendance, so it can legitimately appear beside
    // the row it was folded into. Naming the keeper makes the pair explicable
    // rather than baffling.
    { header: 'merged_into_student_id', value: (student) => student.mergedIntoStudentId ?? '' },
    { header: 'source_system', value: (student) => studentSource(student).system },
    { header: 'source_person_id', value: (student) => studentSource(student).personId },
    { header: 'upstream_state', value: (student) => studentSource(student).state },
    {
      header: 'source_read_at',
      value: (student) => sourceReadAt(studentSource(student), context.backends),
    },
  ];
}

/**
 * @param students The rows *on screen*, under whatever filters are applied —
 *   never the whole roster. Somebody who narrowed the page to 8th graders
 *   expects eight rows, and the alternative bug is invisible in the file.
 */
export function buildRosterCsv(
  students: readonly Student[],
  context: RosterCsvContext,
): string {
  return toCsv(columns(context), students);
}

/** Exported for the test that guards the SYLK rule. */
export function rosterCsvHeaders(context: RosterCsvContext): string[] {
  return columns(context).map((column) => column.header);
}
