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
import { chainKey } from '@/lib/materialize';
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
 * usable: a gathering may only speak about the students who *come to it*. Every
 * Friday regular has "missed" every Sunday School since the beginning of time,
 * and listing them would put most of the ministry on the Sunday call list —
 * including students seen two days ago. So a row needs evidence the student was
 * ever part of this gathering, which is one attendance at it inside the loaded
 * window.
 *
 * Students seen at *nothing* keep their place on the list — they are exactly
 * the person most worth a phone call — but they belong to no gathering, so
 * `computeUnseen` carries them instead, with no gathering named.
 */
export interface GatheringStanding {
  /** Nights of this gathering missed in a row, newest first. */
  consecutiveMisses: number;
  /** The most recent night of it they were at, within the loaded window. */
  lastAttended: EventAttendanceSnapshot | null;
  /** Nights of it held since they joined the roster — the streak's denominator. */
  eligible: number;
}

/**
 * Where one student stands with one gathering.
 *
 * The single implementation of the streak rule, so the MIA list and the student
 * page cannot drift apart: a page that said "2 missed" beside a dashboard that
 * had already phoned the family about 3 is worse than either number alone.
 */
export function standingIn(gathering: Gathering, student: Student): GatheringStanding {
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

  return { consecutiveMisses, lastAttended, eligible: eligible.length };
}

export function computeMiaFor(
  gathering: Gathering,
  students: readonly Student[],
  settings: AppSettings,
): MiaStudent[] {
  if (gathering.snapshots.length === 0) return [];

  const results: MiaStudent[] = [];

  for (const student of students) {
    if (student.status !== 'active') continue;

    const { consecutiveMisses, lastAttended, eligible } = standingIn(gathering, student);
    if (eligible < settings.miaConsecutiveMisses) continue;
    if (consecutiveMisses < settings.miaConsecutiveMisses) continue;
    // Never been to this one, so there is nothing to have drifted from. See the
    // fourth exclusion above: without this, every Friday regular is missing
    // from Sunday School.
    if (!lastAttended) continue;

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
 * Students the loaded window has not seen at anything at all.
 *
 * The other half of the MIA list, and the half no gathering can claim: somebody
 * on the roster who has turned up to nothing has not drifted from Friday or
 * from Sunday, they have drifted from all of it. Their row names no gathering,
 * because naming one would be a guess about which crowd they used to belong to.
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

  const results: MiaStudent[] = [];

  for (const student of students) {
    if (student.status !== 'active') continue;
    if (history.some((snapshot) => snapshot.presentStudentIds.has(student.id))) continue;
    if (oneOffs.some((snapshot) => snapshot.presentStudentIds.has(student.id))) continue;

    // Nights they could plausibly have been at, across every gathering.
    const eligible = history.filter(
      (snapshot) => snapshot.event.startAt.getTime() >= student.createdAt.getTime(),
    );
    if (eligible.length < settings.miaConsecutiveMisses) continue;

    results.push({
      student,
      consecutiveMisses: eligible.length,
      // The student record is all there is: the window holds no sighting.
      lastAttendedAt: student.lastAttendedAt,
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
 * Quick-added visitors surface first, since they are the reason the list exists.
 */
export function computeIncompleteProfiles(students: readonly Student[]): Student[] {
  return students
    .filter((student) => student.status === 'active' && student.profileComplete === false)
    .sort(
      (a, b) =>
        Number(b.isVisitor) - Number(a.isVisitor) ||
        b.createdAt.getTime() - a.createdAt.getTime() ||
        sortByName(a, b),
    );
}

export interface AttendancePoint {
  eventId: string;
  title: string;
  date: Date;
  gatheringKey: string;
  count: number;
}

/**
 * Head-count per night, oldest first, for the trend strip.
 *
 * `gatheringKey` narrows it to one chain of repeats. Left out, the strip mixes
 * every gathering into one line of bars, which is only meaningful as "how busy
 * were we" — the shape of a single gathering is the question worth asking, and
 * it is why the dashboard passes a key.
 */
export function computeAttendanceTrend(
  snapshots: readonly EventAttendanceSnapshot[],
  options: { gatheringKey?: string | null; limit?: number } = {},
): AttendancePoint[] {
  const filtered = recurringSnapshots(snapshots).filter((snapshot) =>
    options.gatheringKey ? chainKey(snapshot.event) === options.gatheringKey : true,
  );

  return filtered
    .slice(0, options.limit ?? 8)
    .reverse()
    .map((snapshot) => ({
      eventId: snapshot.event.id,
      title: snapshot.event.title,
      date: snapshot.event.startAt,
      gatheringKey: chainKey(snapshot.event),
      count: snapshot.presentStudentIds.size,
    }));
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
