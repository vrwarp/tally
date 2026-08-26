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
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { drainStudentEdits } from '@/services/functions';
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
  // Stryker disable next-line ConditionalExpression: `STATES` holds strings, so
  // `has` refuses a number or an object on its own. The `typeof` is here to
  // narrow for the cast rather than to decide anything.
  return typeof value === 'string' && STATES.has(value) ? (value as UpstreamEditState) : 'queued';
}

function patch(value: unknown): UpstreamEditPatch {
  // Stryker disable next-line ConditionalExpression: reading a field off a
  // number or a string is `undefined`, not a throw, so the loop below refuses
  // every primitive on its own and only null and undefined needed catching.
  // The object test says what a patch is rather than leaving it to be inferred.
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
/**
 * Asks a server to send this student's queued edits, now.
 *
 * Fire-and-forget on purpose, and quiet on purpose. This is the browser doing
 * what `onUpstreamEditCreated` used to do — starting the drain in a second
 * rather than leaving it to the sweep — and it is an optimisation over a job
 * that is *already durable*. The document was written before this was called
 * and the sweep will take it whatever happens here, so a rejection means the
 * edit is slower, never lost, and there is nothing to tell a leader who has
 * already been shown a queued job on the record.
 *
 * The one thing that matters is the ordering, which is why every caller chains
 * this onto the write's server acknowledgement rather than calling it beside
 * the write. A poke that overtakes its own job finds nothing to do, and the
 * edit then waits for the sweep — the exact latency this exists to avoid.
 * Offline that acknowledgement never comes, so no poke is sent, which is also
 * correct: there is no server to ask.
 */
export function pokeUpstreamDrain(studentId: string): void {
  void drainStudentEdits({ studentId }).catch(() => {
    /* The sweep is the answer to every failure here. */
  });
}

export interface EnqueuedEdit {
  /** The job's id, which exists the moment the local write is applied. */
  editId: string;
  /**
   * Resolves when the server has the job, and rejects if it never will.
   *
   * Deliberately not awaited by the screens that enqueue: offline, this does
   * not settle at all — the Firestore SDK holds the write and keeps this
   * promise pending until a server acknowledges it, which on a phone in a
   * corridor may be several minutes. Awaiting it is what left a leader looking
   * at an open dialog and a spinner after pressing Save with no signal, which
   * is the exact case the queue was built for.
   *
   * It still has to be watched: the one thing that must not happen quietly is
   * a rejection, because a job the rules refused never existed and no strip
   * will ever appear to say so.
   */
  written: Promise<void>;
}

export function enqueueUpstreamEdit(options: EnqueueOptions): EnqueuedEdit {
  const { studentId, uid, authorName } = options;

  /*
   * One plain write, and deliberately not a transaction.
   *
   * The first version of this ran a transaction so that a second save could
   * fold into an unclaimed first — which was a nicety, and it cost the one
   * property this whole design is built on. A Firestore transaction needs the
   * server: it reads, compares and writes in one round trip, so offline it does
   * not queue, it simply never resolves. The counselor in a corridor that the
   * journey calls the ordinary case would have pressed Save and had nothing
   * happen at all.
   *
   * A `setDoc` on a fresh id is held on the device and sent when the signal
   * comes back, which is the behaviour that was being claimed all along.
   *
   * Folding two saves together moved to the drain, which is a better home for
   * it anyway: it is the thing that holds the student's lease, so it sees every
   * queued job for that child at once — including a burst that left a phone in
   * one batch after an hour with no signal, which no client-side transaction
   * could ever have folded.
   */
  const ref = doc(collection(db, paths.upstreamEdits()));

  const written = setDoc(ref, {
    studentId,
    patch: options.patch,
    baseline: options.baseline,
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
    createdAt: serverTimestamp(),
    createdBy: uid,
    createdByName: authorName,
    updatedAt: serverTimestamp(),
    startedAt: null,
    settledAt: null,
  });

  /*
   * Chained onto the acknowledgement rather than fired beside the write, so
   * the drain cannot arrive before the job it is being asked to run. See
   * `pokeUpstreamDrain`.
   */
  void written.then(() => pokeUpstreamDrain(studentId)).catch(() => {
    /* A write that never landed has nothing to drain. */
  });

  return { editId: ref.id, written };
}

/**
 * Stops a job nothing has claimed.
 *
 * A blind update rather than a read-then-write, because the guard belongs in
 * the rules and is already there: `queued → cancelled` is the only transition
 * they allow from here, so a job a worker claimed in the meantime is refused by
 * the database rather than by a check this code could get wrong. That also
 * keeps the operation offline-tolerant, which a transaction is not.
 */
export async function cancelUpstreamEdit(editId: string): Promise<void> {
  await updateDoc(doc(db, paths.upstreamEdit(editId)), {
    state: 'cancelled',
    updatedAt: serverTimestamp(),
    settledAt: serverTimestamp(),
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
export async function retryUpstreamEdit(editId: string, studentId: string): Promise<void> {
  await updateDoc(doc(db, paths.upstreamEdit(editId)), {
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
  /*
   * Awaited above rather than chained, because unlike the first write this one
   * is a leader pressing a button while looking at the screen: they are online
   * by definition, and the poke is what makes "Send it again" mean now.
   */
  pokeUpstreamDrain(studentId);
}

/**
 * "I have seen this" — for the states that need a human and got one.
 *
 * Not a delete from the browser: the sweeper owns removal, and a job the client
 * could delete is a job whose failure a client could hide.
 */
export async function dismissUpstreamEdit(editId: string): Promise<void> {
  await updateDoc(doc(db, paths.upstreamEdit(editId)), {
    state: 'cancelled',
    updatedAt: serverTimestamp(),
    settledAt: serverTimestamp(),
  });
}
