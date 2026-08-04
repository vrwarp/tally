/**
 * The attendance write payloads, free of any Firestore SDK.
 *
 * Two entry points write check-ins: the main app through `firebase/firestore`
 * and the kiosk through `firebase/firestore/lite`. The two SDKs' types are
 * incompatible, but the documents they must produce are identical — so the
 * payload builders live here, with the one SDK-specific ingredient (the
 * `serverTimestamp()` sentinel) injected by the caller. Both SDKs convert a
 * native `Date` to a `Timestamp` on write, so dates pass through as-is.
 */
import type { CheckInMethod, Student } from '@/types';

/**
 * The SDK-specific ingredients the builders need.
 *
 * `deleteField` matters as much as the clock: undoing a check-out has to remove
 * the key rather than null it, because a pending `serverTimestamp()` also reads
 * back as null and "null" is what the roster reads as *still in the room*. See
 * `toAttendance`.
 */
export interface PayloadClock {
  serverTimestamp(): unknown;
  deleteField(): unknown;
}

/** The subset of a student the attendance writes need. */
export type CheckInStudent = Pick<
  Student,
  | 'id'
  | 'firstName'
  | 'lastName'
  | 'grade'
  | 'gradeOnFile'
  | 'searchName'
  | 'firstAttendedAt'
  | 'lastAttendedAt'
>;

/** "First time this student has ever been marked present at anything." */
export function isFirstEver(student: Pick<Student, 'firstAttendedAt'>): boolean {
  return student.firstAttendedAt === null;
}

export function attendancePayload(
  clock: PayloadClock,
  args: {
    event: { id: string; seriesId: string | null };
    studentId: string;
    uid: string;
    method: CheckInMethod;
    isFirstEver: boolean;
    /**
     * When they arrived, if that is already known.
     *
     * Only `swapCheckIn` passes it: a correction is not a new arrival, so the
     * moment has to survive being moved to another student. Everything else
     * takes the server clock, which is the one clock every device agrees on.
     */
    checkedInAt?: Date;
  },
): Record<string, unknown> {
  return {
    studentId: args.studentId,
    eventId: args.event.id,
    seriesId: args.event.seriesId,
    checkedInAt: args.checkedInAt ?? clock.serverTimestamp(),
    checkedInBy: args.uid,
    method: args.method,
    isFirstEver: args.isFirstEver,
  };
}

/**
 * A pickup: the two fields the check-out rule permits, and nothing else.
 *
 * Written as a merge or an update rather than a `set`, always — a whole-document
 * `set` reads as "touches everything" to `touchesOnly` and the rule refuses it.
 */
export function checkOutPayload(clock: PayloadClock, uid: string): Record<string, unknown> {
  return { checkedOutAt: clock.serverTimestamp(), checkedOutBy: uid };
}

/** Undoing one. Deletes the keys; see `PayloadClock`. */
export function undoCheckOutPayload(clock: PayloadClock): Record<string, unknown> {
  return { checkedOutAt: clock.deleteField(), checkedOutBy: clock.deleteField() };
}

/**
 * The patch a check-in makes to the student document, or `null` for nothing to do.
 *
 * `firstAttendedAt` is written once and never moved, so "New Visitors" stays
 * stable even if someone back-fills an older event later. `lastAttendedAt` only
 * moves forward, so checking a student into a historical event does not rewrite
 * their "last seen" to the past.
 *
 * The name and grade ride along even though a check-in does not change them.
 * Most students have no Firestore document at all — the roster comes from
 * Planning Center, and Tally writes one only when it has something of its own to
 * record. Being checked in *is* that something, so this write frequently creates
 * the document, and a document with nothing in it but two timestamps is
 * unreadable in the console and fails the rules' identity check.
 */
export function studentDatePatch(
  clock: PayloadClock,
  student: CheckInStudent,
  event: { startAt: Date },
  uid: string,
): Record<string, unknown> | null {
  const dates: Record<string, unknown> = {};
  if (student.firstAttendedAt === null) dates.firstAttendedAt = event.startAt;
  if (!student.lastAttendedAt || student.lastAttendedAt < event.startAt) {
    dates.lastAttendedAt = event.startAt;
  }
  if (Object.keys(dates).length === 0) return null;

  return {
    ...dates,
    firstName: student.firstName,
    lastName: student.lastName,
    /*
     * Left out for somebody Planning Center holds no grade for, where `grade`
     * is where the sync's clamp landed rather than a fact — see `gradeOnFile`.
     *
     * This is the write that reaches most people: a tap at a door is how the
     * majority of these documents come into existence at all. Stamping the
     * clamp here would put an invented 6th grade on the permanent record of
     * every adult a leader ever checked in, in the one place that outlives the
     * roster row it was copied from.
     */
    ...(student.gradeOnFile === false ? {} : { grade: student.grade }),
    searchName: student.searchName,
    updatedAt: clock.serverTimestamp(),
    updatedBy: uid,
  };
}
