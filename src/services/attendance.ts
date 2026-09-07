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
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { isPermissionDenied } from '@/lib/permissionDenied';
import {
  attendancePayload as buildAttendancePayload,
  studentDatePatch as buildStudentDatePatch,
  checkOutPayload as buildCheckOutPayload,
  undoCheckOutPayload as buildUndoCheckOutPayload,
  type CheckInStudent,
} from '@/services/attendancePayloads';
import { toAttendance, toEvent } from '@/services/converters';
import { getStudentAttendance } from '@/services/functions';
import { buildStudentPayload, newStudentRef, type StudentDraft } from '@/services/students';
import type { AttendanceRecord, CheckInMethod, TallyEvent } from '@/types';

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

/*
 * The payload builders live in `attendancePayloads.ts`, SDK-free, because the
 * kiosk entry writes the same documents through `firebase/firestore/lite`.
 * These two wrappers bind them to this module's SDK clock.
 */
const CLOCK = { serverTimestamp, deleteField };

function attendancePayload(
  args: Parameters<typeof buildAttendancePayload>[1],
): Record<string, unknown> {
  return buildAttendancePayload(CLOCK, args);
}

function studentDatePatch(
  student: CheckInStudent,
  event: Pick<TallyEvent, 'startAt'>,
  uid: string,
): Record<string, unknown> | null {
  return buildStudentDatePatch(CLOCK, student, event, uid);
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
      // A check-out deliberately does not travel. The arrival moment is copied
      // because only *who* was wrong about it — but a pickup recorded against
      // the wrong child is a statement about a parent who checked out somebody
      // else's kid, and there is nothing in it worth preserving. The corrected
      // record starts present; if the right child has already gone home,
      // somebody checks them out again.
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
 * Records that somebody checked a student out, on an event that tracks check-out.
 *
 * `updateDoc` rather than `setDoc`, for two reasons that both matter. A pickup
 * for a child nobody checked in is a bug, and this fails rather than inventing
 * a half-record for them. And a whole-document `set` reads as "touches
 * everything" to the rules' `touchesOnly`, which would refuse the write.
 *
 * Deliberately not gated on who did the check-in: the volunteer who takes a
 * child in is rarely the one who hands them back.
 */
export async function checkOut(eventId: string, studentId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, paths.attendance(eventId, studentId)), buildCheckOutPayload(CLOCK, uid));
}

/**
 * Puts a student back in the room.
 *
 * Deletes the two fields rather than nulling them — see `PayloadClock`. This is
 * not the same as undoing a check-in, which deletes the record entirely and
 * takes any pickup with it.
 */
export async function undoCheckOut(eventId: string, studentId: string): Promise<void> {
  await updateDoc(doc(db, paths.attendance(eventId, studentId)), buildUndoCheckOutPayload(CLOCK));
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
 *
 * `present` is everyone with a record — the head count, unchanged by check-out.
 * `checkedOut` is the subset that was checked out, always a subset, and read from
 * the same documents at the same cost.
 */
export interface EventAttendanceIds {
  present: Set<string>;
  checkedOut: Set<string>;
}

/**
 * What a batch read came back with, and what it was refused.
 *
 * The two have to be separate channels, and this is the single most important
 * shape in the access feature. A register the reader may not see is *not* an
 * empty register: `sessionOutcome` reads an empty one as `presumed-cancelled`,
 * which drops the night out of `buildChainHistory`, inflates the dashboard's
 * skipped count, and counts as an absence for every student in
 * `computeMiaByGathering` — which is a phone call to a family about a gathering
 * the reader simply was not allowed to look at.
 *
 * So a denied event appears in `denied` and *nowhere* in `byEvent`. A caller
 * that ignores `denied` gets no snapshot rather than a wrong one, which is the
 * failure mode worth having.
 */
export interface EventAttendanceRead {
  byEvent: Map<string, EventAttendanceIds>;
  /** Event ids whose register the caller may not read. */
  denied: Set<string>;
}

export async function fetchAttendanceByEvent(
  eventIds: readonly string[],
): Promise<EventAttendanceRead> {
  const byEvent = new Map<string, EventAttendanceIds>();
  const denied = new Set<string>();
  let next = 0;

  // Each worker takes the next id and reads it, until there are none left. The
  // increment is synchronous with the read of `next`, so two workers can never
  // claim the same event.
  const worker = async (): Promise<void> => {
    // Stryker disable next-line EqualityOperator: one past the end reads as
    // `undefined` and is skipped by the guard below, so a `<=` bound costs an
    // iteration that does nothing and changes no answer.
    for (let index = next++; index < eventIds.length; index = next++) {
      const eventId = eventIds[index];
      // Stryker disable next-line ConditionalExpression: and the guard cannot
      // fire while the bound above is right — it is here because the index is
      // computed rather than iterated, and `noUncheckedIndexedAccess` is
      // correct that nothing in the types says it is in range.
      if (eventId === undefined) continue;

      /*
       * Per event, not per batch.
       *
       * Callers hand this a window — one series' recent instances, the
       * dashboard's last six weeks — and those windows mix gatherings freely.
       * Rejecting the whole batch on the first refusal meant one restricted
       * Sunday emptied the roster of every Friday beside it, on a screen
       * somebody is standing at a door holding.
       *
       * Only a refusal is swallowed. A network failure or a malformed document
       * still rejects, because those are worth retrying and worth saying out
       * loud.
       */
      try {
        const snapshot = await getDocs(collection(db, paths.attendanceCollection(eventId)));
        byEvent.set(eventId, {
          present: new Set(snapshot.docs.map((d) => d.id)),
          checkedOut: new Set(
            snapshot.docs.filter((d) => d.get('checkedOutAt') != null).map((d) => d.id),
          ),
        });
      } catch (cause) {
        if (!isPermissionDenied(cause)) throw cause;
        denied.add(eventId);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(ATTENDANCE_READ_CONCURRENCY, eventIds.length) }, worker),
  );

  return { byEvent, denied };
}

/**
 * The nights one student was checked into, since `since`, as event ids.
 *
 * The cheap half of a profile's history. "Was this student here?" is a fact
 * about the student, and their own attendance documents are where it is written
 * — so a year of it is one indexed query rather than a read of every night that
 * happened. The other half, "did the gathering happen at all", is not about
 * them and comes from `skippedNights`.
 *
 * Through a callable now rather than a collection-group query from here. The
 * wildcard rule that authorised the query could not ask which gathering a
 * record belonged to — no rule at a wildcard path can — and it was granting
 * `list` over every restricted register into the bargain. The filtering
 * therefore happens on a server that can see the parent event; see
 * `getStudentAttendance`.
 *
 * `withheld` is the gathering chains the caller was not shown, and it must not
 * be dropped: a profile that quietly returns a shorter history under-reports
 * somebody's attendance to the person deciding whether to ring their family.
 *
 * Unpaged deliberately. A year of one student is at most a few hundred small
 * documents, and the profile needs all of them before it can draw anything.
 */
export async function fetchStudentAttendanceSince(
  studentId: string,
  since: Date,
): Promise<{ eventIds: Set<string>; withheld: Set<string> }> {
  const result = await getStudentAttendance({ studentId, since: since.getTime() });

  return {
    eventIds: new Set(result.data.eventIds ?? []),
    withheld: new Set(result.data.withheld ?? []),
  };
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

/**
 * Where the next page starts.
 *
 * A plain value rather than the `QueryDocumentSnapshot` this used to be,
 * because the query now runs on a server and the cursor has to survive the
 * wire. `checkedInAt` alone would not do: an import can stamp a whole register
 * with one instant, so the document path is what stops a page boundary from
 * dropping or repeating a row.
 */
export interface StudentHistoryCursor {
  checkedInAt: number;
  path: string;
}

export interface StudentHistoryPage {
  entries: StudentHistoryEntry[];
  cursor: StudentHistoryCursor | null;
  hasMore: boolean;
  /** Gathering chains left out because the reader is not on them. */
  withheld: Set<string>;
}

/**
 * A page of the nights one student was checked in to, newest first — reaching
 * as far back as the ministry has records, not as far back as the calendar the
 * app keeps loaded.
 *
 * Through `getStudentAttendance` rather than a collection-group query from
 * here. The reason is not performance: a collection-group query can only be
 * authorised by a rule at a wildcard path, and a wildcard path has no single
 * parent event, so no rule there can ask which gathering a record belongs to or
 * whether the reader is on it. The same wildcard also matched an ordinary
 * subcollection query, so the rule that made this page possible was granting
 * `list` over every restricted register besides. Both facts point one way.
 *
 * **`hasMore` is the server's answer, not a guess from the page length.** A
 * page of twenty may come back as six once the reader's own gatherings are
 * filtered out, and inferring "that was the end" from a short page would stop
 * the profile's infinite scroll at the first such page — silently, on the
 * screen whose whole job is a complete history.
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
  const result = await getStudentAttendance({ studentId, cursor, pageSize });
  const records = result.data.records ?? [];

  /*
   * The event id came from the document's own path on the server, for the
   * reason it always did: the record's `eventId` field agrees — the rules
   * require it on every write — but the path is the one that cannot have been
   * written wrong, and this is the read that would silently attribute a night
   * to the wrong gathering if it were.
   */
  const eventIds = [...new Set(records.map((record) => record.eventId))];

  const events = new Map<string, TallyEvent>();
  await Promise.all(
    eventIds.map(async (eventId) => {
      try {
        const document = await getDoc(doc(db, paths.event(eventId)));
        if (document.exists()) events.set(eventId, toEvent(document));
      } catch (cause) {
        // The event read still goes through the rules, and a chain the server
        // was willing to show should also be readable here — but a race with
        // somebody restricting it mid-scroll is possible, and a night with no
        // event still renders as a record. See `StudentHistoryEntry.event`.
        if (!isPermissionDenied(cause)) throw cause;
      }
    }),
  );

  const entries = records.map<StudentHistoryEntry>((record) => ({
    record: fromCallableAttendance(record.id, record.eventId, record.data),
    event: events.get(record.eventId) ?? null,
  }));

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

  return {
    entries,
    cursor: result.data.cursor ?? null,
    hasMore: result.data.hasMore === true,
    withheld: new Set(result.data.withheld ?? []),
  };
}

/**
 * One attendance record as it comes back over the wire.
 *
 * `toAttendance` takes a `DocumentSnapshot`, which a callable result is not.
 * The fields are the same; the timestamps arrive as milliseconds because JSON
 * has no other way to carry them.
 */
function fromCallableAttendance(
  id: string,
  eventId: string,
  data: Record<string, unknown>,
): AttendanceRecord {
  const millis = (value: unknown): Date | null =>
    typeof value === 'number' ? new Date(value) : null;
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  const method = data.method;

  return {
    id,
    studentId: str(data.studentId) || id,
    eventId: str(data.eventId) || eventId,
    seriesId: typeof data.seriesId === 'string' ? data.seriesId : null,
    checkedInAt: millis(data.checkedInAt) ?? new Date(0),
    checkedInBy: str(data.checkedInBy),
    method:
      method === 'search' ||
      method === 'quick-add' ||
      method === 'manual' ||
      method === 'import' ||
      method === 'kiosk'
        ? method
        : 'tap',
    isFirstEver: data.isFirstEver === true,
    checkedOutAt: millis(data.checkedOutAt),
    checkedOutBy: typeof data.checkedOutBy === 'string' ? data.checkedOutBy : null,
  };
}
