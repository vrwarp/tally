/**
 * Check-in writes and attendance history reads.
 *
 * Concurrency model (PRD 4.1): the attendance document id *is* the student id,
 * so two counselors tapping the same student at the same instant produce one
 * document, not two. `onSnapshot` then fans the result out to every device.
 */
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COLLECTIONS, paths } from '@/lib/paths';
import { toAttendance, toEvent } from '@/services/converters';
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
  /**
   * When they arrived, if that is already known.
   *
   * Only `swapCheckIn` passes it: a correction is not a new arrival, so the
   * moment has to survive being moved to another student. Everything else takes
   * the server clock, which is the one clock every device agrees on.
   */
  checkedInAt?: Date;
}) {
  return {
    studentId: args.studentId,
    eventId: args.event.id,
    seriesId: args.event.seriesId,
    checkedInAt: args.checkedInAt ?? serverTimestamp(),
    checkedInBy: args.uid,
    method: args.method,
    isFirstEver: args.isFirstEver,
  };
}

/** The subset of a student the attendance writes need. */
type CheckInStudent = Pick<
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
function studentDatePatch(
  student: CheckInStudent,
  event: Pick<TallyEvent, 'startAt'>,
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
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
}

/**
 * Marks a student present.
 *
 * Also maintains the two denormalised dates on the student document — see
 * `studentDatePatch`.
 */
export async function checkIn(args: {
  event: Pick<TallyEvent, 'id' | 'seriesId' | 'startAt'>;
  student: CheckInStudent;
  uid: string;
  method: CheckInMethod;
}): Promise<void> {
  const { event, student, uid, method } = args;

  const batch = writeBatch(db);

  batch.set(
    doc(db, paths.attendance(event.id, student.id)),
    attendancePayload({
      event,
      studentId: student.id,
      uid,
      method,
      isFirstEver: student.firstAttendedAt === null,
    }),
  );

  const patch = studentDatePatch(student, event, uid);
  if (patch) {
    // `set(..., { merge: true })` rather than `update`, which requires the
    // document to already exist. For a Planning Center student it usually does
    // not, and an `update` that fails takes the *attendance* write down with it
    // — the tap would flash green and then quietly not have happened.
    batch.set(doc(db, paths.student(student.id)), patch, { merge: true });
  }

  await batch.commit();
}

/**
 * Moves one check-in from the student it was filed against to the right one.
 *
 * This exists for the two names that look the same at arm's length in a noisy
 * hallway — the Jordan Reyes / Jordan Rees problem. Undo-then-check-in reaches
 * the same end state, but it costs the moment: the replacement is stamped with
 * the server clock, which by then is a minute or two after the student actually
 * walked through the door. The whole point of a correction is that only *who*
 * was wrong, so `checkedInAt` and the method that recorded it come across
 * untouched and the record still says the student arrived at 7:04.
 *
 * `checkedInBy` becomes whoever is fixing it, because rules require a
 * counselor to own the documents they write. That is honest anyway: the
 * correction is theirs.
 *
 * The wrongly-tapped student's own `firstAttendedAt` / `lastAttendedAt` are
 * left alone, exactly as `undoCheckIn` leaves them — those fields are display
 * conveniences, and the attendance documents are the ledger.
 *
 * One write, so there is never an instant where the event has both students
 * present or neither.
 */
export async function swapCheckIn(args: {
  event: Pick<TallyEvent, 'id' | 'seriesId' | 'startAt'>;
  /** The check-in as it stands — the record being moved, not a new one. */
  from: Pick<AttendanceRecord, 'studentId' | 'checkedInAt' | 'method'>;
  /** Who was actually at the door. */
  to: CheckInStudent;
  uid: string;
}): Promise<void> {
  const { event, from, to, uid } = args;
  // Nothing to move, and writing it anyway would delete and recreate the same
  // document — a check-in that blinks out of existence on every other device.
  if (from.studentId === to.id) return;

  const batch = writeBatch(db);

  batch.delete(doc(db, paths.attendance(event.id, from.studentId)));
  batch.set(
    doc(db, paths.attendance(event.id, to.id)),
    attendancePayload({
      event,
      studentId: to.id,
      uid,
      method: from.method,
      // Recomputed for whoever is receiving it: "first time ever" is a fact
      // about the student, not about the check-in being moved.
      isFirstEver: to.firstAttendedAt === null,
      checkedInAt: from.checkedInAt,
    }),
  );

  const patch = studentDatePatch(to, event, uid);
  if (patch) batch.set(doc(db, paths.student(to.id)), patch, { merge: true });

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
 * How many of those reads are allowed to be in flight at once.
 *
 * Callers used to ask for a couple of dozen nights, and firing all of them
 * together was the right thing. A student's profile now asks for every finished
 * night of the last year, which on a ministry running several weekly gatherings
 * is a few hundred — and a few hundred simultaneous reads over whatever signal a
 * church hall has means they all contend and none of them lands early.
 *
 * The pool does not reduce the work or the number of reads; it changes the shape
 * of the wait. On a fast connection the total time is unchanged. On a slow one
 * the first nights arrive while the rest are still queued, which is the
 * difference between a page that fills in and a page that hangs.
 */
const ATTENDANCE_READ_CONCURRENCY = 12;

/**
 * One-shot read of who attended each of the given events.
 *
 * Used by the predictive roster and the dashboard, which need history rather
 * than a live feed — a Friday from three weeks ago is not going to change while
 * a counselor stands at the door, so paying for a listener would be waste.
 *
 * The returned map is keyed by event id and carries one entry per id asked for;
 * its iteration order is completion order, not the order given, and no caller
 * reads it as a sequence.
 */
export async function fetchAttendanceByEvent(
  eventIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const results = new Map<string, Set<string>>();
  let next = 0;

  // Each worker takes the next id and reads it, until there are none left. The
  // increment is synchronous with the read of `next`, so two workers can never
  // claim the same event.
  const worker = async (): Promise<void> => {
    for (let index = next++; index < eventIds.length; index = next++) {
      const eventId = eventIds[index];
      if (eventId === undefined) continue;
      const snapshot = await getDocs(collection(db, paths.attendanceCollection(eventId)));
      results.set(eventId, new Set(snapshot.docs.map((d) => d.id)));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ATTENDANCE_READ_CONCURRENCY, eventIds.length) }, worker),
  );

  return results;
}

/** Full attendance records (not just ids) for one event. */
export async function fetchAttendance(eventId: string): Promise<AttendanceRecord[]> {
  const snapshot = await getDocs(collection(db, paths.attendanceCollection(eventId)));
  return snapshot.docs.map((d) => toAttendance(d, eventId));
}

/* -------------------------------------------------------------------------- */
/* One student's whole history                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How many nights one page of a student's history holds.
 *
 * Each row costs a document read for the night it belongs to, so a page is a
 * page of reads. Twenty is roughly two terms of a weekly gathering — enough
 * that the first press usually answers the question somebody opened the
 * profile with.
 */
export const STUDENT_HISTORY_PAGE_SIZE = 20;

/** One night a student was checked in to, with the gathering it belonged to. */
export interface StudentHistoryEntry {
  record: AttendanceRecord;
  /** Null when the event document is gone — the record still stands. */
  event: TallyEvent | null;
}

/** Opaque cursor for the next page. Nothing outside this module reads it. */
export type StudentHistoryCursor = QueryDocumentSnapshot<DocumentData>;

export interface StudentHistoryPage {
  entries: StudentHistoryEntry[];
  cursor: StudentHistoryCursor | null;
  hasMore: boolean;
}

/**
 * A page of the nights one student was checked in to, newest first — reaching
 * as far back as the ministry has records, not as far back as the calendar the
 * app keeps loaded.
 *
 * A collection-group query rather than a walk over `events`, and that choice is
 * the whole point: the student's own attendance documents *are* the answer, and
 * asking for them directly is one indexed query for any depth of history. The
 * index has been declared for this since before anything used it
 * (`firestore.indexes.json`, `attendance` by `studentId` + `checkedInAt desc`),
 * and `firestore.rules` carries the wildcard `list` a collection-group query
 * needs.
 *
 * What it deliberately cannot answer is which nights the student *missed*: an
 * absence is a fact about the gathering's calendar, not about this student, and
 * proving one this far back would mean paging every instance of every chain.
 * The profile says as much where it shows these.
 */
export async function fetchStudentHistory(
  studentId: string,
  cursor: StudentHistoryCursor | null = null,
  pageSize: number = STUDENT_HISTORY_PAGE_SIZE,
): Promise<StudentHistoryPage> {
  const snapshot = await getDocs(
    query(
      collectionGroup(db, COLLECTIONS.attendance),
      where('studentId', '==', studentId),
      orderBy('checkedInAt', 'desc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(pageSize),
    ),
  );

  /*
   * The event id comes from the document's own path rather than from its
   * `eventId` field. The two agree — the security rules require it on every
   * write — but the path is the one that cannot have been written wrong, and
   * this is the read that would silently attribute a night to the wrong
   * gathering if it were.
   */
  const eventIds = [
    ...new Set(
      snapshot.docs
        .map((document) => document.ref.parent.parent?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];

  const events = new Map<string, TallyEvent>();
  await Promise.all(
    eventIds.map(async (eventId) => {
      const document = await getDoc(doc(db, paths.event(eventId)));
      if (document.exists()) events.set(eventId, toEvent(document));
    }),
  );

  const entries = snapshot.docs.flatMap<StudentHistoryEntry>((document) => {
    const eventId = document.ref.parent.parent?.id;
    if (!eventId) return [];
    return [{ record: toAttendance(document, eventId), event: events.get(eventId) ?? null }];
  });

  /*
   * Ordered by the night, not by when the kiosk recorded it.
   *
   * The query has to sort on `checkedInAt` — that is the indexed field, and it
   * is what pages — but an imported record carries the instant Planning Center
   * wrote it, which for a register taken late is a day or two after the
   * gathering. Sorting the page by the gathering's own start puts the rows in
   * the order a reader expects; the page *boundaries* still follow the cursor,
   * which is invisible unless a single page straddles such a record.
   */
  entries.sort(
    (a, b) =>
      (b.event?.startAt ?? b.record.checkedInAt).getTime() -
      (a.event?.startAt ?? a.record.checkedInAt).getTime(),
  );

  const last = snapshot.docs.at(-1) ?? null;
  return {
    entries,
    // A short page is the end of the history, and a cursor for it could only
    // buy a request that comes back empty.
    cursor: snapshot.docs.length === pageSize ? last : null,
    hasMore: snapshot.docs.length === pageSize,
  };
}
