/**
 * Two roster rows that turn out to be one child.
 *
 * The lobby kiosk lets a family register themselves without anybody checking
 * whether the church already has them — deliberately, because the alternative
 * was a public screen refusing a parent and pointing them at somebody else's
 * Jacob Smith (see `kiosk/registration.ts`). The cost of that choice is
 * duplicates, and this is where they are paid off: on the Review screen, by a
 * person who can see both rows.
 *
 * ## What a merge is, and is not
 *
 * It is a decision about *Tally's* roster, and only that. The loser goes
 * inactive with a pointer at the keeper; the keeper gains a pointer back. That
 * is the same vocabulary `pco/studentPerson.ts` and `backends/aliases.ts`
 * already use when a backend tells us two of *its* people were merged, and it
 * is chosen for the same reason: every attendance record names a student
 * document, so a document that stops existing takes a head count with it. There
 * are no deletes here and there will not be.
 *
 * It is *not* a merge in the church's database. If the duplicate had already
 * been pushed, that upstream person stays — Planning Center merges are done in
 * Planning Center, and Attendees has no merges at all. What Tally can do is
 * stop showing the family twice and keep the two histories together, which is
 * what a leader was actually asking for.
 *
 * ## Both directions
 *
 * `unmergeStudents` exists because this is a screen built for human judgement
 * and human judgement is wrong sometimes. Undoing is clearing two pointers and
 * reactivating a document — cheap enough that not offering it would be a choice
 * rather than a constraint.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { PATHS, SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import { linkageOfData } from './scan.js';
import { migrateStudentMemberships } from './studentMigration.js';
import { parseStudentId } from '../generated/backendIds.js';

export interface MergeStudentsResult {
  status: 'merged' | 'refused';
  keeperId: string;
  foldId: string;
  message: string;
}

function refuse(keeperId: string, foldId: string, message: string): MergeStudentsResult {
  return { status: 'refused', keeperId, foldId, message };
}

/** Everything the keeper has absorbed, old single-valued field included. */
function mergedFromOf(data: Record<string, unknown>): string[] {
  const list = Array.isArray(data.mergedFromStudentIds)
    ? data.mergedFromStudentIds.filter((id): id is string => typeof id === 'string')
    : [];
  const legacy = typeof data.mergedFromStudentId === 'string' ? [data.mergedFromStudentId] : [];
  return [...new Set([...list, ...legacy])];
}

/**
 * Folds one student into another.
 *
 * Refusals are the interesting part, and all four are about not losing
 * something that cannot be got back:
 *
 *   - a keeper that has itself been merged away would make a chain nothing
 *     follows;
 *   - a fold that the backend holds and a keeper it does not would put the
 *     church's own record on the inactive side of the pointer;
 *   - two prefixed documents are two *backend* people, and Tally saying they
 *     are one child does not make the backend agree — that merge belongs
 *     upstream, where it can actually be performed;
 *   - and a student cannot be folded into themselves.
 */
export async function mergeStudents(options: {
  db: FirestoreLike;
  keeperId: string;
  foldId: string;
  uid: string;
  now?: Date;
  logger?: FunctionLogger;
}): Promise<MergeStudentsResult> {
  const { db, keeperId, foldId, uid } = options;
  const now = options.now ?? new Date();
  const logger = options.logger ?? SILENT_LOGGER;

  if (keeperId === foldId) {
    return refuse(keeperId, foldId, 'That is the same student.');
  }

  const keeperRef = db.doc(`${PATHS.students}/${keeperId}`);
  const foldRef = db.doc(`${PATHS.students}/${foldId}`);
  const [keeperSnapshot, foldSnapshot] = [await keeperRef.get(), await foldRef.get()];
  if (!keeperSnapshot.exists) return refuse(keeperId, foldId, 'The student to keep is not on the roster.');
  if (!foldSnapshot.exists) return refuse(keeperId, foldId, 'The duplicate is not on the roster.');

  const keeper = keeperSnapshot.data() ?? {};
  const fold = foldSnapshot.data() ?? {};

  if (typeof keeper.mergedIntoStudentId === 'string') {
    return refuse(
      keeperId,
      foldId,
      'The student to keep has already been merged into somebody else. Merge into that one instead.',
    );
  }
  if (typeof fold.mergedIntoStudentId === 'string') {
    return refuse(keeperId, foldId, 'That duplicate has already been merged.');
  }

  const keeperLinkage = parseStudentId(keeperId) ?? linkageOfData(keeper);
  const foldLinkage = parseStudentId(foldId) ?? linkageOfData(fold);

  if (parseStudentId(keeperId) && parseStudentId(foldId)) {
    return refuse(
      keeperId,
      foldId,
      'Both of these are people in the church database. Merge them there — Tally follows that merge on the next read.',
    );
  }
  if (foldLinkage && !keeperLinkage) {
    return refuse(
      keeperId,
      foldId,
      'The duplicate is the one the church database knows. Keep that one and merge the other into it.',
    );
  }

  /*
   * A duplicate that never reached a backend can be pointed at the keeper's
   * person on the way out, so anything resolving the dead row through a backend
   * lands on the right human rather than on nothing. Only when the fold has no
   * linkage of its own: overwriting one would lose the pointer to a *second*
   * upstream person, which is precisely the thing somebody will need when they
   * go and merge these two in Planning Center.
   */
  if (keeperLinkage && !foldLinkage && !parseStudentId(foldId)) {
    await migrateStudentMemberships(db, foldId, keeperLinkage);
  }

  const at = Timestamp.fromDate(now);
  await foldRef.set(
    {
      status: 'inactive',
      // A merged-away duplicate is not waiting for anything. Both flags come
      // off so no sweep and no reviewer picks the row up again.
      pendingReview: false,
      pcoPushPending: false,
      mergedIntoStudentId: keeperId,
      mergedAt: at,
      mergedBy: uid,
      updatedAt: at,
      updatedBy: uid,
    },
    { merge: true },
  );

  await keeperRef.set(
    {
      /*
       * A list, because a keeper can absorb more than one duplicate and the
       * single-valued `mergedFromStudentId` silently overwrote the first. It is
       * still written for the readers that predate the list.
       */
      mergedFromStudentIds: [...new Set([...mergedFromOf(keeper), foldId])],
      mergedFromStudentId: foldId,
      status: 'active',
      mergedAt: at,
      mergedBy: uid,
      updatedAt: at,
      updatedBy: uid,
    },
    { merge: true },
  );

  logger.info('Merged two roster rows', { keeperId, foldId });
  return {
    status: 'merged',
    keeperId,
    foldId,
    message: 'Merged. Their check-in history now shows on the student you kept.',
  };
}

/** Puts a merged-away student back on the roster and forgets the pointers. */
export async function unmergeStudents(options: {
  db: FirestoreLike;
  foldId: string;
  uid: string;
  now?: Date;
  logger?: FunctionLogger;
}): Promise<MergeStudentsResult> {
  const { db, foldId, uid } = options;
  const now = options.now ?? new Date();
  const logger = options.logger ?? SILENT_LOGGER;

  const foldRef = db.doc(`${PATHS.students}/${foldId}`);
  const foldSnapshot = await foldRef.get();
  if (!foldSnapshot.exists) return refuse('', foldId, 'That student is not on the roster.');
  const fold = foldSnapshot.data() ?? {};
  const keeperId = typeof fold.mergedIntoStudentId === 'string' ? fold.mergedIntoStudentId : null;
  if (!keeperId) return refuse('', foldId, 'That student was not merged into anybody.');

  const at = Timestamp.fromDate(now);
  const keeperRef = db.doc(`${PATHS.students}/${keeperId}`);
  const keeperSnapshot = await keeperRef.get();
  if (keeperSnapshot.exists) {
    const remaining = mergedFromOf(keeperSnapshot.data() ?? {}).filter((id) => id !== foldId);
    await keeperRef.set(
      {
        mergedFromStudentIds: remaining,
        // Kept in step with the list rather than left pointing at a row that is
        // no longer folded in.
        mergedFromStudentId: remaining[remaining.length - 1] ?? null,
        updatedAt: at,
        updatedBy: uid,
      },
      { merge: true },
    );
  }

  await foldRef.set(
    { status: 'active', mergedIntoStudentId: null, updatedAt: at, updatedBy: uid },
    { merge: true },
  );

  logger.info('Un-merged a roster row', { keeperId, foldId });
  return {
    status: 'merged',
    keeperId,
    foldId,
    message: 'Un-merged. Both students are on the roster again.',
  };
}
