/**
 * Check-in writes and attendance history reads.
 *
 * Concurrency model (PRD 4.1): the attendance document id *is* the student id,
 * so two counselors tapping the same student at the same instant produce one
 * document, not two. `onSnapshot` then fans the result out to every device.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toAttendance } from '@/services/converters';
import { buildStudentPayload, newStudentRef, type StudentDraft } from '@/services/students';
import type { AttendanceRecord, CheckInMethod, Student, TallyEvent } from '@/types';

/** Live attendance for one event — the shared source of truth across devices. */
export function subscribeAttendance(
  eventId: string,
  onChange: (records: AttendanceRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, paths.attendanceCollection(eventId)),
    (snapshot) => onChange(snapshot.docs.map((d) => toAttendance(d, eventId))),
    (error) => onError?.(error),
  );
}

function attendancePayload(args: {
  event: Pick<TallyEvent, 'id' | 'seriesId'>;
  studentId: string;
  uid: string;
  method: CheckInMethod;
  isFirstEver: boolean;
}) {
  return {
    studentId: args.studentId,
    eventId: args.event.id,
    seriesId: args.event.seriesId,
    checkedInAt: serverTimestamp(),
    checkedInBy: args.uid,
    method: args.method,
    isFirstEver: args.isFirstEver,
  };
}

/**
 * Marks a student present.
 *
 * Also maintains the two denormalised dates on the student document:
 *  - `firstAttendedAt` is written once and never moved, so "New Visitors"
 *    stays stable even if someone back-fills an older event later.
 *  - `lastAttendedAt` only moves forward, so checking a student into a
 *    historical event does not rewrite their "last seen" to the past.
 */
export async function checkIn(args: {
  event: Pick<TallyEvent, 'id' | 'seriesId' | 'startAt'>;
  student: Pick<Student, 'id' | 'firstAttendedAt' | 'lastAttendedAt'>;
  uid: string;
  method: CheckInMethod;
}): Promise<void> {
  const { event, student, uid, method } = args;
  const isFirstEver = student.firstAttendedAt === null;

  const batch = writeBatch(db);

  batch.set(
    doc(db, paths.attendance(event.id, student.id)),
    attendancePayload({ event, studentId: student.id, uid, method, isFirstEver }),
  );

  const studentPatch: Record<string, unknown> = {};
  if (isFirstEver) studentPatch.firstAttendedAt = event.startAt;
  if (!student.lastAttendedAt || student.lastAttendedAt < event.startAt) {
    studentPatch.lastAttendedAt = event.startAt;
  }
  if (Object.keys(studentPatch).length > 0) {
    batch.update(doc(db, paths.student(student.id)), studentPatch);
  }

  await batch.commit();
}

/**
 * Reverses a mistaken tap.
 *
 * The student's `firstAttendedAt` / `lastAttendedAt` are deliberately left
 * alone: recomputing them would need a scan of every past event, and the
 * dashboard derives its real numbers from attendance documents anyway. The
 * fields are display conveniences, not the ledger.
 */
export async function undoCheckIn(eventId: string, studentId: string): Promise<void> {
  await deleteDoc(doc(db, paths.attendance(eventId, studentId)));
}

/**
 * Journey 3: creates a visitor and checks them in as one atomic write, so the
 * modal can close immediately without leaving a half-finished record behind.
 */
export async function quickAddAndCheckIn(args: {
  draft: StudentDraft;
  event: Pick<TallyEvent, 'id' | 'seriesId' | 'startAt'>;
  uid: string;
}): Promise<string> {
  const { draft, event, uid } = args;
  const studentRef = newStudentRef();

  const batch = writeBatch(db);
  batch.set(studentRef, {
    ...buildStudentPayload(draft, uid),
    // Flags the yellow "Missing Info" badge for the core-team handoff.
    isVisitor: true,
    firstAttendedAt: event.startAt,
    lastAttendedAt: event.startAt,
  });
  batch.set(
    doc(db, paths.attendance(event.id, studentRef.id)),
    attendancePayload({
      event,
      studentId: studentRef.id,
      uid,
      method: 'quick-add',
      isFirstEver: true,
    }),
  );

  await batch.commit();
  return studentRef.id;
}

/** Adds a student to an event without touching their profile dates. */
export async function markPresentOnly(args: {
  event: Pick<TallyEvent, 'id' | 'seriesId'>;
  studentId: string;
  uid: string;
  method?: CheckInMethod;
}): Promise<void> {
  await setDoc(
    doc(db, paths.attendance(args.event.id, args.studentId)),
    attendancePayload({
      event: args.event,
      studentId: args.studentId,
      uid: args.uid,
      method: args.method ?? 'manual',
      isFirstEver: false,
    }),
  );
}

/**
 * One-shot read of who attended each of the given events.
 *
 * Used by the predictive roster and the dashboard, which need history rather
 * than a live feed — a Friday from three weeks ago is not going to change while
 * a counselor stands at the door, so paying for a listener would be waste.
 */
export async function fetchAttendanceByEvent(
  eventIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const results = await Promise.all(
    eventIds.map(async (eventId) => {
      const snapshot = await getDocs(collection(db, paths.attendanceCollection(eventId)));
      return [eventId, new Set(snapshot.docs.map((d) => d.id))] as const;
    }),
  );
  return new Map(results);
}

/** Full attendance records (not just ids) for one event. */
export async function fetchAttendance(eventId: string): Promise<AttendanceRecord[]> {
  const snapshot = await getDocs(collection(db, paths.attendanceCollection(eventId)));
  return snapshot.docs.map((d) => toAttendance(d, eventId));
}
