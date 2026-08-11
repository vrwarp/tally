/**
 * Profile edits, handed to something durable instead of waited on.
 *
 * An edit to a linked student goes straight to Planning Center (or Attendees):
 * resolve the person, read them through however many merges their record has
 * been part of, patch the attributes that differ, drop the roster cache. That is
 * three to six round trips to somebody else's API, and `functions/src/pco/
 * client.ts` honours `Retry-After` by sleeping inside the request — so a church
 * whose lobby kiosk is busy can push one surname correction past thirty seconds
 * with nothing wrong. The callable's ceiling is two minutes, past which the
 * browser is told nothing useful and the write may well have landed.
 *
 * So pressing Save writes a job here and returns. A server drains it, retrying
 * the things worth retrying, and every screen showing the student shows the job.
 *
 * ## Why this is a document write and not a callable
 *
 * The security rules already gate the core team, and a document write is the one
 * operation that survives a counselor in a corridor: Firestore holds it on the
 * device and sends it when the signal comes back. A callable would need a
 * network round trip to *start* an operation whose whole point is not blocking
 * on the network.
 *
 * The rules enforce the shape on create — `state: 'queued'`, no attempts, no
 * result — so a browser can ask for work and can never claim work was done.
 * Two client transitions exist afterwards and only two: cancelling a job nothing
 * has claimed, and re-queueing one that failed.
 *
 * ## What is deliberately not here
 *
 * **Creates.** `onStudentCreated` already pushes a quick-added visitor, and a
 * create run twice is a duplicate child in the church's permanent database —
 * the failure this codebase is most careful about. This queue only ever patches
 * a person who already exists, against a fresh read, so a second run finds
 * nothing to change.
 *
 * **Adding a parent.** `addParent` asks the leader a question halfway through
 * ("which David Kim is this?"). An operation with a human in the middle is not
 * a background job.
 */
import {
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toDate, toDateOrNull } from '@/services/converters';
import {
  UPSTREAM_EDIT_FIELDS,
  type UpstreamEdit,
  type UpstreamEditFailure,
  type UpstreamEditPatch,
  type UpstreamEditState,
} from '@/types';

/**
 * The states worth streaming.
 *
 * `landed` is in the list on purpose and `cancelled` is not: a job that just
 * succeeded is what puts the green mark on the row for the minute or two that
 * answers "which of my nine are done", and the sweeper deletes it shortly
 * after. A cancelled job has nothing to say to anybody.
 */
const WATCHED: UpstreamEditState[] = [
  'queued',
  'sending',
  'waiting',
  'landed',
  'differs',
  'merged',
  'failed',
  'orphaned',
];

const STATES = new Set<string>([...WATCHED, 'cancelled']);

function state(value: unknown): UpstreamEditState {
  return typeof value === 'string' && STATES.has(value) ? (value as UpstreamEditState) : 'queued';
}

function patch(value: unknown): UpstreamEditPatch {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Field by field rather than a spread: a document written by a newer client
  // must not smuggle a key this one would then hand to a form.
  for (const field of UPSTREAM_EDIT_FIELDS) {
    if (source[field] !== undefined) out[field] = source[field];
  }
  return out as UpstreamEditPatch;
}

export function toUpstreamEdit(
  id: string,
  data: Record<string, unknown>,
  pendingOnDevice = false,
): UpstreamEdit {
  const now = new Date();
  return {
    id,
    studentId: typeof data.studentId === 'string' ? data.studentId : '',
    patch: patch(data.patch),
    baseline: patch(data.baseline),
    state: state(data.state),
    attempts: typeof data.attempts === 'number' ? data.attempts : 0,
    nextAttemptAt: toDateOrNull(data.nextAttemptAt),
    leaseUntil: toDateOrNull(data.leaseUntil),
    failure: (typeof data.failure === 'string' ? data.failure : null) as UpstreamEditFailure | null,
    message: typeof data.message === 'string' ? data.message : null,
    field: (typeof data.field === 'string' ? data.field : null) as UpstreamEdit['field'],
    observed: data.observed ? patch(data.observed) : null,
    survivorPersonId: typeof data.survivorPersonId === 'string' ? data.survivorPersonId : null,
    survivorName: typeof data.survivorName === 'string' ? data.survivorName : null,
    createdAt: toDate(data.createdAt, now),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    createdByName: typeof data.createdByName === 'string' ? data.createdByName : 'Somebody',
    updatedAt: toDate(data.updatedAt, now),
    startedAt: toDateOrNull(data.startedAt),
    settledAt: toDateOrNull(data.settledAt),
    pendingOnDevice,
  };
}

/**
 * Every edit anybody has in flight or has not resolved yet.
 *
 * Not scoped to the reader: two leaders working the same roster have to be able
 * to see each other's queued work, which is the whole of the collision journey.
 * The set stays small because settled jobs are swept.
 */
export function subscribeUpstreamEdits(
  onChange: (edits: UpstreamEdit[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, paths.upstreamEdits()), where('state', 'in', WATCHED)),
    (snapshot) =>
      onChange(
        // `hasPendingWrites` is per document and it is the whole of the offline
        // branch: a queued job the server has never seen must not tell somebody
        // it is already on its way.
        snapshot.docs.map((row) => toUpstreamEdit(row.id, row.data(), row.metadata.hasPendingWrites)),
      ),
    (error) => onError?.(error),
  );
}

export interface EnqueueOptions {
  studentId: string;
  /** Only the fields whose value differs from what the form opened on. */
  patch: UpstreamEditPatch;
  /** What the form was showing for each of those fields. */
  baseline: UpstreamEditPatch;
  uid: string;
  authorName: string;
}

/**
 * Queues an edit, or folds it into one nothing has claimed yet.
 *
 * The fold is not a nicety. A leader who saves, spots their own typo and saves
 * again three seconds later would otherwise cost Planning Center two writes and
 * leave the first one briefly winning on every other device. Superseding is
 * only safe while the job is still `queued` — once a worker holds it the second
 * edit becomes its own job and runs after, which is also correct, because the
 * drain diffs against a read taken after the first one landed.
 */
export async function enqueueUpstreamEdit(options: EnqueueOptions): Promise<string> {
  const { studentId, uid, authorName } = options;
  const editsRef = collection(db, paths.upstreamEdits());

  return runTransaction(db, async (transaction) => {
    /*
     * Read the candidate by a deterministic id rather than by a query.
     *
     * Firestore transactions in a browser cannot read a query, so the
     * supersedable job has to be findable by name. `queued:{studentId}` is that
     * name: there is at most one unclaimed edit per student by construction,
     * and the worker renames nothing — it moves the document out of this id
     * space by writing `state`, and a superseding write checks the state it
     * reads rather than the id it used to find it.
     */
    const openRef = doc(editsRef, `queued_${studentId}`);
    const open = await transaction.get(openRef);

    const merged: UpstreamEditPatch = { ...options.patch };
    const baseline: UpstreamEditPatch = { ...options.baseline };
    let createdAt: unknown = serverTimestamp();

    if (open.exists() && open.data().state === 'queued') {
      const previous = toUpstreamEdit(open.id, open.data());
      // The earlier patch first, so this save's fields win where they overlap,
      // and the earlier *baseline* wins everywhere — what the drain compares
      // against is what the record looked like before anybody started editing.
      for (const field of UPSTREAM_EDIT_FIELDS) {
        if (merged[field] === undefined && previous.patch[field] !== undefined) {
          (merged as Record<string, unknown>)[field] = previous.patch[field];
        }
        if (previous.baseline[field] !== undefined) {
          (baseline as Record<string, unknown>)[field] = previous.baseline[field];
        }
      }
      createdAt = open.data().createdAt ?? serverTimestamp();
    }

    transaction.set(openRef, {
      studentId,
      patch: merged,
      baseline,
      state: 'queued',
      attempts: 0,
      nextAttemptAt: null,
      leaseUntil: null,
      failure: null,
      message: null,
      field: null,
      observed: null,
      survivorPersonId: null,
      survivorName: null,
      createdAt,
      createdBy: uid,
      createdByName: authorName,
      updatedAt: serverTimestamp(),
      startedAt: null,
      settledAt: null,
    });

    return openRef.id;
  });
}

/** Stops a job nothing has claimed. Refused by the rules once one has. */
export async function cancelUpstreamEdit(editId: string): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, paths.upstreamEdit(editId));
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().state !== 'queued') return;
    transaction.update(ref, {
      state: 'cancelled',
      updatedAt: serverTimestamp(),
      settledAt: serverTimestamp(),
    });
  });
}

/**
 * Sends a refused edit again, with what was typed intact.
 *
 * Resets `attempts` rather than continuing the count, because a leader pressing
 * this has usually changed the world — reconnected the credentials, switched
 * write-back back on — and starting from the old backoff would make the retry
 * look broken for the first minute of a connection that is fine.
 */
export async function retryUpstreamEdit(editId: string): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, paths.upstreamEdit(editId));
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || snapshot.data().state !== 'failed') return;
    transaction.update(ref, {
      state: 'queued',
      attempts: 0,
      failure: null,
      message: null,
      field: null,
      nextAttemptAt: null,
      leaseUntil: null,
      updatedAt: serverTimestamp(),
      settledAt: null,
    });
  });
}

/**
 * "I have seen this" — for the states that need a human and got one.
 *
 * Not a delete from the browser: the sweeper owns removal, and a job the client
 * could delete is a job whose failure a client could hide.
 */
export async function dismissUpstreamEdit(editId: string): Promise<void> {
  await runTransaction(db, async (transaction) => {
    const ref = doc(db, paths.upstreamEdit(editId));
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const current = snapshot.data().state;
    if (current === 'queued' || current === 'sending' || current === 'waiting') return;
    transaction.update(ref, {
      state: 'cancelled',
      updatedAt: serverTimestamp(),
      settledAt: serverTimestamp(),
    });
  });
}
