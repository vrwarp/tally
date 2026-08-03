/**
 * Moving a student's membership onto a different backend person.
 *
 * Two shapes of student, two mechanisms — the same split
 * `pco/studentPerson.ts`'s merge-grafting established, generalised over the
 * backend. A visitor document (Tally-generated id) holds its link in fields,
 * so it is updated in place and keeps its id — every attendance record
 * already points at it. A prefixed document *is named after* the person, so
 * the membership moves to the new person's document — created active if
 * Tally has never held one, reactivated if it has — and the old document
 * goes inactive with a pointer, keeping every attendance record it anchors
 * resolvable.
 *
 * `pcoRecordMissing: false` rides along on the destination: a migration is
 * exactly how a frozen student thaws, and the flag is what the check-in
 * rules read.
 */
import { PATHS, type FirestoreLike } from '../firestore.js';
import { parseStudentId, studentIdFor, type BackendId } from '../generated/backendIds.js';

export interface MigrationLinkage {
  backendId: BackendId;
  personId: string;
}

function linkageFields(linkage: MigrationLinkage): Record<string, unknown> {
  return {
    upstreamBackend: linkage.backendId,
    upstreamPersonId: linkage.personId,
    // The legacy field keeps meaning Planning Center and only Planning Center.
    ...(linkage.backendId === 'pco' ? { pcoPersonId: linkage.personId } : {}),
  };
}

export async function migrateStudentMemberships(
  db: FirestoreLike,
  fromStudentId: string,
  linkage: MigrationLinkage,
): Promise<{ studentId: string }> {
  const parsed = parseStudentId(fromStudentId);
  if (!parsed) {
    await db.doc(`${PATHS.students}/${fromStudentId}`).set(
      { ...linkageFields(linkage), pcoRecordMissing: false },
      { merge: true },
    );
    return { studentId: fromStudentId };
  }

  const keeperStudentId = studentIdFor(linkage.backendId, linkage.personId);
  if (keeperStudentId === fromStudentId) return { studentId: fromStudentId };

  const oldRef = db.doc(`${PATHS.students}/${fromStudentId}`);
  const keeperRef = db.doc(`${PATHS.students}/${keeperStudentId}`);
  const [oldSnapshot, keeperSnapshot] = [await oldRef.get(), await keeperRef.get()];
  const old = oldSnapshot.exists ? (oldSnapshot.data() ?? {}) : {};

  await keeperRef.set(
    {
      ...linkageFields(linkage),
      status: 'active',
      pcoRecordMissing: false,
      mergedFromStudentId: fromStudentId,
      ...(keeperSnapshot.exists
        ? {}
        : {
            ...(old.addedToRosterAt !== undefined ? { addedToRosterAt: old.addedToRosterAt } : {}),
            ...(old.createdAt !== undefined ? { createdAt: old.createdAt } : {}),
          }),
    },
    { merge: true },
  );
  await oldRef.set({ status: 'inactive', mergedIntoStudentId: keeperStudentId }, { merge: true });
  return { studentId: keeperStudentId };
}
