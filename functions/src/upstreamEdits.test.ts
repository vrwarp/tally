/**
 * The drain, exercised in-process.
 *
 * Everything here runs against `FakeFirestore` and a `run` stub, because the
 * whole point of splitting the classification (`runUpstreamEdit`, in index.ts)
 * from the machinery (this module) is that the machinery can be argued with
 * without a network, an emulator or a Planning Center simulator.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from './testing/fakeFirestore.js';
import {
  BACKOFF_MS,
  LEASE_MS,
  MAX_ATTEMPTS,
  UPSTREAM_EDITS,
  UPSTREAM_EDIT_LEASES,
  claimStudent,
  drainEdit,
  isRunnable,
  settleFor,
  sweepEdits,
  toEditRecord,
  type EditRecord,
  type RunOutcome,
} from './upstreamEdits.js';

const NOW = new Date('2025-03-14T09:00:00Z');
const nowMs = NOW.getTime();

function edit(over: Partial<EditRecord> = {}): EditRecord {
  return {
    id: 'edit-1',
    studentId: 'pco_101',
    patch: { lastName: 'Chen-Ito' },
    baseline: { lastName: 'Chen' },
    state: 'queued',
    attempts: 0,
    nextAttemptAtMs: null,
    leaseUntilMs: null,
    createdAtMs: nowMs - 10_000,
    ...over,
  };
}

function seeded(over: Partial<EditRecord> = {}): { db: FakeFirestore; record: EditRecord } {
  const db = new FakeFirestore();
  const record = edit(over);
  db.seed(`${UPSTREAM_EDITS}/${record.id}`, {
    studentId: record.studentId,
    patch: record.patch,
    baseline: record.baseline,
    state: record.state,
    attempts: record.attempts,
  });
  return { db, record };
}

function deps(db: FakeFirestore, run: (job: EditRecord) => Promise<RunOutcome>) {
  return { db, now: () => NOW, run };
}

describe('what a worker may pick up', () => {
  it('takes a queued job', () => {
    expect(isRunnable(edit(), nowMs)).toBe(true);
  });

  it('leaves a backed-off job alone until its time', () => {
    expect(isRunnable(edit({ state: 'waiting', nextAttemptAtMs: nowMs + 5_000 }), nowMs)).toBe(false);
    expect(isRunnable(edit({ state: 'waiting', nextAttemptAtMs: nowMs - 1 }), nowMs)).toBe(true);
  });

  /**
   * The case that makes a dead worker recoverable.
   *
   * Without it, an instance reclaimed mid-request leaves a job in `sending`
   * that nothing will ever pick up, under a screen that has already told a
   * leader their correction is on its way.
   */
  it('reclaims a job whose worker died holding it', () => {
    expect(isRunnable(edit({ state: 'sending', leaseUntilMs: nowMs + LEASE_MS }), nowMs)).toBe(false);
    expect(isRunnable(edit({ state: 'sending', leaseUntilMs: nowMs - 1 }), nowMs)).toBe(true);
  });

  it('never touches a settled job', () => {
    for (const state of ['landed', 'differs', 'merged', 'failed', 'orphaned', 'cancelled'] as const) {
      expect(isRunnable(edit({ state }), nowMs)).toBe(false);
    }
  });
});

describe('the per-student lease', () => {
  it('lets exactly one worker hold a student', async () => {
    const db = new FakeFirestore();
    expect(await claimStudent(db, 'pco_101', 'edit-1', nowMs)).toBe(true);
    expect(await claimStudent(db, 'pco_101', 'edit-2', nowMs)).toBe(false);
  });

  it('breaks a lease whose holder is gone', async () => {
    const db = new FakeFirestore();
    db.seed(`${UPSTREAM_EDIT_LEASES}/pco_101`, { editId: 'dead', untilMs: nowMs - 1 });
    expect(await claimStudent(db, 'pco_101', 'edit-2', nowMs)).toBe(true);
  });

  /**
   * Two edits of one child must reach the backend in the order they were
   * queued, because the second one's diff is only correct against a read taken
   * after the first has landed.
   */
  it('holds a second edit of the same student behind the first', async () => {
    const { db } = seeded();
    db.seed(`${UPSTREAM_EDIT_LEASES}/pco_101`, { editId: 'other', untilMs: nowMs + LEASE_MS });

    const state = await drainEdit(edit(), deps(db, async () => ({ kind: 'landed' })));
    expect(state).toBeNull();
    expect(db.get(`${UPSTREAM_EDITS}/edit-1`)?.state).toBe('queued');
  });

  it('gives the student back when it is done', async () => {
    const { db } = seeded();
    await drainEdit(edit(), deps(db, async () => ({ kind: 'landed' })));
    expect(db.get(`${UPSTREAM_EDIT_LEASES}/pco_101`)).toBeUndefined();
  });
});

describe('how an outcome is written down', () => {
  it('records a landing', async () => {
    const { db } = seeded();
    const state = await drainEdit(edit(), deps(db, async () => ({ kind: 'landed' })));
    expect(state).toBe('landed');
    const stored = db.get(`${UPSTREAM_EDITS}/edit-1`)!;
    expect(stored.state).toBe('landed');
    expect(stored.attempts).toBe(1);
    expect(stored.leaseUntil).toBeNull();
  });

  /**
   * The rule this whole state exists for.
   *
   * `merged` is decided on the id, never on the values, and it outranks
   * `landed`. The dangerous case is the quiet one: the survivor already holds
   * what was typed, nothing differs, and without this the job reports success
   * while the student resolves to a different human than it did an hour ago.
   */
  it('reports a merge even when nothing about the fields changed', () => {
    const settled = settleFor(
      { kind: 'merged', survivorPersonId: '377', survivorName: 'Ava Chen-Ito' },
      1,
      nowMs,
    );
    expect(settled.state).toBe('merged');
    expect(settled).toMatchObject({ survivorPersonId: '377', survivorName: 'Ava Chen-Ito' });
  });

  it('keeps what the backend held when somebody else changed the same field', () => {
    const settled = settleFor({ kind: 'differs', observed: { lastName: 'Ito' } }, 1, nowMs);
    expect(settled).toMatchObject({ state: 'differs', observed: { lastName: 'Ito' } });
  });

  it('names the failure class so the list can say it once instead of nine times', () => {
    expect(settleFor({ kind: 'refused', failure: 'auth' }, 1, nowMs)).toMatchObject({
      state: 'failed',
      failure: 'auth',
    });
  });
});

describe('retrying', () => {
  it('backs off further each time', () => {
    expect(settleFor({ kind: 'retry' }, 1, nowMs)).toMatchObject({
      state: 'waiting',
      nextAttemptAtMs: nowMs + BACKOFF_MS[1]!,
    });
  });

  /** A backend that says how long to wait is believed over the schedule. */
  it('honours what the backend asked for', () => {
    expect(settleFor({ kind: 'retry', retryAfterMs: 90_000 }, 1, nowMs)).toMatchObject({
      nextAttemptAtMs: nowMs + 90_000,
    });
  });

  /**
   * Out of patience is not the same as refused, and the screen branches on the
   * difference: this one is worth a leader pressing again, and a rotated
   * credential is not.
   */
  it('gives up as `exhausted` rather than as a refusal', () => {
    expect(settleFor({ kind: 'retry' }, MAX_ATTEMPTS, nowMs)).toMatchObject({
      state: 'failed',
      failure: 'exhausted',
    });
  });

  /**
   * A throw is this code failing, not the backend refusing. Discarding a
   * leader's typed correction because a server had a bad minute is the one
   * outcome that must not happen.
   */
  it('retries rather than losing an edit when the runner throws', async () => {
    const { db } = seeded();
    const state = await drainEdit(
      edit(),
      deps(db, async () => {
        throw new Error('socket hang up');
      }),
    );
    expect(state).toBe('waiting');
    expect(db.get(`${UPSTREAM_EDITS}/edit-1`)?.state).toBe('waiting');
    expect(db.get(`${UPSTREAM_EDIT_LEASES}/pco_101`)).toBeUndefined();
  });
});

describe('the sweep', () => {
  it('runs the oldest first, so two edits of one child keep their order', async () => {
    const db = new FakeFirestore();
    db.seed(`${UPSTREAM_EDITS}/newer`, {
      studentId: 'a',
      state: 'queued',
      createdAt: new Date(nowMs - 1_000),
    });
    db.seed(`${UPSTREAM_EDITS}/older`, {
      studentId: 'b',
      state: 'queued',
      createdAt: new Date(nowMs - 60_000),
    });

    const seen: string[] = [];
    await sweepEdits(deps(db, async (job) => {
      seen.push(job.id);
      return { kind: 'landed' };
    }));
    expect(seen).toEqual(['older', 'newer']);
  });

  /**
   * A queue that built up through an outage drains into an API that
   * rate-limits, and stampeding it is how a recovery turns back into one.
   */
  it('takes a small batch rather than everything at once', async () => {
    const db = new FakeFirestore();
    for (let index = 0; index < 12; index += 1) {
      db.seed(`${UPSTREAM_EDITS}/job-${index}`, {
        studentId: `student-${index}`,
        state: 'queued',
        createdAt: new Date(nowMs - index * 1000),
      });
    }
    const result = await sweepEdits(deps(db, async () => ({ kind: 'landed' })), 3);
    expect(result.ran).toBe(3);
  });

  it('does not pick up a job that is settled or still backing off', async () => {
    const db = new FakeFirestore();
    db.seed(`${UPSTREAM_EDITS}/done`, { studentId: 'a', state: 'landed' });
    db.seed(`${UPSTREAM_EDITS}/soon`, {
      studentId: 'b',
      state: 'waiting',
      nextAttemptAt: new Date(nowMs + 60_000),
    });
    const result = await sweepEdits(deps(db, async () => ({ kind: 'landed' })));
    expect(result.ran).toBe(0);
  });
});

describe('reading a stored job', () => {
  it('survives a document written by something newer', () => {
    const record = toEditRecord('edit-9', {
      studentId: 'pco_1',
      state: 'somethingElse',
      patch: { lastName: 'X' },
    });
    // An unknown state reads as queued rather than throwing: a drain that
    // crashed on an unfamiliar document would stop draining everything else.
    expect(record.state).toBe('queued');
  });
});
