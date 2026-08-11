/**
 * When the browser asks a server to send an edit, and what happens when it
 * cannot.
 *
 * The queue used to be started by a Firestore trigger. It is started by the
 * device that made the edit now, which is faster and one moving part fewer —
 * and which introduces exactly one way to get it wrong: asking for the drain
 * before the job has reached a server. A poke that overtakes its own job finds
 * nothing to do and the edit waits for the sweep, which is the latency the
 * poke exists to avoid, and nothing fails loudly when it happens.
 *
 * So these are about ordering rather than about the write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setDoc = vi.hoisted(() => vi.fn());
const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const drainStudentEdits = vi.hoisted(() => vi.fn(async () => ({ data: { states: [] } })));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({ id: 'edit-1' })),
  setDoc,
  updateDoc,
  serverTimestamp: () => 'ts',
  onSnapshot: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  Timestamp: class {},
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/functions', () => ({ drainStudentEdits }));

const { enqueueUpstreamEdit, pokeUpstreamDrain, retryUpstreamEdit } = await import(
  '@/services/upstreamEdits'
);

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
