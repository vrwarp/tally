/**
 * "First seen" and "last seen", reconciled against the nights on screen.
 *
 * `firstAttendedAt` / `lastAttendedAt` are denormalised conveniences on the
 * student document, and the app is explicit that they are not the ledger: a
 * check-in writes them, `undoCheckIn` deliberately leaves them alone rather
 * than scanning history to recompute, `markPresentOnly` never touches them, and
 * the Planning Center import moves `lastAttendedAt` forward only. Every one of
 * those rules is right on its own, and together they mean the field is a
 * high-water mark rather than a sighting — it can name a night the register
 * does not.
 *
 * On most screens that is the best answer available. On the profile it is not,
 * because the profile has already read the thing the field is a stand-in for:
 * `useProfileHistory` asks the student's *own* attendance documents which
 * nights of the last year they were checked into, so within that window the
 * snapshots are authoritative in both directions — present *and* absent. A
 * profile that prints "last seen 26 July" above a grid whose most recent mark
 * is 26 June is contradicting evidence it is displaying inches away.
 *
 * So the ledger wins where the ledger can speak, and the stored field covers
 * the rest. That is the same order of precedence the MIA list already uses —
 * `computeMiaFor` reports the night it found, `computeUnseen` falls back to
 * `lastAttendedAt` only when the window holds no sighting at all.
 *
 * What the window cannot speak about is left alone, which is why this does not
 * simply take the newest mark in the grid:
 *
 *   - Anything older than the window. A student imported out of Planning Center
 *     Check-Ins may have come for years before it starts.
 *   - Tonight. `historyWindow` drops a gathering whose check-in is still open,
 *     so a student tapped in an hour ago has a `lastAttendedAt` no snapshot
 *     backs — and "last seen 7 days ago" while they stand in the room is a
 *     worse answer than the one this replaces.
 *   - A night no longer on the calendar, or one nobody has loaded.
 *
 * The discriminator is therefore narrow on purpose: the stored date is only
 * overruled when the window contains a night the student was demonstrably not
 * at, at that very instant — or on that very day, provided the stored instant
 * is not later than everything the window holds. The proviso is tonight again:
 * on a Sunday with a class at half nine and youth group at six, the class is
 * loaded and the evening is not, and a tap at six must not be denied by a
 * morning the student was never going to. Absence is knowable here —
 * `presentStudentIds` for these snapshots comes from the student's own records,
 * so a night they are missing from is a night they were not checked into,
 * whether or not anybody else was.
 */
import { isSameDay } from 'date-fns';
import type { EventAttendanceSnapshot, Student } from '@/types';

export interface SeenDates {
  /** The earliest sighting anything on this page can support. */
  firstSeenAt: Date | null;
  /** The most recent one. */
  lastSeenAt: Date | null;
  /**
   * The window disproved the stored date and had no sighting of its own to put
   * in its place — so `lastSeenAt` is null for want of evidence rather than
   * because nobody has ever checked this student in. "Never" is a claim about
   * all of history; this is a claim about a year.
   */
  unseenInWindow: boolean;
}

/** A timestamp that survived Firestore, an import, and a hand edit. */
function usable(date: Date | null): Date | null {
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function reconcileSeen(
  student: Pick<Student, 'id' | 'firstAttendedAt' | 'lastAttendedAt'>,
  snapshots: readonly EventAttendanceSnapshot[],
): SeenDates {
  const storedFirst = usable(student.firstAttendedAt);
  const storedLast = usable(student.lastAttendedAt);

  let ledgerFirst: Date | null = null;
  let ledgerLast: Date | null = null;
  /** The loaded nights without them. */
  const absent: Date[] = [];
  /** The newest night loaded at all, present or not. */
  let newest: Date | null = null;

  for (const snapshot of snapshots) {
    const startAt = snapshot.event.startAt;
    if (!Number.isFinite(startAt.getTime())) continue;
    if (!newest || startAt > newest) newest = startAt;

    if (snapshot.presentStudentIds.has(student.id)) {
      if (!ledgerFirst || startAt < ledgerFirst) ledgerFirst = startAt;
      if (!ledgerLast || startAt > ledgerLast) ledgerLast = startAt;
      continue;
    }

    absent.push(startAt);
  }

  /** A loaded night without them on the stored day — see the header. */
  const denied = (stored: Date | null): boolean =>
    stored !== null &&
    absent.some(
      (startAt) =>
        startAt.getTime() === stored.getTime() ||
        (isSameDay(startAt, stored) && newest !== null && stored <= newest),
    );
  const firstDenied = denied(storedFirst);
  const lastDenied = denied(storedLast);

  /*
   * `firstSeenAt` needs no such denial to move: a sighting earlier than the
   * date on file disproves it outright, whichever way the field was written.
   * The denial only matters when the window found nothing at all, and answers
   * whether the stored date is a first visit or a tap somebody took back.
   */
  const firstSeenAt = firstDenied
    ? ledgerFirst
    : earliest(storedFirst, ledgerFirst);

  const lastSeenAt = lastDenied ? ledgerLast : latest(storedLast, ledgerLast);

  return {
    firstSeenAt,
    lastSeenAt,
    unseenInWindow: lastDenied && ledgerLast === null,
  };
}

function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
