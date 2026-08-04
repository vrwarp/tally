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
 * `recent` and `participated` are nested rather than parallel: the regulars the
 * prediction expects tonight are a subset of everyone who has ever walked into
 * this gathering, which is itself a subset of the ministry's whole roster. That
 * is the ladder the check-in screen widens along — see `resolveFocus`.
 *
 * Both therefore include anyone already checked in, regardless of what the
 * prediction or the history thought of them: a visitor quick-added mid-queue
 * has to be visible without the counselor changing filters, and an accidental
 * tap has to stay reachable so it can be undone.
 *
 * Undoing that tap must not take the row away either — see `pinned`.
 */
export type RosterFocus =
  | 'all'
  | 'recent'
  | 'participated'
  | 'checkedIn'
  /**
   * Checked in and not yet collected — the live room count, and the only
   * number a nursery volunteer is actually working from. Both of these are
   * stood down to `all` on an event that does not track check-out, so a
   * leftover value cannot strand somebody on a filter whose chip is not on
   * screen.
   */
  | 'inRoom'
  | 'checkedOut';

/**
 * What "has participated" is being measured against, for the screen that has to
 * say so out loud.
 *
 * `gathering` — attended one of this chain's loaded past instances. The answer
 * a counselor means by "who comes to this".
 *
 * `ever` — attended anything in the last year, read off the student's own
 * `lastAttendedAt`. The fallback for an event with no history to read: a retreat
 * that borrows from nothing, or the very first night of a new gathering. It is
 * a weaker claim, so the roster heading says which one it is rather than letting
 * the two look alike. Same year as everything else — a student last seen in the
 * spring of the year before last belongs to no roster this app draws.
 *
 * `none` — nothing worth filtering by. An RSVP trip is already a curated list;
 * narrowing it again could only hide somebody who said yes.
 */
export type ParticipationSource = 'gathering' | 'ever' | 'none';

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
  /**
   * The grades anybody eligible tonight is in, ascending.
   *
   * Collected before the search filter and before the grade filter itself, so
   * narrowing to one grade does not collapse the list of grades on offer.
   */
  gradesPresent: readonly Grade[];
  /** What `counts.participated` counted, so the screen can say which it means. */
  participationSource: ParticipationSource;
  counts: {
    /**
     * Checked in. This is attendance, and check-out does not touch it: a
     * missed pickup must never reduce a head count.
     */
    present: number;
    /** Checked in and not collected. `inRoom + checkedOut === present`. */
    inRoom: number;
    /** Checked in and collected. */
    checkedOut: number;
    /** Students eligible for this event, before search filtering. */
    eligible: number;
    /** Eligible students not yet checked in. */
    absent: number;
    /** How many past instances the prediction actually had to work with. */
    historyWindow: number;
    /** Eligible students the prediction expects, before search filtering. */
    recent: number;
    /**
     * Eligible students who have been to this gathering before (or, under the
     * `ever` source, to anything), before search filtering. Zero when there is
     * nothing to measure against.
     */
    participated: number;
    /**
     * How many past instances `participated` was drawn from — always at least
     * `historyWindow`, and zero unless the source is `gathering`.
     */
    participationWindow: number;
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
 * Nothing older than `PARTICIPATION_MAX_AGE_DAYS` counts, here or anywhere else
 * the roster reads history. A prediction drawn from gatherings a year gone is
 * not a prediction, and one rule for how far back the roster looks is easier to
 * keep true than two.
 *
 * A gathering that never happened is excluded too, whether it was marked
 * cancelled or merely has nobody checked in (see `wasHeld`). That filter runs
 * *before* the slice on purpose: a snowed-out Friday must cost the window
 * nothing rather than consume one of its three slots and quietly demote every
 * regular in the ministry to "not recent".
 */
export function buildSeriesHistory(
  event: Pick<
    TallyEvent,
    'id' | 'mode' | 'seriesId' | 'recurrenceRootId' | 'predictFromChain' | 'startAt'
  >,
  snapshots: readonly EventAttendanceSnapshot[],
  settings: AppSettings,
): EventAttendanceSnapshot[] {
  return buildChainHistory(event, snapshots).slice(0, settings.predictiveOfLastN);
}

/**
 * How far back a roster is willing to call somebody one of its own.
 *
 * A ministry turns over: the students who filled the room two years ago have
 * graduated, and a roster that still counts them is back to being a list of
 * everybody the church has ever met — which is the thing the participation
 * filter exists to stop being. A year is the natural unit because a youth
 * ministry's year is one: somebody who came at all last autumn is plausibly
 * coming back this autumn, and somebody who did not is a name, not a student.
 *
 * Measured from the gathering being checked into rather than from the wall
 * clock, so back-filling last month's register asks who belonged to the room
 * *that* night, and so the same inputs always give the same roster.
 */
export const PARTICIPATION_MAX_AGE_DAYS = 365;

const DAY_MS = 86_400_000;

/** The oldest attendance `event` will count as participation. */
function participationCutoff(event: Pick<TallyEvent, 'startAt'>): Date {
  return new Date(event.startAt.getTime() - PARTICIPATION_MAX_AGE_DAYS * DAY_MS);
}

/**
 * Every past instance of the chain from the last year, newest first, unsliced.
 *
 * The same selection `buildSeriesHistory` makes, minus the prediction's window.
 * The prediction asks a narrow question — "is this student a regular *now*" —
 * and three Fridays is the right amount of evidence for it. "Does this student
 * belong to this gathering" is a different question and wants every Friday the
 * app has, so the two windows are taken separately from one load rather than
 * the wider one being inferred from the narrower.
 *
 * Bounded twice over: by the year above, and by what the caller passed, which is
 * bounded in turn by how far back the check-in screen reads
 * (`useSeriesHistoryEvents`). Whichever is tighter wins, and neither claims to
 * be all of history — which is why the screen prints the window it actually got
 * alongside the count.
 */
export function buildChainHistory(
  event: Pick<
    TallyEvent,
    'id' | 'mode' | 'seriesId' | 'recurrenceRootId' | 'predictFromChain' | 'startAt'
  >,
  snapshots: readonly EventAttendanceSnapshot[],
): EventAttendanceSnapshot[] {
  const chain = predictionChain(event);
  if (!chain) return [];
  const cutoff = participationCutoff(event);
  return snapshots
    .filter(
      (snapshot) =>
        snapshot.event.id !== event.id &&
        snapshot.event.mode !== 'oneoff' &&
        chainKey(snapshot.event) === chain &&
        // Bounded at both ends. The check-in screen only ever loads finished
        // instances, but back-filling last month's register would otherwise
        // count the Fridays since as evidence about who belonged to the room
        // that night — history running backwards.
        snapshot.event.startAt < event.startAt &&
        snapshot.event.startAt >= cutoff &&
        wasHeld(snapshot),
    )
    .sort((a, b) => b.event.startAt.getTime() - a.event.startAt.getTime());
}

/**
 * What this event can honestly measure participation against.
 *
 * An RSVP trip opts out entirely: `isEligible` has already narrowed the roster
 * to the students who said yes, and a second filter over that list could only
 * take away somebody who is getting on the bus.
 *
 * Everything else prefers the gathering's own history and falls back to the
 * student's `lastAttendedAt` when there is none — a retreat pointed at no
 * chain, or a gathering meeting for the first time. That fallback is worth
 * having because the alternative is the whole ministry: on a roster synced from
 * Planning Center, most of the names have never walked into anything.
 */
export function participationSource(
  event: Pick<TallyEvent, 'requiresRsvp'>,
  historyWindow: number,
): ParticipationSource {
  if (event.requiresRsvp) return 'none';
  return historyWindow > 0 ? 'gathering' : 'ever';
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
 * must remain visible so a counselor can see and undo it — which is why
 * `buildRoster` passes a pinned student here as checked in even once they are
 * not.
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
  // Their Planning Center record is known dead, so the rules will refuse the
  // check-in; the row has to say so before the tap, not after it fails.
  if (student.pcoRecordMissing === true) warnings.push('record-missing');
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
  /**
   * Students to keep on the roster whatever happens to their attendance.
   *
   * Checking somebody in pulls them onto the Recent list even when the
   * prediction never expected them there. Undoing it used to drop them straight
   * back off, which is exactly backwards: an undo is most often a correction of
   * a mis-tap, and the row the counselor now needs is the one that just
   * vanished. So the caller holds the ids it has seen checked in and passes
   * them here, and they stay put — on Recent, and eligible for the roster at
   * all — until the page is reloaded.
   *
   * Deliberately not persisted anywhere: it is a courtesy to the thumb in the
   * middle of a correction, not a lasting claim that these students are
   * regulars. Reload and the list is the prediction's again.
   */
  pinned?: ReadonlySet<string>;
}

/** Shared so an unpinned call allocates nothing per render. */
const EMPTY_PINNED: ReadonlySet<string> = new Set();

/**
 * Whether a requested focus can actually be honoured, and what to show instead.
 *
 * `recent` is the default the check-in screen opens on, so it has to fail
 * gracefully rather than present an empty list. It used to fail all the way to
 * the whole roster, which on a Planning Center sync is every teenager the church
 * has a record of — a hundred and twenty-nine names, most of whom have never
 * come to anything. So a stood-down `recent` lands on `participated` first and
 * only reaches `all` when that has nothing to offer either.
 *
 * A search is a direct lookup and stands *both* of them down: the student in
 * front of the counselor may well be somebody this gathering has never seen, and
 * a search box that cannot find them is worse than a long list.
 *
 * `participated` is also stood down when it would not narrow anything. A filter
 * that selects the entire roster is a chip that lies about what it is doing.
 *
 * The two check-out focuses go the same way on a gathering that does not track
 * it. Their chips are not on screen there, so a value left over from the last
 * roster a counselor had open would be a filter with no way to turn it off.
 */
function resolveFocus(
  requested: RosterFocus,
  context: {
    isFiltered: boolean;
    recent: number;
    participated: number;
    eligible: number;
    tracksCheckOut: boolean;
  },
): RosterFocus {
  let wanted = requested;

  if ((wanted === 'inRoom' || wanted === 'checkedOut') && !context.tracksCheckOut) return 'all';

  if (wanted === 'recent') {
    if (!context.isFiltered && context.recent > 0) return 'recent';
    wanted = 'participated';
  }

  if (wanted === 'participated') {
    if (!context.isFiltered && context.participated > 0 && context.participated < context.eligible)
      return 'participated';
    return 'all';
  }

  return wanted;
}

export function buildRoster(input: BuildRosterInput): RosterView {
  const { event, students, attendance, rsvps, settings } = input;
  const filters = input.filters ?? {};
  const pinned = input.pinned ?? EMPTY_PINNED;

  const attendanceByStudent = new Map(attendance.map((record) => [record.studentId, record]));
  const rsvpByStudent = new Map(rsvps.map((record) => [record.studentId, record]));

  // One selection, two windows. The prediction reads the most recent few of
  // these; "has been here before" reads all of them.
  const chainHistory = buildChainHistory(event, input.history);
  const history = chainHistory.slice(0, settings.predictiveOfLastN);
  const historyWindow = history.length;
  const threshold = effectiveThreshold(settings, historyWindow);

  const source = participationSource(event, chainHistory.length);
  const participationWindow = source === 'gathering' ? chainHistory.length : 0;
  const participationSince = participationCutoff(event);

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
  // Which grades are actually represented tonight, so the grade filter can
  // offer those and not all thirteen `Grade` admits.
  const gradesSeen = new Set<Grade>();
  let presentTotal = 0;
  let checkedOutTotal = 0;
  let recentTotal = 0;
  let participatedTotal = 0;

  for (const student of students) {
    const record = attendanceByStudent.get(student.id) ?? null;
    const rsvp = rsvpByStudent.get(student.id);

    const isPinned = pinned.has(student.id);

    if (!isEligible(student, event, rsvp, record !== null || isPinned)) continue;

    // Which grades tonight's roster covers, collected *before* the grade
    // filter narrows it — otherwise picking 6th would leave the dropdown
    // offering 6th alone, with no way back to the others.
    if (student.grade !== null) gradesSeen.add(student.grade);

    // Scope filters narrow *who is on this counselor's roster*; they apply
    // before search so the counts below describe the slice being taken, not
    // the whole ministry.
    // Somebody with no grade is in no grade — narrowing to 6th must not hand
    // a counselor the adult volunteers, or the nursery.
    if (grades.length > 0 && (student.grade === null || !grades.includes(student.grade))) {
      continue;
    }
    if (filters.incompleteOnly && student.profileComplete !== false) continue;

    const recentHits = countRecentHits(student.id, history);
    const isRecent = recentHits >= threshold;

    /*
     * Being here counts as having been here.
     *
     * Unlike `isRecent`, which is a claim about the past and must not move when
     * a row is tapped, this is a claim about whether the student belongs to the
     * gathering at all — and a visitor quick-added at the door plainly does, as
     * of tonight. Counting them keeps the filter's number and its list saying
     * the same thing while the queue moves.
     */
    const participationHits =
      source === 'gathering' ? countRecentHits(student.id, chainHistory) : 0;
    const hasParticipated =
      source === 'none'
        ? false
        : record !== null ||
          (source === 'gathering'
            ? participationHits > 0
            : student.lastAttendedAt !== null && student.lastAttendedAt >= participationSince);

    eligible += 1;
    if (record) presentTotal += 1;
    if (record?.checkedOutAt) checkedOutTotal += 1;
    if (isRecent) recentTotal += 1;
    if (hasParticipated) participatedTotal += 1;

    if (!matcher.matches(student.searchName)) continue;

    matched.push({
      student,
      isRecent,
      hasParticipated,
      attendance: record,
      rsvp: rsvp ?? null,
      warnings: computeWarnings(student),
      recentHits,
      recentWindow: historyWindow,
    });
  }

  const focus = resolveFocus(filters.focus ?? 'all', {
    isFiltered,
    recent: recentTotal,
    participated: participatedTotal,
    eligible,
    tracksCheckOut: event.requiresCheckOut,
  });

  const entries = matched.filter((entry) => {
    // `checkedIn` is a statement about right now and stays literal: a pinned
    // student who has just been undone is precisely somebody who is *not* here.
    if (focus === 'checkedIn') return entry.attendance !== null;
    if (focus === 'inRoom') return entry.attendance !== null && entry.attendance.checkedOutAt === null;
    if (focus === 'checkedOut') return entry.attendance?.checkedOutAt != null;
    if (focus === 'recent')
      return entry.isRecent || entry.attendance !== null || pinned.has(entry.student.id);
    if (focus === 'participated')
      return entry.hasParticipated || pinned.has(entry.student.id);
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
    gradesPresent: [...gradesSeen].sort((a, b) => a - b),
    participationSource: source,
    counts: {
      present: presentTotal,
      inRoom: presentTotal - checkedOutTotal,
      checkedOut: checkedOutTotal,
      eligible,
      absent: Math.max(0, eligible - presentTotal),
      historyWindow,
      recent: recentTotal,
      participated: participatedTotal,
      participationWindow,
    },
  };
}
