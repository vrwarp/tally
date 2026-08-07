/**
 * The same human, on the roster through both backends.
 *
 * A church that runs Planning Center and Attendees side by side holds the
 * same people in both, and keeps the bridge on the Planning Center side: an
 * `attendees_uuid` custom field naming each person's Attendees UUID. This
 * module is what Tally does with that pointer once memberships are involved —
 * finding the pairs where one child has a membership document through each
 * backend, and folding them into one.
 *
 * The fold follows the shape every merge in Tally already has (see
 * `graftMergedStudent`, `migrateStudentMemberships`): the Planning Center
 * side keeps the row — it is the side that holds the pointer, and the side
 * with a product to link out to — and the Attendees-side document goes
 * inactive with a `mergedIntoStudentId` pointer, keeping every attendance
 * record it anchors resolvable. Idempotent: an inactive document leaves the
 * scan, so a pair collapses exactly once.
 */
import { PATHS, type FirestoreLike } from '../firestore.js';
import { studentDocFor, type RosterScan } from './scan.js';

/** One human with a membership document on each side. */
export interface AliasPair {
  /** The document that keeps the row — the Planning Center side. */
  keeperDoc: string;
  /** The document that folds — the Attendees side. */
  foldDoc: string;
  pcoPersonId: string;
  a32PersonId: string;
}

/**
 * The pairs the roster currently holds, given the aliases a Planning Center
 * read carried. Pure: the scan says who has membership documents, the aliases
 * say which of them are the same person.
 */
export function a32AliasPairs(
  scan: RosterScan,
  aliases: Readonly<Record<string, string>> | undefined,
): AliasPair[] {
  const pairs: AliasPair[] = [];
  for (const [pcoPersonId, a32PersonId] of Object.entries(aliases ?? {})) {
    const keeperDoc = studentDocFor(scan, 'pco', pcoPersonId);
    const foldDoc = studentDocFor(scan, 'a32', a32PersonId);
    if (keeperDoc && foldDoc && keeperDoc !== foldDoc) {
      pairs.push({ keeperDoc, foldDoc, pcoPersonId, a32PersonId });
    }
  }
  return pairs;
}

/**
 * Makes one pair one student. The keeper stays active (and thaws — a fold is
 * a resolution, and the freeze flag is what the check-in rules read); the
 * folded document leaves the roster with a pointer back, exactly as a merged
 * Planning Center person's old document does.
 */
export async function collapseAliasPair(db: FirestoreLike, pair: AliasPair): Promise<void> {
  await db.doc(`${PATHS.students}/${pair.keeperDoc}`).set(
    { status: 'active', upstreamRecordMissing: false, mergedFromStudentId: pair.foldDoc },
    { merge: true },
  );
  await db.doc(`${PATHS.students}/${pair.foldDoc}`).set(
    { status: 'inactive', mergedIntoStudentId: pair.keeperDoc },
    { merge: true },
  );
}

/**
 * Attendees UUID -> the student document already answering for that human
 * through Planning Center. What a history import checks before creating a
 * second membership: an attendee the roster already holds files their
 * attendance under the membership the church already has.
 */
export function existingStudentIdByA32Uuid(
  scan: RosterScan,
  aliases: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const byUuid: Record<string, string> = {};
  for (const [pcoPersonId, a32PersonId] of Object.entries(aliases ?? {})) {
    const doc = studentDocFor(scan, 'pco', pcoPersonId);
    if (doc) byUuid[a32PersonId] = doc;
  }
  return byUuid;
}
