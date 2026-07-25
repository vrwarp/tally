/**
 * Student documents — what Tally owns about a person.
 *
 * The `students` collection is deliberately *not* a roster. The roster comes
 * from Planning Center, on demand, through `@/services/roster`. What lives here
 * is only what Planning Center has no opinion about:
 *
 *   - the small group a counselor assigned
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
  gender?: Student['gender'];
  smallGroupId?: string | null;
  notes?: string | null;
  status?: StudentStatus;
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
    gender: draft.gender ?? 'unspecified',
    smallGroupId: draft.smallGroupId ?? null,
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
 * until the moment somebody annotates them: assigning a small group to a
 * Planning Center student creates `students/pco_123` on the spot.
 */
export async function updateStudent(
  studentId: string,
  patch: Partial<StudentDraft>,
  uid: string,
  current?: Pick<Student, 'firstName' | 'lastName' | 'grade'>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp(), updatedBy: uid };

  if (patch.firstName !== undefined) payload.firstName = patch.firstName.trim();
  if (patch.lastName !== undefined) payload.lastName = patch.lastName.trim();
  if (patch.grade !== undefined) payload.grade = patch.grade;
  if (patch.gender !== undefined) payload.gender = patch.gender;
  if (patch.smallGroupId !== undefined) payload.smallGroupId = patch.smallGroupId || null;
  if (patch.notes !== undefined) payload.notes = patch.notes?.trim() || null;
  if (patch.status !== undefined) payload.status = patch.status;

  // A document created purely to hold an annotation still needs enough identity
  // to be readable on its own — a bare `{ smallGroupId }` in Firestore is not
  // debuggable, and the rules check the name fields.
  const firstName = (payload.firstName as string | undefined) ?? current?.firstName;
  const lastName = (payload.lastName as string | undefined) ?? current?.lastName;
  if (firstName !== undefined && lastName !== undefined) {
    payload.firstName ??= firstName;
    payload.lastName ??= lastName;
    payload.searchName = buildSearchName(firstName, lastName);
  }
  if (payload.grade === undefined && current?.grade !== undefined) payload.grade = current.grade;

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
  current?: Pick<Student, 'firstName' | 'lastName' | 'grade'>,
): Promise<void> {
  await updateStudent(studentId, { status }, uid, current);
}
