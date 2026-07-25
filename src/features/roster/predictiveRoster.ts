/**
 * The Predictive Roster (PRD 4.2).
 *
 * Pure functions only — no Firebase, no React. Everything the check-in screen
 * shows is derived here from plain data, which keeps the interesting logic
 * fully testable and keeps the components dumb.
 *
 * The rule: a student is surfaced in the "Recent" block when they attended at
 * least `predictiveMinAttended` of the last `predictiveOfLastN` instances of
 * *this specific series*. Friday history predicts Friday; Sunday history
 * predicts Sunday. They never cross.
 */
import { createSearchMatcher, sortByName } from '@/lib/utils';
import type {
  AppSettings,
  AttendanceRecord,
  EventAttendanceSnapshot,
  Grade,
  RosterEntry,
  RosterWarning,
  Rsvp,
  SmallGroup,
  Student,
  TallyEvent,
} from '@/types';

export interface RosterFilters {
  /** Free text from the persistent search bar. */
  query?: string;
  /** Restrict to one small group (Journey 2). */
  smallGroupId?: string | null;
  /** Restrict to one grade. */
  grade?: Grade | null;
  /** Only students still missing parent contact info. */
  incompleteOnly?: boolean;
}

export interface RosterView {
  /** Predicted likely attendees, most consistent first. Empty when filtering. */
  recent: RosterEntry[];
  /** Everyone else still expected but not yet checked in. */
  roster: RosterEntry[];
  /** Already present, most recent tap first. */
  checkedIn: RosterEntry[];
  /** True when a search query collapsed `recent` into `roster`. */
  isFiltered: boolean;
  counts: {
    present: number;
    /** Students eligible for this event, before search filtering. */
    eligible: number;
    /** Eligible students not yet checked in. */
    absent: number;
    /** How many past instances the prediction actually had to work with. */
    historyWindow: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Prediction                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How many of the given past instances a student attended.
 * `history` should already be limited to one series and to the most recent
 * `ofLastN` instances (see `buildSeriesHistory`).
 */
export function countRecentHits(
  studentId: string,
  history: readonly EventAttendanceSnapshot[],
): number {
  let hits = 0;
  for (const instance of history) {
    if (instance.presentStudentIds.has(studentId)) hits += 1;
  }
  return hits;
}

/**
 * The threshold actually applied, given how much history exists.
 *
 * A brand-new series has fewer past instances than `ofLastN`. Demanding "2 of
 * 3" when only one Friday has ever happened would leave the Recent block empty
 * and make the feature look broken, so the requirement is clamped to the
 * available window. With no history at all there is nothing to predict from.
 */
export function effectiveThreshold(settings: AppSettings, historyWindow: number): number {
  if (historyWindow <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.min(settings.predictiveMinAttended, historyWindow));
}

/**
 * Selects the past instances that inform a given event's prediction.
 *
 * Only instances of the same series count, only instances that have already
 * finished, and only the most recent `ofLastN` of them. The event being checked
 * into is excluded — an event never predicts itself.
 */
export function buildSeriesHistory(
  event: Pick<TallyEvent, 'id' | 'seriesId'>,
  snapshots: readonly EventAttendanceSnapshot[],
  settings: AppSettings,
): EventAttendanceSnapshot[] {
  if (!event.seriesId) return [];
  return snapshots
    .filter(
      (snapshot) =>
        snapshot.event.id !== event.id &&
        snapshot.event.seriesId === event.seriesId &&
        snapshot.event.status !== 'cancelled',
    )
    .sort((a, b) => b.event.startAt.getTime() - a.event.startAt.getTime())
    .slice(0, settings.predictiveOfLastN);
}

/* -------------------------------------------------------------------------- */
/* Eligibility & grouping                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Does a student belong to a small group?
 *
 * An explicit `smallGroupId` on the student always wins. Without one we fall
 * back to the group's grade/gender definition, so a roster imported without
 * group assignments still splits sensibly for Sunday School.
 */
export function studentMatchesGroup(student: Student, group: SmallGroup): boolean {
  if (student.smallGroupId) return student.smallGroupId === group.id;
  if (group.grades.length > 0 && !group.grades.includes(student.grade)) return false;
  if (group.gender !== 'mixed' && student.gender !== group.gender) return false;
  return true;
}

/**
 * Who may appear on this event's roster at all, before any UI filtering.
 *
 * Recurring events open to every active student. One-off events with an RSVP
 * requirement are restricted to students who said yes or maybe — a declined
 * RSVP means they are not getting on the bus (Journey 4).
 *
 * Anyone already checked in is always eligible regardless of the above. A
 * student who was checked in by mistake, or who turned up despite declining,
 * must remain visible so a counselor can see and undo it.
 */
export function isEligible(
  student: Student,
  event: Pick<TallyEvent, 'mode' | 'requiresRsvp'>,
  rsvp: Rsvp | undefined,
  isCheckedIn: boolean,
): boolean {
  if (isCheckedIn) return true;
  if (student.status !== 'active') return false;
  if (event.requiresRsvp) return rsvp !== undefined && rsvp.status !== 'no';
  return true;
}

export function computeWarnings(
  student: Student,
  event: Pick<TallyEvent, 'requiresWaiver' | 'requiresPayment'>,
  rsvp: Rsvp | undefined,
): RosterWarning[] {
  const warnings: RosterWarning[] = [];
  if (event.requiresWaiver && !rsvp?.waiverSigned) warnings.push('missing-waiver');
  if (event.requiresPayment && !rsvp?.paymentReceived) warnings.push('missing-payment');
  if (student.hasAllergies) warnings.push('allergy');
  // `=== false` deliberately, not falsy: `null` means nobody has checked, and a
  // badge on every row is a badge nobody reads.
  if (student.profileComplete === false) warnings.push('incomplete-profile');
  return warnings;
}

/** Warnings that should physically stop a student boarding (Journey 4). */
export function isBlocking(warning: RosterWarning): boolean {
  return warning === 'missing-waiver' || warning === 'missing-payment';
}

/* -------------------------------------------------------------------------- */
/* The roster itself                                                           */
/* -------------------------------------------------------------------------- */

export interface BuildRosterInput {
  event: TallyEvent;
  students: readonly Student[];
  /** Live attendance for `event`. */
  attendance: readonly AttendanceRecord[];
  /** Live RSVPs for `event`. Empty for recurring events. */
  rsvps: readonly Rsvp[];
  /** Past instances of the same series, any order — filtered here. */
  history: readonly EventAttendanceSnapshot[];
  settings: AppSettings;
  filters?: RosterFilters;
  /** The small group a counselor is scoped to, if any. */
  group?: SmallGroup | null;
}

export function buildRoster(input: BuildRosterInput): RosterView {
  const { event, students, attendance, rsvps, settings, group } = input;
  const filters = input.filters ?? {};

  const attendanceByStudent = new Map(attendance.map((record) => [record.studentId, record]));
  const rsvpByStudent = new Map(rsvps.map((record) => [record.studentId, record]));

  const history = buildSeriesHistory(event, input.history, settings);
  const historyWindow = history.length;
  const threshold = effectiveThreshold(settings, historyWindow);

  // Built once for the whole pass: the matcher does the query-side work up
  // front, and knows better than a `trim()` whether anything searchable was
  // actually typed (a query of pure punctuation narrows nothing).
  const matcher = createSearchMatcher(filters.query ?? '');
  const isFiltered = !matcher.isEmpty;

  const checkedIn: RosterEntry[] = [];
  const recent: RosterEntry[] = [];
  const roster: RosterEntry[] = [];
  // Counted before the search filter: the header must keep reading "12 of 34"
  // while a counselor types, not "1 of 34".
  let eligible = 0;
  let presentTotal = 0;

  for (const student of students) {
    const record = attendanceByStudent.get(student.id) ?? null;
    const rsvp = rsvpByStudent.get(student.id);

    if (!isEligible(student, event, rsvp, record !== null)) continue;

    // Scope filters narrow *who is on this counselor's roster*; they apply
    // before search so the counts below describe the group being taken, not
    // the whole ministry.
    if (group && !studentMatchesGroup(student, group)) continue;
    if (filters.smallGroupId && student.smallGroupId !== filters.smallGroupId) continue;
    if (filters.grade != null && student.grade !== filters.grade) continue;
    if (filters.incompleteOnly && student.profileComplete !== false) continue;

    eligible += 1;
    if (record) presentTotal += 1;

    if (!matcher.matches(student.searchName)) continue;

    const recentHits = countRecentHits(student.id, history);
    const entry: RosterEntry = {
      student,
      section: record ? 'checkedIn' : 'roster',
      attendance: record,
      rsvp: rsvp ?? null,
      warnings: computeWarnings(student, event, rsvp),
      recentHits,
      recentWindow: historyWindow,
    };

    if (record) {
      checkedIn.push({ ...entry, section: 'checkedIn' });
    } else if (!isFiltered && recentHits >= threshold) {
      recent.push({ ...entry, section: 'recent' });
    } else {
      roster.push(entry);
    }
  }

  // Most consistent attendees first: the regulars a counselor is about to tap
  // should be reachable without scrolling.
  recent.sort(
    (a, b) => b.recentHits - a.recentHits || sortByName(a.student, b.student),
  );
  roster.sort((a, b) => sortByName(a.student, b.student));
  // Newest tap on top, so the counselor can confirm (and undo) what just happened.
  checkedIn.sort(
    (a, b) =>
      (b.attendance?.checkedInAt.getTime() ?? 0) - (a.attendance?.checkedInAt.getTime() ?? 0) ||
      sortByName(a.student, b.student),
  );

  return {
    recent,
    roster,
    checkedIn,
    isFiltered,
    counts: {
      present: presentTotal,
      eligible,
      absent: Math.max(0, eligible - presentTotal),
      historyWindow,
    },
  };
}
