/**
 * The Predictive Roster (PRD 4.2).
 *
 * Pure functions only — no Firebase, no React. Everything the check-in screen
 * shows is derived here from plain data, which keeps the interesting logic
 * fully testable and keeps the components dumb.
 *
 * The rule: a student is flagged `isRecent` when they attended at least
 * `predictiveMinAttended` of the last `predictiveOfLastN` instances of *one
 * specific gathering*. Friday history predicts Friday; Sunday history predicts
 * Sunday. They never cross. A one-off names the gathering it borrows from and
 * otherwise predicts from nothing — see `lib/gatherings.ts`.
 *
 * The prediction is a *filter* on one list, not a block above it. See
 * `RosterFocus` for why the check-in screen stopped moving students around.
 */
import { predictionChain } from '@/lib/gatherings';
import { chainKey } from '@/lib/materialize';
import { wasHeld } from '@/lib/sessionHistory';
import { createSearchMatcher, sortByName } from '@/lib/utils';
import type {
  AppSettings,
  AttendanceRecord,
  EventAttendanceSnapshot,
  Grade,
  RosterEntry,
  RosterWarning,
  Rsvp,
  Student,
  TallyEvent,
} from '@/types';

/**
 * Which slice of the one roster list is on screen.
 *
 * These are *filters*, not sections. The check-in screen renders a single list
 * and a tap never moves a student out of it — that was the old three-block
 * layout's worst habit, and with two counselors checking the same queue in at
 * once the list reshuffled under whichever thumb was slower.
 *
 * `recent` therefore includes anyone already checked in, regardless of what the
 * prediction thought of them: a visitor quick-added mid-queue has to be visible
 * without the counselor changing filters, and an accidental tap has to stay
 * reachable so it can be undone.
 */
export type RosterFocus = 'all' | 'recent' | 'checkedIn';

export interface RosterFilters {
  /** Free text from the persistent search bar. */
  query?: string;
  /** Restrict to these grades. Empty or omitted means every grade. */
  grades?: readonly Grade[];
  /** Only students still missing parent contact info. */
  incompleteOnly?: boolean;
  /** Which slice of the list to show. Defaults to all of it. */
  focus?: RosterFocus;
}

export interface RosterView {
  /** The one roster list, A–Z, already narrowed by `focus` and the query. */
  entries: RosterEntry[];
  /**
   * The focus actually applied. A requested `recent` degrades to `all` when the
   * prediction has nothing to say, so callers can render the chip from this and
   * never show an active filter that is not doing anything.
   */
  focus: RosterFocus;
  /** True when a search query is narrowing the list. */
  isFiltered: boolean;
  counts: {
    present: number;
    /** Students eligible for this event, before search filtering. */
    eligible: number;
    /** Eligible students not yet checked in. */
    absent: number;
    /** How many past instances the prediction actually had to work with. */
    historyWindow: number;
    /** Eligible students the prediction expects, before search filtering. */
    recent: number;
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
 * 3" when only one Friday has ever happened would leave the Recent list empty
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
 * Only instances of the same chain count, only instances that have already
 * finished, and only the most recent `ofLastN` of them. The event being checked
 * into is excluded — an event never predicts itself.
 *
 * "Same chain" is `chainKey`, not `seriesId`. A series document is one way to
 * say two gatherings are the same gathering; a shared recurrence root is the
 * other, and it is the only one a weekly event created in the app has. Reading
 * `seriesId` alone meant such an event predicted from nothing forever, however
 * many Saturdays it had behind it, which looked exactly like a broken feature.
 *
 * A one-off names its chain instead of having one. A retreat is not the latest
 * instance of anything, so there is nothing to derive — but the students on the
 * coach are the ones who come on Friday nights, and `predictFromChain` is a
 * leader saying so. Left unset, a trip predicts from nothing, as before.
 *
 * What is never borrowed *from* is another one-off: a retreat is not evidence
 * about who turns up to a retreat, whichever chain either of them names.
 *
 * A gathering that never happened is excluded too, whether it was marked
 * cancelled or merely has nobody checked in (see `wasHeld`). That filter runs
 * *before* the slice on purpose: a snowed-out Friday must cost the window
 * nothing rather than consume one of its three slots and quietly demote every
 * regular in the ministry to "not recent".
 */
export function buildSeriesHistory(
  event: Pick<TallyEvent, 'id' | 'mode' | 'seriesId' | 'recurrenceRootId' | 'predictFromChain'>,
  snapshots: readonly EventAttendanceSnapshot[],
  settings: AppSettings,
): EventAttendanceSnapshot[] {
  const chain = predictionChain(event);
  if (!chain) return [];
  return snapshots
    .filter(
      (snapshot) =>
        snapshot.event.id !== event.id &&
        snapshot.event.mode !== 'oneoff' &&
        chainKey(snapshot.event) === chain &&
        wasHeld(snapshot),
    )
    .sort((a, b) => b.event.startAt.getTime() - a.event.startAt.getTime())
    .slice(0, settings.predictiveOfLastN);
}

/* -------------------------------------------------------------------------- */
/* Eligibility                                                                 */
/* -------------------------------------------------------------------------- */

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

/**
 * Advisory badges for one roster row.
 *
 * Both depend only on the student, never on the event: what a counselor needs
 * to know about a kid does not change between a Friday and a retreat.
 */
export function computeWarnings(student: Student): RosterWarning[] {
  const warnings: RosterWarning[] = [];
  if (student.hasAllergies) warnings.push('allergy');
  // `=== false` deliberately, not falsy: `null` means nobody has checked, and a
  // badge on every row is a badge nobody reads.
  if (student.profileComplete === false) warnings.push('incomplete-profile');
  return warnings;
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
}

/**
 * Whether a requested focus can actually be honoured.
 *
 * `recent` is the default the check-in screen opens on, so it has to fail
 * gracefully rather than present an empty list. A search is a direct lookup and
 * must reach the whole roster; and with no regulars to show there is no filter
 * to apply.
 */
function resolveFocus(
  requested: RosterFocus,
  context: { isFiltered: boolean; recent: number },
): RosterFocus {
  if (requested !== 'recent') return requested;
  if (context.isFiltered || context.recent === 0) return 'all';
  return 'recent';
}

export function buildRoster(input: BuildRosterInput): RosterView {
  const { event, students, attendance, rsvps, settings } = input;
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
  const grades = filters.grades ?? [];

  const matched: RosterEntry[] = [];
  // Counted before the search filter: the header must keep reading "12 of 34"
  // while a counselor types, not "1 of 34".
  let eligible = 0;
  let presentTotal = 0;
  let recentTotal = 0;

  for (const student of students) {
    const record = attendanceByStudent.get(student.id) ?? null;
    const rsvp = rsvpByStudent.get(student.id);

    if (!isEligible(student, event, rsvp, record !== null)) continue;

    // Scope filters narrow *who is on this counselor's roster*; they apply
    // before search so the counts below describe the slice being taken, not
    // the whole ministry.
    if (grades.length > 0 && !grades.includes(student.grade)) continue;
    if (filters.incompleteOnly && student.profileComplete !== false) continue;

    const recentHits = countRecentHits(student.id, history);
    const isRecent = recentHits >= threshold;

    eligible += 1;
    if (record) presentTotal += 1;
    if (isRecent) recentTotal += 1;

    if (!matcher.matches(student.searchName)) continue;

    matched.push({
      student,
      isRecent,
      attendance: record,
      rsvp: rsvp ?? null,
      warnings: computeWarnings(student),
      recentHits,
      recentWindow: historyWindow,
    });
  }

  const focus = resolveFocus(filters.focus ?? 'all', { isFiltered, recent: recentTotal });

  const entries = matched.filter((entry) => {
    if (focus === 'checkedIn') return entry.attendance !== null;
    if (focus === 'recent') return entry.isRecent || entry.attendance !== null;
    return true;
  });

  /*
   * One ordering for the one list, and it depends on nothing that a tap can
   * change. A student's position is a function of their name alone, so checking
   * somebody in paints their row green exactly where the thumb already is
   * instead of teleporting it past the four names underneath.
   *
   * While a query is running, why a row matched comes first and the name breaks
   * ties inside each band. That is not the same rule bent: the order still
   * changes only between keystrokes, never as a consequence of checking
   * somebody in. Without it, typing "ma" for the Maya at the front of the queue
   * put five people whose surnames merely contain "ma" above her.
   */
  entries.sort(
    (a, b) =>
      (isFiltered ? matcher.rank(a.student) - matcher.rank(b.student) : 0) ||
      sortByName(a.student, b.student),
  );

  return {
    entries,
    focus,
    isFiltered,
    counts: {
      present: presentTotal,
      eligible,
      absent: Math.max(0, eligible - presentTotal),
      historyWindow,
      recent: recentTotal,
    },
  };
}
