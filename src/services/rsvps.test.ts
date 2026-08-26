/**
 * Who said they were coming to a one-off.
 *
 * With `requiresRsvp` set the list *is* the roster — only students on it appear
 * at check-in — so an add that silently dropped half a sign-up sheet would show
 * as children missing from the door, not as an error anybody sees.
 *
 * That is why the chunking is asserted at its boundary rather than in the
 * abstract. Firestore caps a batch at 500 writes; a retreat is forty students
 * and a bulk import from a sign-up sheet is not, and the failure mode of
 * getting the loop wrong is a batch that throws or a chunk that never runs.
 *
 * Firestore is mocked at the SDK boundary: these are claims about the writes
 * this module builds, and `firestore-tests` is where the rules those writes
 * have to satisfy are checked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addRsvps, removeRsvp, setRsvpStatus, subscribeRsvps } from '@/services/rsvps';

const set = vi.hoisted(() => vi.fn());
const commit = vi.hoisted(() => vi.fn(async () => {}));
const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const deleteDoc = vi.hoisted(() => vi.fn(async () => {}));
const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));
const writeBatch = vi.hoisted(() => vi.fn(() => ({ set, commit })));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  Timestamp: class {},
  doc: (_db: unknown, path: string) => ({ path }),
  collection: (_db: unknown, path: string) => ({ path }),
  onSnapshot,
  serverTimestamp: () => 'server-timestamp',
  writeBatch,
  updateDoc,
  deleteDoc,
}));

/** The path of every `set` in the batch, in the order they were written. */
function writtenPaths(): string[] {
  return set.mock.calls.map(([ref]) => (ref as { path: string }).path);
}

beforeEach(() => {
  set.mockClear();
  commit.mockClear();
  updateDoc.mockClear();
  deleteDoc.mockClear();
  onSnapshot.mockClear();
  writeBatch.mockClear();
});

describe('subscribeRsvps', () => {
  it('listens to the list under the gathering it belongs to', () => {
    subscribeRsvps('event-1', () => {});

    const [source] = onSnapshot.mock.calls.at(-1) as unknown as [{ path: string }];
    expect(source.path).toBe('events/event-1/rsvps');
  });

  it('publishes what the snapshot held', () => {
    let held: { id: string }[] = [];
    subscribeRsvps('event-1', (next) => {
      held = next;
    });

    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: unknown) => void,
    ];
    onNext({
      docs: [
        {
          id: 'pco_1',
          data: () => ({ studentId: 'pco_1', status: 'yes' }),
          metadata: { hasPendingWrites: false },
        },
      ],
    });

    expect(held.map((rsvp) => rsvp.id)).toEqual(['pco_1']);
  });

  it('forwards a refused read to the caller', () => {
    const onError = vi.fn();
    subscribeRsvps('event-1', () => {}, onError);

    const [, , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (cause: Error) => void,
    ];
    const refusal = new Error('Missing or insufficient permissions.');
    handler(refusal);

    expect(onError).toHaveBeenCalledWith(refusal);
  });

  it('survives a refused read with nobody listening for it', () => {
    subscribeRsvps('event-1', () => {});

    const [, , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (cause: Error) => void,
    ];

    expect(() => handler(new Error('refused'))).not.toThrow();
  });
});

describe('addRsvps', () => {
  it('writes one document per student, keyed by student id', async () => {
    await addRsvps('event-1', ['pco_1', 'pco_2'], 'uid-leader');

    expect(writtenPaths()).toEqual([
      'events/event-1/rsvps/pco_1',
      'events/event-1/rsvps/pco_2',
    ]);
  });

  it('records who is expected, who said so, and when', async () => {
    await addRsvps('event-1', ['pco_1'], 'uid-leader');

    const [, payload, options] = set.mock.calls[0] ?? [];
    expect(payload).toEqual({
      studentId: 'pco_1',
      eventId: 'event-1',
      status: 'yes',
      notes: null,
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-leader',
    });
    // Merged, so re-running a sign-up sheet does not blank a note somebody
    // added on the RSVP screen afterwards.
    expect(options).toEqual({ merge: true });
  });

  it('says yes unless the caller says otherwise', async () => {
    await addRsvps('event-1', ['pco_1'], 'uid-leader');
    expect((set.mock.calls[0]?.[1] as { status: string }).status).toBe('yes');
  });

  it('honours a status the caller chose', async () => {
    await addRsvps('event-1', ['pco_1'], 'uid-leader', 'no');
    expect((set.mock.calls[0]?.[1] as { status: string }).status).toBe('no');
  });

  it('commits one batch for a list that fits in one', async () => {
    await addRsvps('event-1', ['pco_1', 'pco_2'], 'uid-leader');

    expect(writeBatch).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('still commits one batch at exactly the chunk size', async () => {
    // 400 is the boundary: one more and the loop has to go round again.
    const students = Array.from({ length: 400 }, (_, index) => `pco_${index}`);

    await addRsvps('event-1', students, 'uid-leader');

    expect(writeBatch).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledTimes(400);
  });

  it('splits a list that does not fit, and writes every student exactly once', async () => {
    const students = Array.from({ length: 401 }, (_, index) => `pco_${index}`);

    await addRsvps('event-1', students, 'uid-leader');

    expect(writeBatch).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(new Set(writtenPaths()).size).toBe(401);
    expect(writtenPaths().at(-1)).toBe('events/event-1/rsvps/pco_400');
  });

  it('writes nothing at all for an empty list', async () => {
    await addRsvps('event-1', [], 'uid-leader');

    expect(writeBatch).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

describe('setRsvpStatus', () => {
  it('changes the status without touching anything else', async () => {
    await setRsvpStatus('event-1', 'pco_1', 'maybe', 'uid-leader');

    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'events/event-1/rsvps/pco_1' },
      { status: 'maybe', updatedAt: 'server-timestamp', updatedBy: 'uid-leader' },
    );
  });
});

describe('removeRsvp', () => {
  it('deletes the one document', async () => {
    await removeRsvp('event-1', 'pco_1');

    expect(deleteDoc).toHaveBeenCalledWith({ path: 'events/event-1/rsvps/pco_1' });
  });
});
