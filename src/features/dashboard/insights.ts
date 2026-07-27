/**
 * Dashboard insights (Journey 5).
 *
 * Pure derivations over data the caller has already loaded. The dashboard's job
 * is to hand the core team a call list, not a table — so every function here
 * answers a pastoral question rather than reporting a number.
 *
 * Everything below is split by gathering, for the reason the predictive roster
 * is: Friday and Sunday are different crowds. Pooling them meant a student who
 * comes to Sunday School every week and has never once been to a Friday read as
 * "missed three in a row" — a phone call to a family that has missed nothing.
 * "One gathering" is `chainKey`, the same identity check-in predicts from, so
 * the two screens can never disagree about which nights are the same night.
 *
 * One-off events are outside that split entirely, and deliberately so: a
 * retreat is not an instance of anything, and nobody can be absent from a bus
 * trip they were never on. They get their own derivations at the bottom of this
 * file, which ask the question a one-off can actually answer — who did we meet
 * there, and have we seen them since?
 */
import { countRecentHits, effectiveThreshold } from '@/features/roster/predictiveRoster';
import { chainKey } from '@/lib/materialize';
import { toDateOnlyValue } from '@/lib/recurrenceCore';
import { wasHeld } from '@/lib/sessionHistory';
import { sortByName } from '@/lib/utils';
import type {
  AppSettings,
  EventAttendanceSnapshot,
  EventSeries,
  MiaStudent,
  NewVisitor,
  Student,
  TallyEvent,
} from '@/types';

/** Newest-first ordering, which every function below assumes. */
export function orderSnapshotsNewestFirst(
  snapshots: readonly EventAttendanceSnapshot[],
): EventAttendanceSnapshot[] {
  return [...snapshots].sort((a, b) => b.event.startAt.getTime() - a.event.startAt.getTime());
}

/**
 * The gatherings attendance patterns are allowed to be read from: recurring
 * instances that actually happened, newest first.
 *
 * "Actually happened" means somebody was checked in — a night with an empty
 * attendance list was cancelled, whether or not anyone marked it (see
 * `wasHeld`). Counting one as a gathering everybody missed would put the entire
 * ministry on the MIA list the week after a snowstorm.
 */
export function recurringSnapshots(
  snapshots: readonly EventAttendanceSnapshot[],
): EventAttendanceSnapshot[] {
  return orderSnapshotsNewestFirst(
    snapshots.filter((snapshot) => snapshot.event.mode === 'recurring' && wasHeld(snapshot)),
  );
}

/** Held one-off events, newest first. The other half of the calendar. */
export function oneOffSnapshots(
  snapshots: readonly EventAttendanceSnapshot[],
): EventAttendanceSnapshot[] {
  return orderSnapshotsNewestFirst(
    snapshots.filter((snapshot) => snapshot.event.mode === 'oneoff' && wasHeld(snapshot)),
  );
}

/** One recurring gathering — a chain of repeats — and the nights it has held. */
export interface Gathering {
  /** `chainKey`: the series id, else the recurrence root, else the event id. */
  key: string;
  title: string;
  /** Held instances of this gathering only, newest first. */
  snapshots: EventAttendanceSnapshot[];
  /** When it last actually met, which is what the tab order is worth sorting by. */
  lastHeldAt: Date;
}

/**
 * Splits the loaded history into the gatherings it belongs to.
 *
 * Grouped by `chainKey` rather than by `seriesId` for the reason the predictive
 * roster is: a weekly gathering created in the app has a recurrence root and no
 * series document, and keying on `seriesId` alone would file every one of its
 * nights under "no series" together with every other such gathering — Tuesday
 * small group and Wednesday prayer pooled into one meaningless streak.
 *
 * The title comes from the series document when there is one, so renaming a
 * series renames it here too, and from the most recent instance otherwise.
 */
export function groupByGathering(
  snapshots: readonly EventAttendanceSnapshot[],
  series: readonly EventSeries[] = [],
): Gathering[] {
  const seriesTitles = new Map(series.map((entry) => [entry.id, entry.title]));
  const gatherings = new Map<string, Gathering>();

  // Newest first, so each group's first snapshot is its most recent night.
  for (const snapshot of recurringSnapshots(snapshots)) {
    const key = chainKey(snapshot.event);
    const existing = gatherings.get(key);
    if (existing) {
      existing.snapshots.push(snapshot);
      continue;
    }
    const seriesTitle = snapshot.event.seriesId
      ? seriesTitles.get(snapshot.event.seriesId)
      : undefined;
    gatherings.set(key, {
      key,
      title: seriesTitle ?? snapshot.event.title,
      snapshots: [snapshot],
      lastHeldAt: snapshot.event.startAt,
    });
  }

  return [...gatherings.values()].sort((a, b) => b.lastHeldAt.getTime() - a.lastHeldAt.getTime());
}

export interface GatheringStanding {
  /** Nights of this gathering missed in a row, newest first. */
  consecutiveMisses: number;
  /** The most recent night of it they were at, within the loaded window. */
  lastAttended: EventAttendanceSnapshot | null;
  /** Nights of it held since they joined the roster — the streak's denominator. */
  eligible: number;
  /** Nights of it they were actually at, within the same window. */
  attended: number;
  /**
   * Whether this gathering could expect them: they cleared the Recent bar as of
   * their last visit to it. False for somebody who has only ever dropped in.
   */
  wasRegular: boolean;
}

/**
 * Where one student stands with one gathering.
 *
 * The single implementation of the streak rule, so the MIA list and the student
 * page cannot drift apart: a page that said "2 missed" beside a dashboard that
 * had already phoned the family about 3 is worse than either number alone.
 *
 * `wasRegular` is the answer to "was anybody expecting them?", and it is
 * deliberately the *same* question the check-in screen asks about tonight —
 * `predictiveMinAttended` of the last `predictiveOfLastN` nights of this chain,
 * the rule behind the Recent filter — only asked as of their last visit rather
 * than as of now. The roster is every student in the ministry, not a promise
 * that each of them attends everything, so a streak against somebody who drops
 * in twice a term is arithmetic about an expectation nobody ever had. Read this
 * way the MIA list has one meaning: the people who *fell off* this gathering's
 * Recent list.
 *
 * The threshold is clamped to the history actually behind that visit, exactly
 * as `effectiveThreshold` clamps it for a young series. The cost is that a
 * student whose only visit is the oldest night in the window counts as a
 * regular — there is nothing behind it to judge them by. That is the forgiving
 * direction, and it is the one that keeps a genuine drifter on the list when
 * the window is only just long enough to reach their last night.
 */
export function standingIn(
  gathering: Gathering,
  student: Student,
  settings: AppSettings,
): GatheringStanding {
  // Only nights the student could plausibly have attended.
  const eligible = gathering.snapshots.filter(
    (snapshot) => snapshot.event.startAt.getTime() >= student.createdAt.getTime(),
  );

  let consecutiveMisses = 0;
  let lastAttended: EventAttendanceSnapshot | null = null;

  for (const snapshot of eligible) {
    if (snapshot.presentStudentIds.has(student.id)) {
      lastAttended = snapshot;
      break;
    }
    consecutiveMisses += 1;
  }

  const attended = eligible.filter((snapshot) =>
    snapshot.presentStudentIds.has(student.id),
  ).length;

  /*
   * The Recent window as it stood on the night they last came: that night and
   * the ones before it, newest first.
   *
   * Measured over the gathering's whole history rather than over `eligible`,
   * because "was there enough history to judge this visit?" is a question about
   * the calendar, not about when the student was added. Counting from their
   * join date instead made every quick-added visitor a regular by definition:
   * their first night is the oldest one they are eligible for, nothing sits
   * behind it, and the clamp then waved them through. A visitor who came once
   * and never came back is a real follow-up, but they are not somebody a
   * gathering was expecting — and this list is only about expectations broken.
   */
  const inHistory = lastAttended === null ? -1 : gathering.snapshots.indexOf(lastAttended);
  const asOfLastVisit =
    inHistory < 0 ? [] : gathering.snapshots.slice(inHistory, inHistory + settings.predictiveOfLastN);
  const wasRegular =
    lastAttended !== null &&
    countRecentHits(student.id, asOfLastVisit) >=
      effectiveThreshold(settings, asOfLastVisit.length);

  return { consecutiveMisses, lastAttended, eligible: eligible.length, attended, wasRegular };
}

/**
 * Students who have missed `miaConsecutiveMisses` or more recurring gatherings
 * in a row.
 *
 * Three deliberate exclusions:
 *  - Events that happened before a student was added are not counted as misses.
 *    A visitor entered last Friday is not "missing" from the three Fridays
 *    before they existed.
 *  - Inactive students are skipped; they have already been followed up on and
 *    marked as moved away or graduated.
 *  - Gatherings that never happened are not misses either. A cancelled night is
 *    nobody's absence, so it neither counts toward a streak nor breaks one —
 *    `recurringSnapshots` has already dropped it.
 *
 * The streak is counted *within one gathering*, never across the calendar. A
 * Sunday regular who has never been to a Friday has missed no Sundays, and the
 * pooled count that used to sit here put them on the call list every week.
 * `alsoMissingCount` is what survives of the pooled view: it says the drift is
 * not confined to this one gathering, which is a different conversation.
 *
 * Which forces a fourth exclusion, and it is the one that makes the split
 * usable: a gathering may only speak about the students it could *expect*.
 * Every Friday regular has "missed" every Sunday School since the beginning of
 * time, and listing them would put most of the ministry on the Sunday call list
 * — including students seen two days ago. The roster is every student in the
 * ministry, not a promise that each of them attends everything, so a row needs
 * an expectation to have been broken: `wasRegular`, which is the check-in
 * screen's own Recent rule asked as of the student's last visit.
 *
 * Students seen at *nothing* keep their place on the list — they are exactly
 * the person most worth a phone call — but they belong to no gathering, so
 * `computeUnseen` carries them instead, with no gathering named.
 */
export function computeMiaFor(
  gathering: Gathering,
  students: readonly Student[],
  settings: AppSettings,
): MiaStudent[] {
  if (gathering.snapshots.length === 0) return [];

  const results: MiaStudent[] = [];

  for (const student of students) {
    if (student.status !== 'active') continue;

    const { consecutiveMisses, lastAttended, eligible, wasRegular } = standingIn(
      gathering,
      student,
      settings,
    );
    if (eligible < settings.miaConsecutiveMisses) continue;
    if (consecutiveMisses < settings.miaConsecutiveMisses) continue;
    // Nobody was expecting them, so nobody can have missed them. See the fourth
    // exclusion above: without this, every Friday regular is missing from
    // Sunday School, and everyone who dropped in on one Sunday is missing from
    // the seven Sundays they never intended to be at.
    if (!wasRegular || !lastAttended) continue;

    results.push({
      student,
      consecutiveMisses,
      lastAttendedAt: lastAttended.event.startAt,
      lastAttendedEventTitle: lastAttended.event.title,
      gatheringKey: gathering.key,
      gatheringTitle: gathering.title,
      alsoMissingCount: 0,
    });
  }

  // Longest-absent first: that is the order the core team should work the list.
  return results.sort(
    (a, b) => b.consecutiveMisses - a.consecutiveMisses || sortByName(a.student, b.student),
  );
}

/**
 * Students who have been here before and whom the window has seen nowhere.
 *
 * The other half of the MIA list, and the half no gathering can claim: somebody
 * who used to come and has now turned up to nothing has not drifted from Friday
 * or from Sunday, they have drifted from all of it. Their row names no
 * gathering, because naming one would be a guess about which crowd they used to
 * belong to — the window holds no sighting to read it from.
 *
 * The count is pooled here, deliberately — across a student who attends nothing
 * it is the honest number, and it is the only place in this file where nights
 * of different gatherings are added together.
 *
 * Students seen only at a one-off are left out: `computeOneOffOnly` tells their
 * story better, and two lists asking for the same phone call is how a call list
 * stops being worked.
 */
export function computeUnseen(
  students: readonly Student[],
  snapshots: readonly EventAttendanceSnapshot[],
  settings: AppSettings,
): MiaStudent[] {
  const history = recurringSnapshots(snapshots);
  if (history.length === 0) return [];
  const oneOffs = oneOffSnapshots(snapshots);
  const gatherings = groupByGathering(snapshots);

  const results: MiaStudent[] = [];

  for (const student of students) {
    if (student.status !== 'active') continue;
    if (history.some((snapshot) => snapshot.presentStudentIds.has(student.id))) continue;
    if (oneOffs.some((snapshot) => snapshot.presentStudentIds.has(student.id))) continue;

    /*
     * They have to have been here at some point. `lastAttendedAt` is written on
     * every check-in and never cleared, so it reaches back past the window.
     *
     * Tally's roster is the ministry's Planning Center directory, which holds
     * plenty of young people who have never come to youth group and are not
     * going to start because a list said so. Without this the screen fills with
     * them the moment any gathering has met three times — the same "nobody was
     * expecting them" mistake `wasRegular` fixes for the named rows. A student
     * with no check-in anywhere is not missing; nobody has met them.
     *
     * A corrupt timestamp fails every comparison silently, so it is checked
     * rather than trusted — see `computeNewVisitors` for the same guard.
     */
    const lastAttendedAt = student.lastAttendedAt;
    if (!lastAttendedAt || !Number.isFinite(lastAttendedAt.getTime())) continue;

    /*
     * The threshold is measured against one gathering, exactly as it is
     * everywhere else on this screen.
     *
     * Pooled — which is what this used to do — the trigger depends on how many
     * gatherings a ministry runs rather than on how long anybody has been away:
     * three weekly gatherings that have each met once clears "three in a row"
     * inside a single week, and scheduling a fourth would make it fire sooner
     * still. Somebody has to have gone missing from *something* for three of
     * its nights before this list says so.
     */
    const missedOf = gatherings.map(
      (gathering) => standingIn(gathering, student, settings).eligible,
    );
    if (!missedOf.some((nights) => nights >= settings.miaConsecutiveMisses)) continue;

    // Every night they could have been at, anywhere — which is the number the
    // row shows, because "not seen at any of the last N" is what it says.
    const eligible = history.filter(
      (snapshot) => snapshot.event.startAt.getTime() >= student.createdAt.getTime(),
    );

    results.push({
      student,
      consecutiveMisses: eligible.length,
      // The student record is all there is: the window holds no sighting.
      lastAttendedAt,
      lastAttendedEventTitle: null,
      gatheringKey: null,
      gatheringTitle: null,
      alsoMissingCount: 0,
    });
  }

  return results.sort(
    (a, b) => b.consecutiveMisses - a.consecutiveMisses || sortByName(a.student, b.student),
  );
}

/**
 * The MIA rows for every gathering in the loaded history: one row per student
 * per gathering they have drifted from, plus the students no gathering has seen.
 */
export function computeMiaByGathering(
  students: readonly Student[],
  snapshots: readonly EventAttendanceSnapshot[],
  settings: AppSettings,
  series: readonly EventSeries[] = [],
): MiaStudent[] {
  return [
    ...groupByGathering(snapshots, series).flatMap((gathering) =>
      computeMiaFor(gathering, students, settings),
    ),
    ...computeUnseen(students, snapshots, settings),
  ];
}

/**
 * One row per student, for the view that is not looking at a single gathering.
 *
 * A student missing from both Friday and Sunday is one phone call, not two, so
 * the worst streak wins the row and `alsoMissingCount` carries the rest. Ties
 * go to the gathering that met most recently, which `groupByGathering` has
 * already sorted first.
 */
export function mergeMia(rows: readonly MiaStudent[]): MiaStudent[] {
  const worst = new Map<string, MiaStudent>();

  for (const row of rows) {
    const existing = worst.get(row.student.id);
    if (!existing) {
      worst.set(row.student.id, { ...row });
      continue;
    }
    const winner = row.consecutiveMisses > existing.consecutiveMisses ? row : existing;
    worst.set(row.student.id, { ...winner, alsoMissingCount: existing.alsoMissingCount + 1 });
  }

  return [...worst.values()].sort(
    (a, b) => b.consecutiveMisses - a.consecutiveMisses || sortByName(a.student, b.student),
  );
}

/** Every gathering's MIA rows, merged to one row per student. */
export function computeMia(
  students: readonly Student[],
  snapshots: readonly EventAttendanceSnapshot[],
  settings: AppSettings,
  series: readonly EventSeries[] = [],
): MiaStudent[] {
  return mergeMia(computeMiaByGathering(students, snapshots, settings, series));
}

/**
 * First-time attendees inside the recent window.
 *
 * `firstAttendedAt` is written exactly once, on a student's first ever
 * check-in, which makes it a reliable marker even when the loaded snapshot
 * range does not reach back far enough to prove it.
 *
 * Always call this with the *whole* loaded window, never with one gathering's
 * slice: the point of `gatheringKey` is to say which gathering a first-timer
 * walked into, and history narrowed to Sunday would attribute a Friday arrival
 * to Sunday. Callers showing one gathering filter the rows afterwards.
 */
export function computeNewVisitors(
  students: readonly Student[],
  snapshots: readonly EventAttendanceSnapshot[],
  settings: AppSettings,
  now: Date,
): NewVisitor[] {
  const windowStart = new Date(now.getTime() - settings.newVisitorWindowDays * 86_400_000);
  const oldestFirst = orderSnapshotsNewestFirst(snapshots).reverse();

  const results: NewVisitor[] = [];

  for (const student of students) {
    const firstAttendedAt = student.firstAttendedAt;
    // An unusable date fails *every* comparison, including `< windowStart`, so
    // without this check a student with a corrupt timestamp would sit on the
    // new-visitor list permanently — and nobody would think to question it.
    if (!firstAttendedAt || !Number.isFinite(firstAttendedAt.getTime())) continue;
    if (firstAttendedAt < windowStart) continue;

    const firstEvent = oldestFirst.find((snapshot) => snapshot.presentStudentIds.has(student.id));

    results.push({
      student,
      firstEventId: firstEvent?.event.id ?? '',
      firstEventTitle: firstEvent?.event.title ?? 'Unknown event',
      firstAttendedAt,
      // Which gathering they arrived at, or null when they arrived at a one-off
      // — somebody met on the retreat bus is a different follow-up from a
      // first-timer who walked into a Friday, and the row says so.
      gatheringKey:
        firstEvent && firstEvent.event.mode === 'recurring' ? chainKey(firstEvent.event) : null,
      viaOneOff: firstEvent?.event.mode === 'oneoff',
    });
  }

  // Most recent arrival first — follow up while the visit is still fresh.
  return results.sort(
    (a, b) => b.firstAttendedAt.getTime() - a.firstAttendedAt.getTime() || sortByName(a.student, b.student),
  );
}

/**
 * Profiles still missing a parent contact (Journey 3's handoff).
 *
 * Two sources, because there are two kinds of unreachable student and only one
 * of them is a Tally record:
 *
 *  - A quick-added visitor is a name and a grade in Firestore, and carries
 *    `profileComplete: false` by construction. They are the reason this list
 *    exists.
 *  - A student the church has on file with nobody to ring is a fact about
 *    Planning Center, and the roster does not know it: `profileComplete` is
 *    `null` on every roster row because a roster read does not hydrate
 *    households. `reachable` is the answer to that, asked separately by the
 *    screen that shows this list (`useParentContact`).
 *
 * Without the second source this list was empty in every ministry that runs its
 * roster off Planning Center — while the follow-up rows above it said, in so
 * many words, "Planning Center has no parent contact for this student".
 *
 * A student in neither source is one nobody has an answer for — a roster entry
 * that could not be read, or a read that has not landed yet — and is left off.
 * "We did not look" must not be rendered as "nobody can reach them".
 *
 * Quick-added visitors surface first, since they are the freshest to-do.
 */
/**
 * The predicate itself, exported because two screens ask this question.
 *
 * Insights counts unreachable students; the students directory offers the same
 * count as a filter chip. They used to answer it differently — the directory
 * read `profileComplete === false` alone, which is `null` for everybody the
 * roster did not hydrate — so the two screens showed different numbers under
 * the same words, one click apart in the same sidebar. On the one screen whose
 * whole value is that its counts can be trusted, that is not a rounding
 * difference; it is a reason to stop believing either number.
 */
export function isUnreachable(
  student: Student,
  reachable: ReadonlyMap<string, boolean> = new Map(),
): boolean {
  if (student.status !== 'active') return false;
  // Tally's own answer wins where it has one: a visitor who exists nowhere
  // else cannot be looked up, and `null` on a roster row means unasked.
  return (student.profileComplete ?? reachable.get(student.id) ?? null) === false;
}

export function computeIncompleteProfiles(
  students: readonly Student[],
  reachable: ReadonlyMap<string, boolean> = new Map(),
): Student[] {
  return students
    .filter((student) => isUnreachable(student, reachable))
    .sort(
      (a, b) =>
        Number(b.isVisitor) - Number(a.isVisitor) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        sortByName(a, b),
    );
}

/**
 * The students one gathering has actually seen, in the order they were given.
 *
 * What lets a list that is *not* about attendance answer for one gathering
 * anyway. An unfinished profile is a fact about the roster, not about a night,
 * so there is no such thing as "incomplete at Friday" — but "who do we see on a
 * Friday and cannot reach" is a real question, and it is the one a leader is
 * asking when they pick that tab. Every other card on the screen narrows; a
 * card that quietly kept showing the whole ministry read as the tab having no
 * effect.
 *
 * Only the loaded window can answer, so a student whose last visit fell off the
 * end of it belongs to no gathering here and is left to "All" — the same place
 * the MIA list leaves the students no gathering can claim.
 */
export function seenAt(gathering: Gathering, students: readonly Student[]): Student[] {
  const seen = new Set<string>();
  for (const snapshot of gathering.snapshots) {
    for (const id of snapshot.presentStudentIds) seen.add(id);
  }

  return students.filter((student) => seen.has(student.id));
}

export interface AttendancePoint {
  /** One bar, one calendar day — which is also its React key. */
  id: string;
  /** The gathering, or every gathering that met that day, joined for a tooltip. */
  title: string;
  date: Date;
  count: number;
  /** The events behind the bar, newest first. More than one on a busy day. */
  eventIds: string[];
}

/**
 * Head count per day, oldest first, for the trend strip.
 *
 * `gatheringKey` narrows it to one chain of repeats. Left out, the strip mixes
 * every gathering together, which is only meaningful as "how busy were we" —
 * the shape of a single gathering is the sharper question, and it is why the
 * dashboard passes a key.
 *
 * A day is one bar, whatever met on it. Two gatherings on one Sunday used to
 * draw two bars a day apart on a strip labelled by date, which reads as two
 * days — one of them apparently half-attended. Mixed, the honest shape is the
 * day, and the bar is the day's total: switch to a gathering's own tab and its
 * bars still add up to what "All" showed. The cost is that a student at both
 * counts twice, which is what "we had 40 through the door on Sunday" means
 * anyway — and inside one gathering it cannot happen, because a chain holds one
 * occurrence per day.
 *
 * `limit` therefore counts days rather than events: eight bars are eight
 * gatherings' worth of history whether or not a Sunday carried two of them.
 */
export function computeAttendanceTrend(
  snapshots: readonly EventAttendanceSnapshot[],
  options: { gatheringKey?: string | null; limit?: number } = {},
): AttendancePoint[] {
  const filtered = recurringSnapshots(snapshots).filter((snapshot) =>
    options.gatheringKey ? chainKey(snapshot.event) === options.gatheringKey : true,
  );

  // Newest first, so the slice below takes the most recent days.
  const byDay = new Map<string, AttendancePoint & { titles: Set<string> }>();

  for (const snapshot of filtered) {
    const day = toDateOnlyValue(snapshot.event.startAt);
    const existing = byDay.get(day);

    if (existing) {
      existing.count += snapshot.presentStudentIds.size;
      existing.eventIds.push(snapshot.event.id);
      existing.titles.add(snapshot.event.title);
      // The day is stamped with when it started, not with whichever of its
      // gatherings happened to be read first.
      if (snapshot.event.startAt < existing.date) existing.date = snapshot.event.startAt;
      continue;
    }

    byDay.set(day, {
      id: day,
      title: snapshot.event.title,
      date: snapshot.event.startAt,
      count: snapshot.presentStudentIds.size,
      eventIds: [snapshot.event.id],
      titles: new Set([snapshot.event.title]),
    });
  }

  return [...byDay.values()]
    .slice(0, options.limit ?? 8)
    .reverse()
    .map(({ titles, ...point }) => ({ ...point, title: [...titles].join(' + ') }));
}

/* -------------------------------------------------------------------------- */
/* One-off events                                                              */
/* -------------------------------------------------------------------------- */

export interface OneOffRecap {
  event: TallyEvent;
  /** How many students were checked in. */
  count: number;
}

/**
 * What each recent one-off actually drew, newest first.
 *
 * A head count and nothing more. A retreat has no previous instance to compare
 * against and no streak to break, so the only honest number is the one on the
 * night — everything the dashboard says about a one-off has to come from the
 * people who were there, which is what the list below is for.
 */
export function computeOneOffRecaps(
  snapshots: readonly EventAttendanceSnapshot[],
  options: { limit?: number } = {},
): OneOffRecap[] {
  return oneOffSnapshots(snapshots)
    .slice(0, options.limit ?? 5)
    .map((snapshot) => ({ event: snapshot.event, count: snapshot.presentStudentIds.size }));
}

export interface OneOffOnlyStudent {
  student: Student;
  /** The one-offs they turned up to, newest first. */
  events: TallyEvent[];
  /** The most recent of those. */
  metAt: Date;
  /** Recurring nights that have been held since, all of which they missed. */
  missedSince: number;
}

/**
 * Students we have only ever met at a one-off.
 *
 * The retreat is where a ministry meets people it does not otherwise see: a
 * friend brought along for the weekend, a sibling on the bus. They are invisible
 * everywhere else in Tally — never MIA, because they have no gathering to have
 * drifted from, and no longer new, because their first visit has aged out of the
 * new-faces window. This is the list that says "they came once, and no Friday
 * since has had them in it".
 *
 * `missedSince` must be at least one for a student to qualify. A retreat that
 * finished yesterday has had no Friday after it, and telling a leader to chase
 * somebody they will see tomorrow night is how a call list stops being read.
 */
export function computeOneOffOnly(
  students: readonly Student[],
  snapshots: readonly EventAttendanceSnapshot[],
): OneOffOnlyStudent[] {
  const oneOffs = oneOffSnapshots(snapshots);
  if (oneOffs.length === 0) return [];
  const recurring = recurringSnapshots(snapshots);

  const results: OneOffOnlyStudent[] = [];

  for (const student of students) {
    if (student.status !== 'active') continue;
    // Seen at any recurring night in the window: they belong to a gathering, so
    // the MIA list speaks for them and this one must not.
    if (recurring.some((snapshot) => snapshot.presentStudentIds.has(student.id))) continue;

    const attended = oneOffs.filter((snapshot) => snapshot.presentStudentIds.has(student.id));
    if (attended.length === 0) continue;

    const metAt = attended[0]!.event.startAt;
    const missedSince = recurring.filter(
      (snapshot) => snapshot.event.startAt.getTime() > metAt.getTime(),
    ).length;
    if (missedSince === 0) continue;

    results.push({
      student,
      events: attended.map((snapshot) => snapshot.event),
      metAt,
      missedSince,
    });
  }

  // Freshest meeting first: an invitation lands better the week after the trip
  // than the month after it.
  return results.sort(
    (a, b) => b.metAt.getTime() - a.metAt.getTime() || sortByName(a.student, b.student),
  );
}

export interface DashboardSummary {
  lastEventCount: number;
  previousEventCount: number;
  /** Distinct students seen across the loaded window. */
  uniqueStudents: number;
  miaCount: number;
  newVisitorCount: number;
  incompleteCount: number;
}

export function computeSummary(args: {
  snapshots: readonly EventAttendanceSnapshot[];
  mia: readonly MiaStudent[];
  newVisitors: readonly NewVisitor[];
  incomplete: readonly Student[];
}): DashboardSummary {
  const history = recurringSnapshots(args.snapshots);
  const unique = new Set<string>();
  for (const snapshot of history) {
    for (const id of snapshot.presentStudentIds) unique.add(id);
  }

  return {
    lastEventCount: history[0]?.presentStudentIds.size ?? 0,
    previousEventCount: history[1]?.presentStudentIds.size ?? 0,
    uniqueStudents: unique.size,
    miaCount: args.mia.length,
    newVisitorCount: args.newVisitors.length,
    incompleteCount: args.incomplete.length,
  };
}
