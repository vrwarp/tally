/**
 * The profile-edit queue: what a browser is allowed to write, what it makes of
 * what it reads back, and when it asks a server to get on with it.
 *
 * The queue used to be started by a Firestore trigger. It is started by the
 * device that made the edit now, which is faster and one moving part fewer —
 * and which introduces exactly one way to get it wrong: asking for the drain
 * before the job has reached a server. A poke that overtakes its own job finds
 * nothing to do and the edit waits for the sweep, which is the latency the
 * poke exists to avoid, and nothing fails loudly when it happens.
 *
 * The read side has a different worry. These documents are written by a server
 * that deploys separately from this bundle, so every field arrives as
 * `unknown` and a browser one version behind must not turn a field it does not
 * recognise into a crash on the roster.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpstreamEdit } from '@/types';

const setDoc = vi.hoisted(() => vi.fn());
const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const drainStudentEdits = vi.hoisted(() => vi.fn(async () => ({ data: { states: [] } })));
const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));
const query = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ query: args })));
const where = vi.hoisted(() => vi.fn((...args: unknown[]) => ({ where: args })));
const collection = vi.hoisted(() => vi.fn((_db: unknown, path: string) => ({ path })));
const docFn = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ id: 'edit-1' })));

/** A stand-in for the SDK class `toDateOrNull` branches on. */
class FakeTimestamp {
  constructor(private readonly seconds: number) {}
  toDate(): Date {
    return new Date(this.seconds * 1000);
  }
}

vi.mock('firebase/firestore', () => ({
  collection,
  doc: docFn,
  setDoc,
  updateDoc,
  serverTimestamp: () => 'ts',
  onSnapshot,
  query,
  where,
  Timestamp: FakeTimestamp,
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/functions', () => ({ drainStudentEdits }));

const {
  cancelUpstreamEdit,
  dismissUpstreamEdit,
  enqueueUpstreamEdit,
  pokeUpstreamDrain,
  retryUpstreamEdit,
  subscribeUpstreamEdits,
  toUpstreamEdit,
} = await import('@/services/upstreamEdits');

const OPTIONS = {
  studentId: 'pco_101',
  patch: { lastName: 'Chen-Ito' },
  baseline: { lastName: 'Chen' },
  uid: 'dana',
  authorName: 'Dana Ruiz',
};

beforeEach(() => {
  setDoc.mockReset();
  drainStudentEdits.mockClear();
  updateDoc.mockClear();
  onSnapshot.mockClear();
  docFn.mockClear();
  where.mockClear();
});

describe('asking for a queued edit to be sent', () => {
  it('waits for the server to have the job before asking for it to be run', async () => {
    let acknowledge = () => {};
    setDoc.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
    );

    const { written } = enqueueUpstreamEdit(OPTIONS);

    // The write is out and the record already draws from it — and nothing has
    // been asked to drain, because a drain now would find no job.
    expect(setDoc).toHaveBeenCalledTimes(1);
    expect(drainStudentEdits).not.toHaveBeenCalled();

    acknowledge();
    await written;
    await Promise.resolve();

    expect(drainStudentEdits).toHaveBeenCalledWith({ studentId: 'pco_101' });
  });

  /**
   * The corridor. There is no server to ask, so nothing is asked — and the
   * edit is not lost by that: it is held on the device, and the poke goes when
   * the acknowledgement does. A version of this that fired the poke beside the
   * write would spend an offline save on a call that cannot connect.
   */
  it('asks nobody while there is no signal', async () => {
    setDoc.mockReturnValueOnce(new Promise<void>(() => {}));

    enqueueUpstreamEdit(OPTIONS);
    await Promise.resolve();

    expect(drainStudentEdits).not.toHaveBeenCalled();
  });

  it('asks nobody to run a job that was never written', async () => {
    setDoc.mockRejectedValueOnce(new Error('permission-denied'));

    const { written } = enqueueUpstreamEdit(OPTIONS);
    await expect(written).rejects.toThrow();
    await Promise.resolve();

    expect(drainStudentEdits).not.toHaveBeenCalled();
  });

  /**
   * The whole point of the poke being an optimisation over a durable job: if
   * asking fails, the sweep still runs it, so there is nothing to report and
   * nothing to throw. A rejection escaping here would surface as an unhandled
   * promise on a save that in fact succeeded.
   */
  it('says nothing and throws nothing when the ask itself fails', async () => {
    setDoc.mockResolvedValueOnce(undefined);
    drainStudentEdits.mockRejectedValueOnce(new Error('unavailable'));

    const { written } = enqueueUpstreamEdit(OPTIONS);
    await expect(written).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(drainStudentEdits).toHaveBeenCalled();
  });

  it('asks straight away when a leader presses send again', async () => {
    await retryUpstreamEdit('edit-1', 'pco_101');

    // No chaining here, unlike the first write: somebody is looking at the
    // screen, so they are online, and "Send it again" has to mean now.
    expect(updateDoc).toHaveBeenCalled();
    expect(drainStudentEdits).toHaveBeenCalledWith({ studentId: 'pco_101' });
  });

  it('is callable on its own without anybody awaiting it', () => {
    expect(() => pokeUpstreamDrain('pco_101')).not.toThrow();
    expect(drainStudentEdits).toHaveBeenCalledWith({ studentId: 'pco_101' });
  });
});

describe('what a browser writes when a leader presses Save', () => {
  it('writes the job the rules will accept, and nothing a client may claim', async () => {
    setDoc.mockResolvedValueOnce(undefined);

    const { editId, written } = enqueueUpstreamEdit(OPTIONS);
    await written;

    expect(editId).toBe('edit-1');
    const call = setDoc.mock.calls[0] as unknown[];
    expect(call[1]).toEqual({
      studentId: 'pco_101',
      patch: { lastName: 'Chen-Ito' },
      baseline: { lastName: 'Chen' },
      // The rules enforce this shape on create: a browser can ask for work and
      // can never claim work was done.
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
      createdAt: 'ts',
      createdBy: 'dana',
      createdByName: 'Dana Ruiz',
      updatedAt: 'ts',
      startedAt: null,
      settledAt: null,
    });
  });

  it('hands back the id before the server has seen the job', () => {
    // The record draws the queued strip from this id while the write is still
    // on the device, which is the whole of the offline story.
    setDoc.mockReturnValueOnce(new Promise<void>(() => {}));

    const { editId } = enqueueUpstreamEdit(OPTIONS);

    expect(editId).toBe('edit-1');
  });

  it('mints a fresh document rather than writing over one', () => {
    setDoc.mockResolvedValueOnce(undefined);

    enqueueUpstreamEdit(OPTIONS);

    // A `doc()` with no path is a new id, which is what Firestore holds on the
    // device. Naming one would make a second save clobber the first.
    expect(docFn).toHaveBeenCalledWith({ path: 'upstreamEdits' });
  });
});

describe('cancelling and dismissing', () => {
  it('asks for the one transition the rules allow, without reading first', async () => {
    await cancelUpstreamEdit('edit-7');

    // Blind on purpose: a job a worker claimed in the meantime is refused by
    // the database rather than by a check this code could get wrong.
    const call = updateDoc.mock.calls[0] as unknown[];
    expect(docFn).toHaveBeenCalledWith({}, 'upstreamEdits/edit-7');
    expect(call[1]).toEqual({ state: 'cancelled', updatedAt: 'ts', settledAt: 'ts' });
  });

  it('does not poke the drain for a job being stopped', async () => {
    await cancelUpstreamEdit('edit-7');

    expect(drainStudentEdits).not.toHaveBeenCalled();
  });

  it('settles a job a human has seen, without deleting it', async () => {
    await dismissUpstreamEdit('edit-7');

    // The sweeper owns removal: a job the client could delete is a job whose
    // failure a client could hide.
    const call = updateDoc.mock.calls[0] as unknown[];
    expect(call[1]).toEqual({ state: 'cancelled', updatedAt: 'ts', settledAt: 'ts' });
  });

  it('lets a refusal reach the caller', async () => {
    updateDoc.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(cancelUpstreamEdit('edit-7')).rejects.toThrow('permission-denied');
  });
});

describe('sending a refused edit again', () => {
  it('clears the failure and starts the backoff over', async () => {
    await retryUpstreamEdit('edit-7', 'pco_101');

    const call = updateDoc.mock.calls[0] as unknown[];
    expect(call[1]).toEqual({
      state: 'queued',
      // Continuing the count would make a retry over a fixed connection look
      // broken for the first minute of one that is fine.
      attempts: 0,
      failure: null,
      message: null,
      field: null,
      nextAttemptAt: null,
      leaseUntil: null,
      updatedAt: 'ts',
      settledAt: null,
    });
  });

  it('leaves the patch alone, so what was typed survives the retry', async () => {
    await retryUpstreamEdit('edit-7', 'pco_101');

    const call = updateDoc.mock.calls[0] as unknown[];
    expect(call[1]).not.toHaveProperty('patch');
    expect(call[1]).not.toHaveProperty('baseline');
  });

  it('asks nobody to drain a retry the database refused', async () => {
    updateDoc.mockRejectedValueOnce(new Error('permission-denied'));

    await expect(retryUpstreamEdit('edit-7', 'pco_101')).rejects.toThrow();
    expect(drainStudentEdits).not.toHaveBeenCalled();
  });
});

describe('the stream', () => {
  /** Runs `subscribeUpstreamEdits` and hands back what it was wired up with. */
  function subscribe(onChange = vi.fn(), onError?: (error: Error) => void) {
    const unsubscribe = subscribeUpstreamEdits(onChange, onError);
    const call = onSnapshot.mock.calls[0] as unknown[];
    return {
      onChange,
      unsubscribe,
      next: call[1] as (snapshot: unknown) => void,
      fail: call[2] as (error: Error) => void,
    };
  }

  function snapshotOf(
    rows: Array<{ id: string; data: Record<string, unknown>; pending?: boolean }>,
  ) {
    return {
      docs: rows.map((row) => ({
        id: row.id,
        data: () => row.data,
        metadata: { hasPendingWrites: row.pending ?? false },
      })),
    };
  }

  it('watches every state worth showing, and not the ones that are over', () => {
    subscribe();

    const call = where.mock.calls[0] as unknown[];
    expect(call[0]).toBe('state');
    expect(call[1]).toBe('in');
    // `landed` is here on purpose — it is what puts the green mark on the row
    // for the minute before the sweeper takes it. `cancelled` has nothing to
    // say to anybody.
    expect(call[2]).toEqual([
      'queued',
      'sending',
      'waiting',
      'landed',
      'differs',
      'merged',
      'failed',
      'orphaned',
    ]);
  });

  it('is not scoped to the reader', () => {
    subscribe();

    // Two leaders working the same roster have to see each other's queued
    // work; that is the whole of the collision journey.
    expect(collection).toHaveBeenCalledWith({}, 'upstreamEdits');
    const call = where.mock.calls[0] as unknown[];
    expect(call.some((argument) => argument === 'createdBy')).toBe(false);
  });

  it('hands each row through the converter', () => {
    const { onChange, next } = subscribe();

    next(snapshotOf([{ id: 'edit-1', data: { studentId: 'pco_101', state: 'sending' } }]));

    const edits = onChange.mock.calls[0]![0] as UpstreamEdit[];
    expect(edits).toHaveLength(1);
    expect(edits[0]!.id).toBe('edit-1');
    expect(edits[0]!.state).toBe('sending');
  });

  it('marks a job the server has never seen as pending on this device', () => {
    const { onChange, next } = subscribe();

    next(
      snapshotOf([
        { id: 'held', data: { studentId: 'pco_101' }, pending: true },
        { id: 'sent', data: { studentId: 'pco_101' }, pending: false },
      ]),
    );

    // Per document, and it is the whole of the offline branch: a queued job
    // held on the phone must not tell somebody it is already on its way.
    const edits = onChange.mock.calls[0]![0] as UpstreamEdit[];
    expect(edits[0]!.pendingOnDevice).toBe(true);
    expect(edits[1]!.pendingOnDevice).toBe(false);
  });

  it('reports an empty queue as an empty list rather than silence', () => {
    const { onChange, next } = subscribe();

    next(snapshotOf([]));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('passes a listen failure to the caller', () => {
    const onError = vi.fn();
    const { fail } = subscribe(vi.fn(), onError);
    const denied = new Error('permission-denied');

    fail(denied);

    expect(onError).toHaveBeenCalledWith(denied);
  });

  it('survives a caller that did not ask about failures', () => {
    const { fail } = subscribe();

    expect(() => fail(new Error('permission-denied'))).not.toThrow();
  });

  it('hands back the SDK unsubscribe', () => {
    const stop = vi.fn();
    onSnapshot.mockReturnValueOnce(stop);

    expect(subscribeUpstreamEdits(vi.fn())).toBe(stop);
  });
});

describe('reading a job written by a server that deploys separately', () => {
  it('carries every field across when they are all there', () => {
    const edit = toUpstreamEdit('edit-1', {
      studentId: 'pco_101',
      patch: { lastName: 'Chen-Ito' },
      baseline: { lastName: 'Chen' },
      state: 'differs',
      attempts: 3,
      nextAttemptAt: new FakeTimestamp(1_767_607_200),
      leaseUntil: new FakeTimestamp(1_767_607_260),
      failure: 'conflict',
      message: 'Somebody else changed the surname',
      field: 'lastName',
      observed: { lastName: 'Chen-Itoh' },
      survivorPersonId: '202',
      survivorName: 'Wei Chen-Itoh',
      createdAt: new FakeTimestamp(1_767_600_000),
      createdBy: 'dana',
      createdByName: 'Dana Ruiz',
      updatedAt: new FakeTimestamp(1_767_603_600),
      startedAt: new FakeTimestamp(1_767_600_060),
      settledAt: new FakeTimestamp(1_767_603_600),
    });

    expect(edit).toEqual({
      id: 'edit-1',
      studentId: 'pco_101',
      patch: { lastName: 'Chen-Ito' },
      baseline: { lastName: 'Chen' },
      state: 'differs',
      attempts: 3,
      nextAttemptAt: new Date(1_767_607_200_000),
      leaseUntil: new Date(1_767_607_260_000),
      failure: 'conflict',
      message: 'Somebody else changed the surname',
      field: 'lastName',
      observed: { lastName: 'Chen-Itoh' },
      survivorPersonId: '202',
      survivorName: 'Wei Chen-Itoh',
      createdAt: new Date(1_767_600_000_000),
      createdBy: 'dana',
      createdByName: 'Dana Ruiz',
      updatedAt: new Date(1_767_603_600_000),
      startedAt: new Date(1_767_600_060_000),
      settledAt: new Date(1_767_603_600_000),
      pendingOnDevice: false,
    });
  });

  it('reads an empty document without throwing', () => {
    const edit = toUpstreamEdit('edit-1', {});

    expect(edit.studentId).toBe('');
    expect(edit.patch).toEqual({});
    expect(edit.baseline).toEqual({});
    expect(edit.attempts).toBe(0);
    expect(edit.failure).toBeNull();
    expect(edit.message).toBeNull();
    expect(edit.field).toBeNull();
    expect(edit.observed).toBeNull();
    expect(edit.survivorPersonId).toBeNull();
    expect(edit.survivorName).toBeNull();
    expect(edit.nextAttemptAt).toBeNull();
    expect(edit.leaseUntil).toBeNull();
    expect(edit.startedAt).toBeNull();
    expect(edit.settledAt).toBeNull();
  });

  it('is not pending on this device unless the caller says so', () => {
    expect(toUpstreamEdit('edit-1', {}).pendingOnDevice).toBe(false);
    expect(toUpstreamEdit('edit-1', {}, true).pendingOnDevice).toBe(true);
  });

  describe('the state', () => {
    it('reads back each of the nine it knows', () => {
      for (const state of [
        'queued',
        'sending',
        'waiting',
        'landed',
        'differs',
        'merged',
        'failed',
        'orphaned',
        'cancelled',
      ]) {
        expect(toUpstreamEdit('edit-1', { state }).state).toBe(state);
      }
    });

    it('reads a state this bundle has never heard of as queued', () => {
      // A browser one deploy behind must not put an unknown word on a strip,
      // and `queued` is the state that reads as "on its way".
      expect(toUpstreamEdit('edit-1', { state: 'reticulating' }).state).toBe('queued');
    });

    it('reads a state that is not a string at all as queued', () => {
      expect(toUpstreamEdit('edit-1', { state: 7 }).state).toBe('queued');
      expect(toUpstreamEdit('edit-1', { state: null }).state).toBe('queued');
      expect(toUpstreamEdit('edit-1', { state: { state: 'queued' } }).state).toBe('queued');
    });
  });

  describe('the patch', () => {
    it('takes the six fields an edit is allowed to carry', () => {
      const patch = {
        firstName: 'Wei',
        nickname: 'Vee',
        lastName: 'Chen',
        grade: 9,
        allergies: 'Peanuts',
        birthday: '2011-03-14',
      };

      expect(toUpstreamEdit('edit-1', { patch }).patch).toEqual(patch);
    });

    it('drops a key a newer client wrote', () => {
      // Field by field rather than a spread: a document written by a newer
      // client must not smuggle a key this one would then hand to a form.
      const edit = toUpstreamEdit('edit-1', {
        patch: { lastName: 'Chen', pronouns: 'they/them', __proto__: { polluted: true } },
      });

      expect(edit.patch).toEqual({ lastName: 'Chen' });
    });

    it('keeps a field explicitly cleared apart from one not being edited', () => {
      // `null` means "empty this upstream" and `undefined` means "leave it
      // alone"; collapsing them would silently drop a deletion.
      const edit = toUpstreamEdit('edit-1', {
        patch: { allergies: null, lastName: undefined },
      });

      expect(edit.patch).toEqual({ allergies: null });
      expect('lastName' in edit.patch).toBe(false);
    });

    it('reads a patch that is not an object as no patch', () => {
      for (const nonsense of [null, undefined, 'lastName', 7, false]) {
        expect(toUpstreamEdit('edit-1', { patch: nonsense }).patch).toEqual({});
      }
    });

    it('reads an array as no patch rather than as its indices', () => {
      expect(toUpstreamEdit('edit-1', { patch: ['Chen'] }).patch).toEqual({});
    });

    it('reads what came back the same way it reads what was sent', () => {
      const edit = toUpstreamEdit('edit-1', {
        baseline: { lastName: 'Chen', pronouns: 'they/them' },
        observed: { lastName: 'Chen-Itoh', pronouns: 'they/them' },
      });

      expect(edit.baseline).toEqual({ lastName: 'Chen' });
      expect(edit.observed).toEqual({ lastName: 'Chen-Itoh' });
    });

    it('keeps "nothing came back" apart from "an empty thing came back"', () => {
      // `observed` is what the collision screen diffs against; an empty object
      // is a real answer and null is the absence of one.
      expect(toUpstreamEdit('edit-1', {}).observed).toBeNull();
      expect(toUpstreamEdit('edit-1', { observed: {} }).observed).toEqual({});
    });
  });

  describe('the times', () => {
    it('falls back to now for the two that a strip always shows', () => {
      const before = Date.now();
      const edit = toUpstreamEdit('edit-1', {});
      const after = Date.now();

      // A missing `createdAt` is a server write not yet acknowledged, and a
      // strip sorted by an epoch date would jump to the bottom of the list.
      expect(edit.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(edit.createdAt.getTime()).toBeLessThanOrEqual(after);
      expect(edit.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('reads a number of milliseconds as a date', () => {
      expect(toUpstreamEdit('edit-1', { startedAt: 1_767_600_000_000 }).startedAt).toEqual(
        new Date(1_767_600_000_000),
      );
    });

    it('reads a string date as no date', () => {
      // The sentinel `serverTimestamp()` and an unset field both arrive as
      // something that is not a Timestamp; guessing would put a fabricated
      // time on the strip.
      expect(toUpstreamEdit('edit-1', { startedAt: '2026-01-05T00:00:00Z' }).startedAt).toBeNull();
    });
  });

  describe('the author', () => {
    it('names somebody rather than nobody', () => {
      // The strip reads "Dana queued this"; an empty name reads as a bug.
      expect(toUpstreamEdit('edit-1', {}).createdByName).toBe('Somebody');
      expect(toUpstreamEdit('edit-1', { createdByName: 42 }).createdByName).toBe('Somebody');
      expect(toUpstreamEdit('edit-1', { createdByName: 'Dana' }).createdByName).toBe('Dana');
    });

    it('reads a missing uid as empty rather than as a name', () => {
      expect(toUpstreamEdit('edit-1', {}).createdBy).toBe('');
    });
  });

  it('reads attempts that are not a number as none', () => {
    expect(toUpstreamEdit('edit-1', { attempts: '3' }).attempts).toBe(0);
    expect(toUpstreamEdit('edit-1', { attempts: 0 }).attempts).toBe(0);
    expect(toUpstreamEdit('edit-1', { attempts: 3 }).attempts).toBe(3);
  });

  it('reads a failure code that is not a string as no failure', () => {
    expect(toUpstreamEdit('edit-1', { failure: 7 }).failure).toBeNull();
    expect(toUpstreamEdit('edit-1', { failure: 'conflict' }).failure).toBe('conflict');
  });
});
