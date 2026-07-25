/**
 * Dashboard insights (Journey 5).
 *
 * Pure derivations over data the caller has already loaded. The dashboard's job
 * is to hand the core team a call list, not a table — so every function here
 * answers a pastoral question rather than reporting a number.
 */
import { wasHeld } from '@/lib/sessionHistory';
import { sortByName } from '@/lib/utils';
import type {
  AppSettings,
  EventAttendanceSnapshot,
  MiaStudent,
  NewVisitor,
  Student,
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
 * A student with no attendance at all still qualifies, provided enough
 * gatherings have happened since they joined the roster — that is exactly the
 * person most worth a phone call.
 */
export function computeMia(
  students: readonly Student[],
  snapshots: readonly EventAttendanceSnapshot[],
  settings: AppSettings,
): MiaStudent[] {
  const history = recurringSnapshots(snapshots);
  if (history.length === 0) return [];

  const results: MiaStudent[] = [];

  for (const student of students) {
    if (student.status !== 'active') continue;

    // Only gatherings the student could plausibly have attended.
    const eligible = history.filter(
      (snapshot) => snapshot.event.startAt.getTime() >= student.createdAt.getTime(),
    );
    if (eligible.length < settings.miaConsecutiveMisses) continue;

    let consecutiveMisses = 0;
    let lastAttended: EventAttendanceSnapshot | null = null;

    for (const snapshot of eligible) {
      if (snapshot.presentStudentIds.has(student.id)) {
        lastAttended = snapshot;
        break;
      }
      consecutiveMisses += 1;
    }

    if (consecutiveMisses < settings.miaConsecutiveMisses) continue;

    results.push({
      student,
      consecutiveMisses,
      lastAttendedAt: lastAttended?.event.startAt ?? student.lastAttendedAt,
      lastAttendedEventTitle: lastAttended?.event.title ?? null,
    });
  }

  // Longest-absent first: that is the order the core team should work the list.
  return results.sort(
    (a, b) => b.consecutiveMisses - a.consecutiveMisses || sortByName(a.student, b.student),
  );
}

/**
 * First-time attendees inside the recent window.
 *
 * `firstAttendedAt` is written exactly once, on a student's first ever
 * check-in, which makes it a reliable marker even when the loaded snapshot
 * range does not reach back far enough to prove it.
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
  seriesId: string | null;
  count: number;
}

/** Head-count per gathering, oldest first, for the trend strip. */
export function computeAttendanceTrend(
  snapshots: readonly EventAttendanceSnapshot[],
  options: { seriesId?: string | null; limit?: number } = {},
): AttendancePoint[] {
  const filtered = recurringSnapshots(snapshots).filter((snapshot) =>
    options.seriesId ? snapshot.event.seriesId === options.seriesId : true,
  );

  return filtered
    .slice(0, options.limit ?? 8)
    .reverse()
    .map((snapshot) => ({
      eventId: snapshot.event.id,
      title: snapshot.event.title,
      date: snapshot.event.startAt,
      seriesId: snapshot.event.seriesId,
      count: snapshot.presentStudentIds.size,
    }));
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
