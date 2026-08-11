/**
 * Draining the profile-edit queue.
 *
 * A leader presses Save, a document lands in `upstreamEdits`, and this is what
 * happens to it afterwards — without anybody watching a spinner. The whole
 * reason the queue exists is in `src/services/upstreamEdits.ts`; what matters
 * here is the four things that make a background job trustworthy.
 *
 * **Serial per student.** Two edits of one child must reach the backend in the
 * order they were queued, because the second one's diff is only correct against
 * a read taken after the first has landed. That is a lease document per
 * student, claimed with `create()` — which the admin SDK rejects rather than
 * overwrites — so no transaction and no query is needed, and the narrow
 * `FirestoreLike` surface stays narrow.
 *
 * **Recoverable.** A worker that dies mid-request holds a lease with an expiry
 * on it; the next sweep breaks it. Without that, an instance reclaimed halfway
 * through leaves a job no worker will ever pick up and a screen that has already
 * told a leader it is sending.
 *
 * **Idempotent.** Firestore triggers are at-least-once, and this runs whatever
 * arrives twice. It is safe because of what the queue refuses to carry: no
 * creates, ever — `onStudentCreated` owns those, and a create run twice is a
 * duplicate child in the church's permanent database. Every job here patches a
 * person who already exists, against a fresh read, so a second run finds nothing
 * to change and settles as landed.
 *
 * **Honest about identity.** The drain compares the person it *patched* against
 * the person the job *named*. If they differ, somebody merged them upstream and
 * the job settles as `merged` whatever happened to the fields — including the
 * case where nothing differed at all, which is the only way that case can ever
 * surface. See the note on `settleFor`.
 */
import type { FirestoreLike, FunctionLogger } from './firestore.js';
import { SILENT_LOGGER } from './firestore.js';

export const UPSTREAM_EDITS = 'upstreamEdits';
export const UPSTREAM_EDIT_LEASES = 'upstreamEditLeases';

/** How long a worker holds a student before a sweep may break the lease. */
export const LEASE_MS = 4 * 60_000;

/**
 * How long to wait before trying again, per attempt.
 *
 * Long tails on purpose. A rate limit on a busy Sunday morning is not a
 * failure and does not want to be retried into the same wall six times in a
 * minute; the backend's own `Retry-After` wins over this whenever it sends one.
 */
const DEFAULT_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000];

/**
 * The schedule, and why it is settable.
 *
 * `TALLY_EDIT_BACKOFF_MS` takes a comma-separated list of milliseconds. It is a
 * real operational knob rather than a test seam: a church whose Planning Center
 * is heavily throttled has a genuine reason to want longer steps, and one
 * running against a private mirror has a reason to want shorter. The end-to-end
 * suite sets it small for the same reason it sets a five-second cache TTL —
 * so a run exercises the retry rather than routing around it.
 *
 * A malformed value falls back rather than throwing. This is read at module
 * load in a background worker, and a typo in an environment variable must not
 * be the thing that stops a queue draining.
 */
function backoffFromEnv(): number[] {
  const raw = process.env.TALLY_EDIT_BACKOFF_MS;
  if (!raw) return DEFAULT_BACKOFF_MS;
  const parsed = raw
    .split(',')
    .map((step) => Number(step.trim()))
    .filter((step) => Number.isFinite(step) && step >= 0);
  return parsed.length > 0 ? parsed : DEFAULT_BACKOFF_MS;
}

export const BACKOFF_MS = backoffFromEnv();

/** After this many attempts a job stops being a machine's problem. */
export const MAX_ATTEMPTS = BACKOFF_MS.length;

/** Settled jobs nobody has to act on are swept once they have been seen. */
export const LANDED_TTL_MS = 3 * 60_000;

export type EditState =
  | 'queued'
  | 'sending'
  | 'waiting'
  | 'landed'
  | 'differs'
  | 'merged'
  | 'failed'
  | 'orphaned'
  | 'cancelled';

export type FailureClass =
  | 'auth'
  | 'writeBackOff'
  | 'validation'
  | 'personGone'
  | 'exhausted'
  | 'unknown';

export interface EditRecord {
  id: string;
  studentId: string;
  patch: Record<string, unknown>;
  baseline: Record<string, unknown>;
  state: EditState;
  attempts: number;
  nextAttemptAtMs: number | null;
  leaseUntilMs: number | null;
  createdAtMs: number;
}

/**
 * What running one edit against a backend produced.
 *
 * Deliberately not the backend's own result type: this module knows nothing
 * about Planning Center or Attendees, which is what lets the whole drain be
 * exercised in-process with no network and no emulator.
 */
export interface RunOutcome {
  kind: 'landed' | 'differs' | 'merged' | 'orphaned' | 'refused' | 'retry';
  message?: string;
  /** On `differs`: the fields the backend held that the edit did not expect. */
  observed?: Record<string, unknown>;
  /** On `merged`: who the edit actually landed on. */
  survivorPersonId?: string;
  survivorName?: string;
  /** On `refused`: which class, so the list can aggregate rather than repeat. */
  failure?: FailureClass;
  /** On `refused`: the field a validation refusal was about. */
  field?: string;
  /** On `retry`: what the backend asked for, where it said. */
  retryAfterMs?: number | null;
}

export interface DrainDeps {
  db: FirestoreLike;
  now: () => Date;
  run: (edit: EditRecord) => Promise<RunOutcome>;
  logger?: FunctionLogger;
}

function millis(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/**
 * The states this drain knows. Anything else reads as `queued`.
 *
 * Defensive on purpose: a document written by a newer client — or corrupted —
 * must not be able to stop the sweep, because the sweep is what everything
 * else in the queue depends on to make progress.
 */
const STATES = new Set<EditState>([
  'queued',
  'sending',
  'waiting',
  'landed',
  'differs',
  'merged',
  'failed',
  'orphaned',
  'cancelled',
]);

export function toEditRecord(id: string, data: Record<string, unknown>): EditRecord {
  return {
    id,
    studentId: typeof data.studentId === 'string' ? data.studentId : '',
    patch: (data.patch as Record<string, unknown>) ?? {},
    baseline: (data.baseline as Record<string, unknown>) ?? {},
    state:
      typeof data.state === 'string' && STATES.has(data.state as EditState)
        ? (data.state as EditState)
        : 'queued',
    attempts: typeof data.attempts === 'number' ? data.attempts : 0,
    nextAttemptAtMs: millis(data.nextAttemptAt),
    leaseUntilMs: millis(data.leaseUntil),
    createdAtMs: millis(data.createdAt) ?? 0,
  };
}

/** Whether this job is one a worker may pick up right now. */
export function isRunnable(edit: EditRecord, nowMs: number): boolean {
  if (edit.state === 'queued') return true;
  if (edit.state === 'waiting') return (edit.nextAttemptAtMs ?? 0) <= nowMs;
  // A `sending` job whose lease has lapsed is a worker that died mid-request.
  // Re-running it is safe for the same reason a duplicate delivery is.
  if (edit.state === 'sending') return (edit.leaseUntilMs ?? 0) < nowMs;
  return false;
}

/**
 * Takes the student, or reports that somebody else has them.
 *
 * `create` is the whole mechanism: the admin SDK rejects rather than
 * overwriting, so two workers racing for one child produce exactly one winner
 * with no transaction. An expired lease is broken and re-taken once — and if
 * that second `create` also loses, the other worker won fairly and this one
 * simply leaves.
 */
export async function claimStudent(
  db: FirestoreLike,
  studentId: string,
  editId: string,
  nowMs: number,
): Promise<boolean> {
  const ref = db.doc(`${UPSTREAM_EDIT_LEASES}/${studentId}`);
  const lease = { editId, untilMs: nowMs + LEASE_MS };

  try {
    await ref.create(lease);
    return true;
  } catch {
    const held = await ref.get();
    const until = held.exists ? millis(held.data()?.untilMs) : null;
    if (until !== null && until > nowMs) return false;
    await ref.delete();
    try {
      await ref.create(lease);
      return true;
    } catch {
      return false;
    }
  }
}

export async function releaseStudent(db: FirestoreLike, studentId: string): Promise<void> {
  await db.doc(`${UPSTREAM_EDIT_LEASES}/${studentId}`).delete();
}

/**
 * How an outcome is written down.
 *
 * `merged` outranks everything, including `landed`, and that is the point of it
 * being decided on the id rather than on the values. The dangerous case is the
 * quiet one: the survivor already holds what was typed, no field differs, and
 * without this the job would report success while the student document now
 * resolves to a different human than it did an hour ago. On a record whose
 * identity block is a name, a grade and an allergy line, that is the silent
 * failure worth building machinery to catch.
 */
export function settleFor(outcome: RunOutcome, attempts: number, nowMs: number) {
  switch (outcome.kind) {
    case 'merged':
      return {
        state: 'merged' as EditState,
        survivorPersonId: outcome.survivorPersonId ?? null,
        survivorName: outcome.survivorName ?? null,
      };
    case 'differs':
      return { state: 'differs' as EditState, observed: outcome.observed ?? null };
    case 'orphaned':
      return { state: 'orphaned' as EditState };
    case 'landed':
      return { state: 'landed' as EditState };
    case 'refused':
      return {
        state: 'failed' as EditState,
        failure: outcome.failure ?? 'unknown',
        field: outcome.field ?? null,
      };
    case 'retry':
    default: {
      if (attempts >= MAX_ATTEMPTS) {
        // Out of patience rather than refused. The distinction is what the
        // screen needs: this one is worth a leader pressing again, and a 401
        // is not.
        return { state: 'failed' as EditState, failure: 'exhausted' as FailureClass, field: null };
      }
      const backoff = outcome.retryAfterMs ?? BACKOFF_MS[Math.min(attempts, MAX_ATTEMPTS - 1)]!;
      return { state: 'waiting' as EditState, nextAttemptAtMs: nowMs + backoff };
    }
  }
}

/** Runs one edit, if it is still runnable and nobody else holds the student. */
export async function drainEdit(edit: EditRecord, deps: DrainDeps): Promise<EditState | null> {
  const logger = deps.logger ?? SILENT_LOGGER;
  const nowMs = deps.now().getTime();
  if (!isRunnable(edit, nowMs)) return null;
  if (!edit.studentId) return null;

  if (!(await claimStudent(deps.db, edit.studentId, edit.id, nowMs))) return null;

  const ref = deps.db.doc(`${UPSTREAM_EDITS}/${edit.id}`);
  const attempts = edit.attempts + 1;

  try {
    await ref.update({
      state: 'sending',
      attempts,
      startedAt: deps.now(),
      leaseUntil: new Date(nowMs + LEASE_MS),
      updatedAt: deps.now(),
    });

    const outcome = await deps.run(edit);
    const settled = settleFor(outcome, attempts, nowMs);
    const done = settled.state !== 'waiting';

    await ref.update({
      ...settled,
      nextAttemptAt:
        'nextAttemptAtMs' in settled && settled.nextAttemptAtMs
          ? new Date(settled.nextAttemptAtMs)
          : null,
      message: outcome.message ?? null,
      leaseUntil: null,
      updatedAt: deps.now(),
      settledAt: done ? deps.now() : null,
    });

    logger.info('Drained an upstream edit', {
      editId: edit.id,
      studentId: edit.studentId,
      state: settled.state,
      attempts,
    });
    return settled.state;
  } catch (error) {
    /*
     * A throw here is this function failing, not the backend refusing — the
     * runner is expected to classify its own errors. Treated as retryable on
     * purpose: the alternative is a leader's typed correction discarded because
     * a server had a bad minute.
     */
    const settled = settleFor({ kind: 'retry' }, attempts, nowMs);
    await ref.update({
      ...settled,
      nextAttemptAt: settled.nextAttemptAtMs ? new Date(settled.nextAttemptAtMs) : null,
      leaseUntil: null,
      updatedAt: deps.now(),
    });
    logger.warn('An upstream edit threw; it will be retried', {
      editId: edit.id,
      error: String(error),
    });
    return settled.state;
  } finally {
    await releaseStudent(deps.db, edit.studentId);
  }
}

export interface SweepResult {
  ran: number;
  swept: number;
}

/**
 * Everything the trigger could not cover: backed-off retries whose time has
 * come, jobs abandoned by a dead worker, jobs created while the trigger itself
 * was failing — and the tidying of settled ones.
 *
 * Reads the whole collection rather than querying it, which is right here and
 * would not be anywhere else: the set is bounded by design (in flight, plus
 * failures nobody has resolved, plus a few minutes of landed ones), and it
 * keeps `FirestoreLike` free of a query surface that only this would use.
 *
 * The batch is deliberately small. A queue that built up through an outage
 * drains into an API that rate-limits, and stampeding it is how a recovery
 * turns back into an outage.
 */
export async function sweepEdits(deps: DrainDeps, limit = 5): Promise<SweepResult> {
  const nowMs = deps.now().getTime();
  const snapshot = await deps.db.collection(UPSTREAM_EDITS).get();
  const edits = snapshot.docs.map((row) => toEditRecord(row.id, row.data() ?? {}));

  let swept = 0;
  for (const edit of edits) {
    const settledLongAgo = edit.state === 'landed' || edit.state === 'cancelled';
    if (settledLongAgo && nowMs - (millis(edit.nextAttemptAtMs) ?? edit.createdAtMs) > LANDED_TTL_MS) {
      // The instruction had a lifetime and it is over. This is what keeps the
      // queue from becoming the copy of a managed field that the whole
      // no-mirror rule exists to forbid.
      await deps.db.doc(`${UPSTREAM_EDITS}/${edit.id}`).delete();
      swept += 1;
    }
  }

  const runnable = edits
    .filter((edit) => isRunnable(edit, nowMs))
    // Oldest first: a queue drained newest-first reorders two edits of one
    // child, which is the one thing the lease exists to prevent.
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .slice(0, limit);

  let ran = 0;
  for (const edit of runnable) {
    const state = await drainEdit(edit, deps);
    if (state !== null) ran += 1;
  }

  return { ran, swept };
}
