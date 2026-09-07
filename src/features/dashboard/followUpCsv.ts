/**
 * The three call lists, as spreadsheets people write in.
 *
 * The sibling of `contactList.ts`, and not a replacement for it. That module
 * builds plain text because its destination is the team group chat; this one
 * exists for what happens immediately afterwards.
 *
 * ## The three empty columns are the feature
 *
 * `assigned_to`, `contacted_on` and `outcome` arrive blank, on purpose, and must
 * stay that way. `FollowUpActions.tsx` states the product decision they come
 * from:
 *
 *   > Tally stores no assignment: an ownership schema is one more thing that
 *   > goes stale.
 *
 * That decision is right, and it leaves a real job undone — twenty-two students
 * and four leaders is a thing somebody has to divide up and then track. What
 * they actually do is build a spreadsheet. So the file arrives with the columns
 * already in it, and the leader's own copy holds what Tally refuses to.
 *
 * Nobody should later "improve" this by wiring those columns to Firestore. That
 * is the schema the app decided not to have.
 *
 * ## No contact details, on any of the three
 *
 * Even here, where the whole point is phoning families. `CopyContactsButton`
 * already refuses to bulk-fetch them for a clipboard; a file that gets emailed
 * around is the stronger case, not the weaker one. `contact_on_file` is
 * the honest substitute and it is already a badge on the row.
 */
import { sourceReadAt, studentSource } from '@/features/exports/studentSource';
import { isUnreachable } from '@/features/dashboard/insights';
import { isoDate, toCsv, type CsvColumn } from '@/lib/csv';
import { gradeLabel } from '@/lib/utils';
import type { RosterBackendStatus } from '@/services/functions';
import type { OneOffOnlyStudent } from '@/features/dashboard/insights';
import type { MiaStudent, NewVisitor, Student } from '@/types';

export interface FollowUpCsvContext {
  reachable: ReadonlyMap<string, boolean>;
  backends: readonly RosterBackendStatus[];
}

/**
 * Knowing nothing, stated as such.
 *
 * The default for a list rendered without the screen's session-held answers —
 * a test, or a card mounted before the contact read lands. Every column
 * it feeds is one whose blank already means "nobody looked", so an export taken
 * in this state is honest rather than wrong.
 */
export const NO_EXPORT_CONTEXT: FollowUpCsvContext = { reachable: new Map(), backends: [] };

/** Where the leader's own tracking goes. Always last, always empty. */
function workColumns<T>(): CsvColumn<T>[] {
  return [
    { header: 'assigned_to', value: () => '' },
    { header: 'contacted_on', value: () => '' },
    { header: 'outcome', value: () => '' },
  ];
}

function studentColumns<T>(
  of: (row: T) => Student,
  context: FollowUpCsvContext,
): CsvColumn<T>[] {
  return [
    { header: 'student_id', value: (row) => of(row).id },
    { header: 'first_name', value: (row) => of(row).firstName },
    { header: 'last_name', value: (row) => of(row).lastName },
    { header: 'grade', value: (row) => of(row).grade },
    { header: 'grade_label', value: (row) => gradeLabel(of(row)) },
    {
      header: 'contact_on_file',
      value: (row) => {
        const student = of(row);
        if (isUnreachable(student, context.reachable)) return 'no';
        const known = student.profileComplete ?? context.reachable.get(student.id);
        return known === undefined ? '' : 'yes';
      },
    },
    { header: 'source_system', value: (row) => studentSource(of(row)).system },
    { header: 'source_person_id', value: (row) => studentSource(of(row)).personId },
    {
      header: 'source_read_at',
      value: (row) => sourceReadAt(studentSource(of(row)), context.backends),
    },
  ];
}

export function buildMiaCsv(
  items: readonly MiaStudent[],
  context: FollowUpCsvContext,
): string {
  return toCsv(
    [
      ...studentColumns<MiaStudent>((item) => item.student, context),
      // Blank when the row belongs to no gathering — somebody who used to come
      // and has since been at nothing. `gathering_key` disambiguates.
      { header: 'gathering', value: (item) => item.gatheringTitle ?? '' },
      { header: 'gathering_key', value: (item) => item.gatheringKey ?? '' },
      { header: 'consecutive_misses', value: (item) => item.consecutiveMisses },
      { header: 'last_attended', value: (item) => isoDate(item.lastAttendedAt) },
      { header: 'last_attended_event', value: (item) => item.lastAttendedEventTitle ?? '' },
      { header: 'also_missing_count', value: (item) => item.alsoMissingCount },
      ...workColumns<MiaStudent>(),
    ],
    items,
  );
}

export function buildNewVisitorCsv(
  items: readonly NewVisitor[],
  context: FollowUpCsvContext,
): string {
  return toCsv(
    [
      ...studentColumns<NewVisitor>((item) => item.student, context),
      { header: 'first_attended', value: (item) => isoDate(item.firstAttendedAt) },
      { header: 'first_event', value: (item) => item.firstEventTitle },
      { header: 'first_event_id', value: (item) => item.firstEventId },
      { header: 'via_one_off', value: (item) => item.viaOneOff },
      ...workColumns<NewVisitor>(),
    ],
    items,
  );
}

/**
 * The friend brought along on the bus, invisible in every other view.
 *
 * `met_at` and `missed_since` rather than a streak: they belong to no chain of
 * repeats, so "missed three in a row" is not a sentence about them.
 */
export function buildOneOffOnlyCsv(
  items: readonly OneOffOnlyStudent[],
  context: FollowUpCsvContext,
): string {
  return toCsv(
    [
      ...studentColumns<OneOffOnlyStudent>((item) => item.student, context),
      { header: 'met_at', value: (item) => isoDate(item.metAt) },
      { header: 'met_at_event', value: (item) => item.events[0]?.title ?? '' },
      { header: 'missed_since', value: (item) => item.missedSince },
      ...workColumns<OneOffOnlyStudent>(),
    ],
    items,
  );
}

export function buildIncompleteProfileCsv(
  students: readonly Student[],
  context: FollowUpCsvContext,
  now: Date,
): string {
  return toCsv(
    [
      ...studentColumns<Student>((student) => student, context),
      { header: 'is_visitor', value: (student) => student.isVisitor },
      { header: 'added_on', value: (student) => isoDate(student.createdAt) },
      {
        header: 'days_waiting',
        value: (student) =>
          Math.max(
            0,
            Math.floor((now.getTime() - student.createdAt.getTime()) / 86_400_000),
          ),
      },
      { header: 'last_attended', value: (student) => isoDate(student.lastAttendedAt) },
      ...workColumns<Student>(),
    ],
    students,
  );
}
