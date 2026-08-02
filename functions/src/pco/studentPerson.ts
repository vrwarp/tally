/**
 * Which Planning Center person a Tally student id refers to.
 *
 * Every write path asks this, and every one of them asks it the same way: from
 * Tally's own record, never from the caller. The id decides whose personal
 * record in the church's database is about to be changed, and a browser may not
 * be the one choosing that — `pco_9999` posted by hand would otherwise be a
 * write against any person in the church.
 *
 * `active` is part of the answer because being on the roster is what makes a
 * student one of Tally's to write about at all. Somebody taken off it keeps
 * their document, so their attendance history still resolves, but no write path
 * should act on their behalf again.
 */
import { PATHS, type FirestoreLike } from '../firestore.js';
import type { PcoClient } from './client.js';
import { followPersonLink, isPersonGoneError } from './personLink.js';
import { personIdFromStudentId, pcoStudentId } from './roster.js';

export interface StudentPerson {
  /** Null for a quick-added visitor who has never reached Planning Center. */
  personId: string | null;
  /** False when no `students/{id}` document exists at all. */
  exists: boolean;
  /** False once somebody has taken them off the roster. */
  active: boolean;
}

export async function resolveStudentPerson(
  db: FirestoreLike,
  studentId: string,
): Promise<StudentPerson> {
  const snapshot = await db.doc(`${PATHS.students}/${studentId}`).get();
  if (!snapshot.exists) {
    // A roster student always has a document; there is nothing to write against
    // an id nobody put on the roster.
    return { personId: null, exists: false, active: false };
  }

  const data = snapshot.data() ?? {};
  const stored = typeof data.pcoPersonId === 'string' && data.pcoPersonId ? data.pcoPersonId : null;
  return {
    personId: personIdFromStudentId(studentId) ?? stored,
    exists: true,
    active: data.status !== 'inactive',
  };
}

/* -------------------------------------------------------------------------- */
/* When the person moved: merges and deletions upstream                        */
/* -------------------------------------------------------------------------- */

/**
 * Repoints a student at the person their record was merged into.
 *
 * Two shapes of student, two mechanisms. A visitor document (`tally-…`) holds
 * its link in `pcoPersonId`, so it is updated in place and keeps its id. A
 * linked document (`pco_…`) *is named after* the person, so the membership
 * moves to a `pco_<keeper>` document — created active if Tally has never held
 * one, reactivated if it has — and the old document goes inactive with a
 * pointer, keeping every attendance record it anchors resolvable.
 *
 * Returns the student id the caller should carry on with.
 */
export async function graftMergedStudent(
  db: FirestoreLike,
  studentId: string,
  keeperPersonId: string,
): Promise<{ studentId: string }> {
  const derived = personIdFromStudentId(studentId);
  if (!derived) {
    // `pcoRecordMissing: false` alongside the new link: a graft is exactly how
    // a frozen student thaws, and the flag is what the check-in rules read.
    await db.doc(`${PATHS.students}/${studentId}`).set(
      { pcoPersonId: keeperPersonId, pcoRecordMissing: false }, { merge: true });
    return { studentId };
  }

  const keeperStudentId = pcoStudentId(keeperPersonId);
  if (keeperStudentId === studentId) return { studentId };

  const oldRef = db.doc(`${PATHS.students}/${studentId}`);
  const keeperRef = db.doc(`${PATHS.students}/${keeperStudentId}`);
  const [oldSnapshot, keeperSnapshot] = [await oldRef.get(), await keeperRef.get()];
  const old = oldSnapshot.exists ? (oldSnapshot.data() ?? {}) : {};

  await keeperRef.set(
    {
      pcoPersonId: keeperPersonId,
      status: 'active',
      pcoRecordMissing: false,
      mergedFromStudentId: studentId,
      ...(keeperSnapshot.exists ? {} : {
        ...(old.addedToRosterAt !== undefined ? { addedToRosterAt: old.addedToRosterAt } : {}),
        ...(old.createdAt !== undefined ? { createdAt: old.createdAt } : {}),
      }),
    },
    { merge: true },
  );
  await oldRef.set(
    { status: 'inactive', mergedIntoStudentId: keeperStudentId },
    { merge: true },
  );
  return { studentId: keeperStudentId };
}

export type MergedRead<T> =
  | { outcome: 'ok'; value: T; personId: string; grafted: boolean }
  | { outcome: 'gone' };

/**
 * Runs a person read, following the merge trail and repointing the student if
 * the person has moved. The happy path stays one request; all the ceremony is
 * on the path where the mirror just said "gone".
 */
export async function readThroughMerges<T>(
  deps: { db: FirestoreLike; client: PcoClient },
  studentId: string,
  personId: string,
  read: (personId: string) => Promise<T>,
): Promise<MergedRead<T>> {
  try {
    return { outcome: 'ok', value: await read(personId), personId, grafted: false };
  } catch (error) {
    if (!isPersonGoneError(error)) throw error;
    const link = await followPersonLink(deps.client, personId, error);
    if (link.outcome === 'gone') return { outcome: 'gone' };
    await graftMergedStudent(deps.db, studentId, link.personId);
    return { outcome: 'ok', value: await read(link.personId), personId: link.personId, grafted: true };
  }
}
