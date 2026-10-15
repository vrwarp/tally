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
 * ## What a merge is
 *
 * A decision about *Tally's* roster. The duplicate goes inactive with a
 * pointer at the keeper; the keeper gains a pointer back. That is the same
 * vocabulary `pco/studentPerson.ts` and `backends/aliases.ts` already use when
 * a backend tells us two of *its* people were merged, and it is chosen for the
 * same reason: every attendance record names a student document, so a document
 * that stops existing takes a head count with it. There are no deletes here
 * and there will not be.
 *
 * ## And upstream, when the backend can
 *
 * Two rows one backend holds are two of *its* people, and Tally saying they
 * are one child does not make the backend agree. Attendees can be asked: its
 * own merge moves everything the duplicate held onto the primary and leaves a
 * forwarding address, so when both rows are Attendees people the fold asks
 * for that merge first and folds only once it was made. Planning Center has no
 * such call, so two of its people are still refused here and merged in
 * Planning Center, where Tally follows the merge on the next read. A duplicate
 * that was never pushed keeps the old shape: Tally stops showing the family
 * twice and keeps the two histories together.
 *
 * ## Both directions
 *
 * `unmergeStudents` exists because this is a screen built for human judgement
 * and human judgement is wrong sometimes. Undoing is clearing two pointers,
 * taking back whatever the merge grafted onto the duplicate, and reactivating a
 * document — and asking the backend to undo its merge first, when this one
 * made it.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { PATHS, SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import { bumpPulse } from '../kiosk/pulse.js';
import { BACKEND_DISPLAY_NAMES, type BackendRegistry } from './registry.js';
import { linkageOfData } from './scan.js';
import { migrateStudentMemberships } from './studentMigration.js';
import { isBackendId, parseStudentId, type BackendId } from '../generated/backendIds.js';

export interface MergeStudentsResult {
  status: 'merged' | 'refused';
  keeperId: string;
  foldId: string;
  message: string;
}

function refuse(keeperId: string, foldId: string, message: string): MergeStudentsResult {
  return { status: 'refused', keeperId, foldId, message };
}

/** Written on the fold when the backend merged the two people as well, so an un-merge can undo that first. */
interface UpstreamMerge {
  backendId: BackendId;
  duplicatePersonId: string;
  primaryPersonId: string;
}

function upstreamMergeOf(data: Record<string, unknown>): UpstreamMerge | null {
  const marker = data.upstreamMerge;
  if (typeof marker !== 'object' || marker === null) return null;
  const { backendId, duplicatePersonId, primaryPersonId } = marker as Record<string, unknown>;
  if (!isBackendId(backendId)) return null;
  if (typeof duplicatePersonId !== 'string' || typeof primaryPersonId !== 'string') return null;
  return { backendId, duplicatePersonId, primaryPersonId };
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
 *     are one child does not make the backend agree — so a backend that can
 *     merge them is asked to, and one that cannot has to do it itself;
 *   - and a student cannot be folded into themselves.
 */
export async function mergeStudents(options: {
  db: FirestoreLike;
  keeperId: string;
  foldId: string;
  uid: string;
  now?: Date;
  logger?: FunctionLogger;
  /** The connected backends; without it, two backend people are refused. */
  registry?: BackendRegistry;
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

  if (foldLinkage && !keeperLinkage) {
    return refuse(
      keeperId,
      foldId,
      'The duplicate is the one the church database knows. Keep that one and merge the other into it.',
    );
  }

  /*
   * Two people of one backend. A backend that can merge them is asked first,
   * and the fold happens only once it has; one that cannot is where the merge
   * has to be made, so two of its own records are refused here, as before.
   */
  let upstreamMerge: UpstreamMerge | null = null;
  if (keeperLinkage && foldLinkage) {
    const backend =
      keeperLinkage.backendId === foldLinkage.backendId
        ? (options.registry?.get(keeperLinkage.backendId) ?? null)
        : null;
    if (backend?.mergePeople) {
      const result = await backend.mergePeople({
        duplicatePersonId: foldLinkage.personId,
        primaryPersonId: keeperLinkage.personId,
        logger,
      });
      if (result.status === 'refused') {
        return refuse(keeperId, foldId, `${backend.displayName} would not merge them: ${result.reason}`);
      }
      upstreamMerge = {
        backendId: keeperLinkage.backendId,
        duplicatePersonId: foldLinkage.personId,
        primaryPersonId: keeperLinkage.personId,
      };
      logger.info('Merged two people upstream', { ...upstreamMerge });
    } else if (parseStudentId(keeperId) && parseStudentId(foldId)) {
      return refuse(
        keeperId,
        foldId,
        'Both of these are people in the church database. Merge them there — Tally follows that merge on the next read.',
      );
    }
  }

  /*
   * A duplicate that never reached a backend can be pointed at the keeper's
   * person on the way out, so anything resolving the dead row through a backend
   * lands on the right human rather than on nothing. Only when the fold has no
   * linkage of its own: overwriting one would lose the pointer to a *second*
   * upstream person, which is precisely the thing somebody will need when they
   * go and merge these two in Planning Center.
   */
  const graft = keeperLinkage && !foldLinkage && !parseStudentId(foldId) ? keeperLinkage : null;
  if (graft) {
    await migrateStudentMemberships(db, foldId, graft);
  }

  const at = Timestamp.fromDate(now);
  await foldRef.set(
    {
      status: 'inactive',
      // A merged-away duplicate is not waiting for anything. Both flags come
      // off so no sweep and no reviewer picks the row up again.
      pendingReview: false,
      upstreamPushPending: false,
      /*
       * What the graft and the two flags above overwrote, so an un-merge can
       * put the row back rather than leave an active visitor pointing at the
       * keeper's person. Only a grafted row needs it: a duplicate with its own
       * linkage keeps that linkage through both directions.
       */
      ...(graft
        ? {
            mergeGraft: {
              pendingReview: fold.pendingReview === true,
              upstreamPushPending: fold.upstreamPushPending === true,
            },
          }
        : {}),
      ...(upstreamMerge ? { upstreamMerge } : {}),
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

  // The folded row must leave the lobby search within a poll: a kiosk still
  // offering the duplicate would write attendance against a student that no
  // longer answers for anybody.
  await bumpPulse(db, ['roster'], now, { logger });

  logger.info('Merged two roster rows', { keeperId, foldId });
  return {
    status: 'merged',
    keeperId,
    foldId,
    message: upstreamMerge
      ? `Merged, in ${BACKEND_DISPLAY_NAMES[upstreamMerge.backendId]} too. Their check-in history now shows on the student you kept.`
      : 'Merged. Their check-in history now shows on the student you kept.',
  };
}

/** Puts a merged-away student back on the roster and forgets the pointers. */
export async function unmergeStudents(options: {
  db: FirestoreLike;
  foldId: string;
  uid: string;
  now?: Date;
  logger?: FunctionLogger;
  /** The connected backends, for a merge that was made upstream as well. */
  registry?: BackendRegistry;
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

  // A merge this fold also made upstream is undone there first; the two
  // records must not disagree about whether they are one.
  const upstream = upstreamMergeOf(fold);
  if (upstream) {
    const name = BACKEND_DISPLAY_NAMES[upstream.backendId];
    const backend = options.registry?.get(upstream.backendId) ?? null;
    if (!backend?.unmergePeople) {
      return refuse(
        keeperId,
        foldId,
        `The merge was also made in ${name}, which is not connected now. Connect it and try again, or undo the merge there first.`,
      );
    }
    const result = await backend.unmergePeople({ duplicatePersonId: upstream.duplicatePersonId, logger });
    if (result.status === 'refused') {
      return refuse(keeperId, foldId, `${name} would not undo the merge: ${result.reason}`);
    }
    logger.info('Un-merged two people upstream', { ...upstream });
  }

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

  /*
   * A merge may have pointed a never-pushed duplicate at the keeper's person
   * (see `mergeStudents`). Left on a row that is active again, that pointer
   * makes the duplicate a *linked* student: the roster overlays the keeper's
   * name on it, the sweep skips it, and a full write-back push rewrites the
   * keeper's upstream record with whatever was typed at the door. Null is the
   * documented "not held" value for all three fields, and the flags go back to
   * what they were before the merge turned them off.
   */
  const graft =
    typeof fold.mergeGraft === 'object' && fold.mergeGraft !== null
      ? (fold.mergeGraft as Record<string, unknown>)
      : null;
  await foldRef.set(
    {
      status: 'active',
      mergedIntoStudentId: null,
      ...(upstream ? { upstreamMerge: null } : {}),
      ...(graft
        ? {
            pcoPersonId: null,
            upstreamBackend: null,
            upstreamPersonId: null,
            pendingReview: graft.pendingReview === true,
            upstreamPushPending: graft.upstreamPushPending === true,
            mergeGraft: null,
          }
        : {}),
      updatedAt: at,
      updatedBy: uid,
    },
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
