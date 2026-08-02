/**
 * Student documents — what Tally owns about a person.
 *
 * The `students` collection is deliberately *not* a roster. The roster comes
 * from Planning Center, on demand, through `@/services/roster`. What lives here
 * is only what Planning Center has no opinion about:
 *
 *   - a note somebody typed
 *   - when this student first and last turned up
 *   - the whole record for a quick-added visitor, until the push lands
 *
 * Most students never get a document. One is written the first time Tally has
 * something of its own to record, which for a typical student is the first time
 * they are checked in.
 *
 * Parent contact and allergies are *not* here, on purpose — see the note in
 * src/types/index.ts. They live in Planning Center and are read one person at a
 * time by the screens that show them.
 */
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toStudent } from '@/services/converters';
import { buildSearchName, type Grade, type Student, type StudentStatus } from '@/types';

export interface StudentDraft {
  firstName: string;
  lastName: string;
  grade: Grade;
  notes?: string | null;
  status?: StudentStatus;
  /**
   * Whether this student is still new.
   *
   * Writable because until now nothing ever cleared it. It is set once, by the
   * quick-add at a door, and read for the rest of a student's life by the
   * dashboard's new-visitor list — so a student added in September was still
   * being introduced as a visitor in March, and the badge came to mean "was new
   * at some point". The roster's visitor badge is where somebody says otherwise.
   */
  isVisitor?: boolean;
}

/**
 * Live stream of Tally's own student documents.
 *
 * Not ordered in the query any more: this collection is sparse and unordered
 * relative to the roster it annotates, and `mergeRoster` sorts the result. An
 * `orderBy` here would also have required every document to carry a `lastName`,
 * which an annotation-only record has no reason to.
 */
export function subscribeStudents(
  onChange: (students: Student[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, paths.students())),
    (snapshot) => onChange(snapshot.docs.map(toStudent)),
    (error) => onError?.(error),
  );
}

/** Builds the Firestore payload for a new student. Exported for the quick-add batch. */
export function buildStudentPayload(draft: StudentDraft, uid: string) {
  const firstName = draft.firstName.trim();
  const lastName = draft.lastName.trim();

  return {
    firstName,
    lastName,
    grade: draft.grade,
    notes: draft.notes?.trim() || null,
    status: draft.status ?? 'active',
    isVisitor: false,
    searchName: buildSearchName(firstName, lastName),
    firstAttendedAt: null,
    lastAttendedAt: null,

    // Created in Tally, not read from Planning Center. `onStudentCreated` picks
    // `pcoPushPending` up and creates the matching Person there.
    pcoPersonId: null,
    pcoPushPending: true,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
  };
}

/** Allocates a client-side document id so callers can batch dependent writes. */
export function newStudentRef() {
  return doc(collection(db, paths.students()));
}

export async function createStudent(draft: StudentDraft, uid: string): Promise<string> {
  const ref = newStudentRef();
  await setDoc(ref, buildStudentPayload(draft, uid));
  return ref.id;
}

/**
 * Writes Tally's own fields for a student.
 *
 * `merge: true` rather than `update`, because most students have no document
 * until the moment somebody annotates them: typing a note against a Planning
 * Center student creates `students/pco_123` on the spot.
 */
export async function updateStudent(
  studentId: string,
  patch: Partial<StudentDraft>,
  uid: string,
  current?: Pick<Student, 'firstName' | 'lastName' | 'grade' | 'gradeOnFile'>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp(), updatedBy: uid };

  if (patch.firstName !== undefined) payload.firstName = patch.firstName.trim();
  if (patch.lastName !== undefined) payload.lastName = patch.lastName.trim();
  if (patch.grade !== undefined) payload.grade = patch.grade;
  if (patch.notes !== undefined) payload.notes = patch.notes?.trim() || null;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.isVisitor !== undefined) payload.isVisitor = patch.isVisitor;

  // A document created purely to hold an annotation still needs enough identity
  // to be readable on its own — a bare `{ notes }` in Firestore is not
  // debuggable, and the rules check the name fields.
  const firstName = (payload.firstName as string | undefined) ?? current?.firstName;
  const lastName = (payload.lastName as string | undefined) ?? current?.lastName;
  if (firstName !== undefined && lastName !== undefined) {
    payload.firstName ??= firstName;
    payload.lastName ??= lastName;
    payload.searchName = buildSearchName(firstName, lastName);
  }
  /*
   * The grade goes down with the name, for the same reason — except when there
   * is no grade to write.
   *
   * `Student.grade` is always a number, so for somebody Planning Center holds
   * no grade for it is the sync's clamp rather than a fact (see `gradeOnFile`).
   * Backfilling it stamped "6th" onto a real document, and unlike the roster
   * row it came from, a document outlives the roster: take that person off it
   * and the invented 6 is all that is left, with nothing beside it to say so.
   * The rules allow a student document with no grade at all.
   */
  if (payload.grade === undefined && current?.grade !== undefined && current.gradeOnFile !== false) {
    payload.grade = current.grade;
  }

  // Deliberately *not* writing `pcoPersonId`. For a Planning Center student the
  // document id already is the link (`pco_{personId}`), and the rules forbid a
  // client asserting the field — forging one would let a browser rebind a Tally
  // student onto an arbitrary person. Only the server writes it, when a push
  // links a visitor it just created.

  await setDoc(doc(db, paths.student(studentId)), payload, { merge: true });
}

export async function setStudentStatus(
  studentId: string,
  status: StudentStatus,
  uid: string,
  current?: Pick<Student, 'firstName' | 'lastName' | 'grade' | 'gradeOnFile'>,
): Promise<void> {
  await updateStudent(studentId, { status }, uid, current);
}
