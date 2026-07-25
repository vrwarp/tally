/**
 * Student roster reads and writes.
 */
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toStudent } from '@/services/converters';
import {
  buildSearchName,
  computeProfileComplete,
  type Grade,
  type Student,
  type StudentStatus,
} from '@/types';

export interface StudentDraft {
  firstName: string;
  lastName: string;
  grade: Grade;
  gender?: Student['gender'];
  smallGroupId?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentEmail?: string | null;
  allergies?: string | null;
  notes?: string | null;
  status?: StudentStatus;
}

/**
 * Live roster stream. Ordered by name so the "everyone else" block below the
 * predictive section is alphabetical and scannable.
 *
 * Includes inactive students; callers filter. Keeping one shared listener for
 * the whole collection means the check-in screen, the dashboard and the admin
 * roster all read from the same cached snapshot instead of opening three
 * separate streams (Footprints is a few hundred students, not a few million).
 */
export function subscribeStudents(
  onChange: (students: Student[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const q = query(collection(db, paths.students()), orderBy('lastName'), orderBy('firstName'));
  return onSnapshot(
    q,
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
    parentName: draft.parentName?.trim() || null,
    parentPhone: draft.parentPhone?.trim() || null,
    parentEmail: draft.parentEmail?.trim().toLowerCase() || null,
    allergies: draft.allergies?.trim() || null,
    notes: draft.notes?.trim() || null,
    status: draft.status ?? 'active',
    isVisitor: false,
    profileComplete: computeProfileComplete({
      parentPhone: draft.parentPhone,
      parentEmail: draft.parentEmail,
    }),
    searchName: buildSearchName(firstName, lastName),
    firstAttendedAt: null,
    lastAttendedAt: null,

    // Created in Tally, not pulled from Planning Center. The sync function
    // picks `pcoPushPending` up and creates the matching Person there.
    pcoPersonId: null,
    pcoUpdatedAt: null,
    pcoSyncedAt: null,
    pcoPushPending: true,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
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

export async function updateStudent(
  studentId: string,
  patch: Partial<StudentDraft>,
  uid: string,
  current?: Pick<Student, 'firstName' | 'lastName' | 'parentPhone' | 'parentEmail' | 'isVisitor'>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp(), updatedBy: uid };

  if (patch.firstName !== undefined) payload.firstName = patch.firstName.trim();
  if (patch.lastName !== undefined) payload.lastName = patch.lastName.trim();
  if (patch.grade !== undefined) payload.grade = patch.grade;
  if (patch.gender !== undefined) payload.gender = patch.gender;
  if (patch.smallGroupId !== undefined) payload.smallGroupId = patch.smallGroupId || null;
  if (patch.parentName !== undefined) payload.parentName = patch.parentName?.trim() || null;
  if (patch.parentPhone !== undefined) payload.parentPhone = patch.parentPhone?.trim() || null;
  if (patch.parentEmail !== undefined) {
    payload.parentEmail = patch.parentEmail?.trim().toLowerCase() || null;
  }
  if (patch.allergies !== undefined) payload.allergies = patch.allergies?.trim() || null;
  if (patch.notes !== undefined) payload.notes = patch.notes?.trim() || null;
  if (patch.status !== undefined) payload.status = patch.status;

  // `searchName` and `profileComplete` are denormalised, so they must be
  // recomputed from the merged result whenever their inputs move.
  const firstName = (payload.firstName as string | undefined) ?? current?.firstName;
  const lastName = (payload.lastName as string | undefined) ?? current?.lastName;
  if (firstName !== undefined && lastName !== undefined) {
    payload.searchName = buildSearchName(firstName, lastName);
  }

  const parentPhone =
    patch.parentPhone !== undefined ? (payload.parentPhone as string | null) : current?.parentPhone;
  const parentEmail =
    patch.parentEmail !== undefined ? (payload.parentEmail as string | null) : current?.parentEmail;
  if (parentPhone !== undefined || parentEmail !== undefined) {
    const complete = computeProfileComplete({ parentPhone, parentEmail });
    payload.profileComplete = complete;
    // Filling in the missing contact is exactly what clears the visitor badge
    // in the core-team handoff (Journey 3).
    if (complete && current?.isVisitor) payload.isVisitor = false;
  }

  await updateDoc(doc(db, paths.student(studentId)), payload);
}

export async function setStudentStatus(
  studentId: string,
  status: StudentStatus,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, paths.student(studentId)), {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}
