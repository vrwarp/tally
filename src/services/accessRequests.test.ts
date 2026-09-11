/**
 * Asking to be added, and the two properties that keep it from becoming a
 * queue nobody promised to work.
 *
 * The first is that one press and ten presses are the same document — the id
 * is the pair — so a counselor who taps twice at a door does not put two of
 * their own names on somebody else's roster. The second is that clearing marks
 * rather than deletes, and the reader that has to see the mark is the *asker*:
 * without it their screen cannot tell "nobody has looked" from "somebody has
 * said no", which is the difference between walking over and pressing again.
 *
 * Firestore is mocked at the SDK boundary; `firestore-tests` is where the rules
 * these writes have to satisfy are checked.
 */
import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  ACCESS_REQUEST_LIFE_MS,
  askToBeAdded,
  clearAccessRequest,
  isOutstanding,
  subscribeChainRequests,
} from '@/services/accessRequests';
import type { AccessRequest } from '@/types';

const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  // `toDateOrNull` in `@/services/converters` narrows on this before reading a
  // `toDate()`, so the mock has to carry a constructor for it to fail against.
  Timestamp: class {
    constructor(readonly seconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
  doc: (_db: unknown, path: string) => ({ path }),
  collection: (_db: unknown, path: string) => ({ path }),
  query: (source: { path: string }, ...constraints: unknown[]) => ({
    path: source.path,
    constraints,
  }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  serverTimestamp: () => 'server-timestamp',
  onSnapshot,
  setDoc,
  updateDoc,
}));

/** The last write, as `{ path, data }`. */
function written(spy: typeof setDoc | typeof updateDoc) {
  const call = spy.mock.calls.at(-1) as unknown[] | undefined;
  return {
    path: (call?.[0] as { path?: string } | undefined)?.path,
    data: call?.[1] as Record<string, unknown> | undefined,
  };
}

function request(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    id: 'sunday-school__uid-sam',
    chainKey: 'sunday-school',
    uid: 'uid-sam',
    name: 'Sam Whitfield',
    askedAt: new Date('2026-09-06T18:00:00Z'),
    clearedBy: null,
    clearedAt: null,
    ...overrides,
  };
}

describe('askToBeAdded', () => {
  it('addresses one document per pair, so pressing twice is one ask', async () => {
    await askToBeAdded('sunday-school', 'uid-sam', 'Sam Whitfield');
    await askToBeAdded('sunday-school', 'uid-sam', 'Sam Whitfield');

    expect(setDoc).toHaveBeenCalledTimes(2);
    expect(written(setDoc).path).toBe('accessRequests/sunday-school__uid-sam');
    expect(written(setDoc).data).toMatchObject({
      chainKey: 'sunday-school',
      uid: 'uid-sam',
      name: 'Sam Whitfield',
      askedAt: 'server-timestamp',
    });
  });

  it('writes no clear of its own — a new ask is outstanding by construction', async () => {
    await askToBeAdded('sunday-school', 'uid-sam', 'Sam Whitfield');
    expect(written(setDoc).data).not.toHaveProperty('clearedBy');
    expect(written(setDoc).data).not.toHaveProperty('clearedAt');
  });

  it('bounds the name, which is denormalised onto somebody else’s roster', async () => {
    await askToBeAdded('sunday-school', 'uid-sam', 'x'.repeat(400));
    expect((written(setDoc).data?.name as string).length).toBe(120);
  });
});

describe('clearAccessRequest', () => {
  it('marks the row rather than deleting it, in the clearer’s own name', async () => {
    await clearAccessRequest('sunday-school', 'uid-sam', 'uid-miriam');

    expect(written(updateDoc).path).toBe('accessRequests/sunday-school__uid-sam');
    expect(written(updateDoc).data).toEqual({
      clearedBy: 'uid-miriam',
      clearedAt: 'server-timestamp',
    });
  });
});

describe('subscribeChainRequests', () => {
  it('asks for one gathering’s rows, cleared ones included', () => {
    // The asker's own screen is the one place that has to say a clear
    // happened, so filtering them out here would leave it unable to tell that
    // from silence.
    subscribeChainRequests('sunday-school', () => {});

    const [source] = onSnapshot.mock.calls.at(-1) as unknown as [
      { path: string; constraints: unknown[] },
    ];
    expect(source.path).toBe('accessRequests');
    expect(source.constraints).toEqual([
      { field: 'chainKey', op: '==', value: 'sunday-school' },
    ]);
  });

  it('reads a stored row defensively', () => {
    let held: AccessRequest[] = [];
    subscribeChainRequests('sunday-school', (next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({
      docs: [
        {
          id: 'sunday-school__uid-sam',
          // A row written by a build that is not this one: every field absent.
          data: () => ({}),
        },
      ],
    });

    expect(held[0]).toEqual({
      id: 'sunday-school__uid-sam',
      chainKey: '',
      uid: '',
      name: '',
      askedAt: null,
      clearedAt: null,
      clearedBy: null,
    });
  });

  it('reads a full row back whole', () => {
    /*
     * The other half of the defensive read above. Asserting only the empty
     * document lets an implementation that answered its own defaults for every
     * field pass — and the name is the only thing identifying the adult the
     * sheet is about to put on a gathering of minors.
     */
    let held: AccessRequest[] = [];
    subscribeChainRequests('sunday-school', (next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({
      docs: [
        {
          id: 'sunday-school__uid-sam',
          data: () => ({
            chainKey: 'sunday-school',
            uid: 'uid-sam',
            name: 'Sam Whitfield',
            askedAt: new Timestamp(1_767_607_200, 0),
            clearedBy: 'uid-miriam',
            clearedAt: new Timestamp(1_767_610_800, 0),
          }),
        },
      ],
    });

    expect(held[0]).toEqual({
      id: 'sunday-school__uid-sam',
      chainKey: 'sunday-school',
      uid: 'uid-sam',
      name: 'Sam Whitfield',
      askedAt: new Date(1_767_607_200_000),
      clearedBy: 'uid-miriam',
      clearedAt: new Date(1_767_610_800_000),
    });
  });

  it('answers the defaults for a field stored as the wrong type', () => {
    let held: AccessRequest[] = [];
    subscribeChainRequests('sunday-school', (next) => {
      held = next;
    });
    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snapshot: { docs: { id: string; data: () => Record<string, unknown> }[] }) => void,
    ];

    onNext({
      docs: [{ id: 'row', data: () => ({ chainKey: 1, uid: 2, name: 3, clearedBy: 4 }) }],
    });

    expect(held[0]).toMatchObject({ chainKey: '', uid: '', name: '', clearedBy: null });
  });

  it('hands a refusal to the caller, and survives not having one to hand it to', () => {
    /*
     * Nothing waits on an ask, so a dropped listener has to leave the screen
     * exactly as it was before asks existed — which is why the callers pass an
     * `onError` that swallows to `[]`, and why one that does not pass one at
     * all must not throw inside the snapshot callback.
     */
    const onError = vi.fn();
    subscribeChainRequests('sunday-school', () => {}, onError);
    const [, , failed] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (error: Error) => void,
    ];
    const refusal = new Error('permission-denied');
    failed(refusal);
    expect(onError).toHaveBeenCalledWith(refusal);

    subscribeChainRequests('sunday-school', () => {});
    const [, , failedAgain] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (error: Error) => void,
    ];
    expect(() => failedAgain(refusal)).not.toThrow();
  });
});

describe('isOutstanding', () => {
  const nowMs = new Date('2026-09-06T19:00:00Z').getTime();

  it('is false once somebody has answered it', () => {
    expect(isOutstanding(request(), nowMs)).toBe(true);
    expect(
      isOutstanding(request({ clearedBy: 'uid-miriam', clearedAt: new Date(nowMs) }), nowMs),
    ).toBe(false);
  });

  it('is false for an ask about a night that has passed', () => {
    // An ask is about tonight. The nightly sweep removes these, but a roster
    // open across the boundary must not show one in the meantime.
    const stale = new Date(nowMs - ACCESS_REQUEST_LIFE_MS - 1);
    expect(isOutstanding(request({ askedAt: stale }), nowMs)).toBe(false);
  });

  it('is false exactly at the week, and true a millisecond inside it', () => {
    // The boundary is the whole of what the constant means: `<=` would keep an
    // ask alive for one more millisecond than the sweep that deletes it does.
    expect(
      isOutstanding(request({ askedAt: new Date(nowMs - ACCESS_REQUEST_LIFE_MS) }), nowMs),
    ).toBe(false);
    expect(
      isOutstanding(request({ askedAt: new Date(nowMs - ACCESS_REQUEST_LIFE_MS + 1) }), nowMs),
    ).toBe(true);
  });

  it('trusts a row whose moment has not landed yet', () => {
    // A locally-pending `serverTimestamp()` reads back as null until the server
    // acknowledges, and the press that made it was a second ago.
    expect(isOutstanding(request({ askedAt: null }), nowMs)).toBe(true);
  });
});
