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
import { personIdFromStudentId } from './roster.js';

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
