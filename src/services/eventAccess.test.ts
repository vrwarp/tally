/**
 * Who may work each gathering, and how that list is edited without two phones
 * undoing each other.
 *
 * Every write here except the one that closes a gathering is a Firestore
 * transform — `arrayUnion`, `arrayRemove` — and that is the claim most worth
 * pinning. Two people plausibly hold this sheet at once: Miriam trimming the
 * list on the event page while Priya adds a volunteer at the door. A wholesale
 * rewrite of `members` means whichever phone saves second silently undoes the
 * other, and nobody sees it happen.
 *
 * The one that closes a gathering, `restrictChain`, is the write that cannot
 * be a transform — the person may have unticked somebody, and a union would put
 * them back — so it is a transaction, and the claim pinned here is the one that
 * matters: it reads the document first and never erases anybody it was not
 * shown. It used to be a merged `setDoc`, and a merge replaces an array
 * wholesale, so re-closing a reopened gathering silently threw away the kept
 * list. That is the bug these tests exist to keep dead.
 *
 * The other half is `recentRegisterTakers`, which is the safety net under the
 * one mistake this feature makes easiest: restricting *Friday Fellowship*, the
 * gathering the whole ministry works, in three taps. Starting the list from
 * whoever has actually been taking the register makes the default outcome of a
 * mis-tap "no change" rather than "the ministry is locked out of Friday".
 *
 * Firestore is mocked at the SDK boundary; `firestore-tests` is where the rules
 * these writes have to satisfy are checked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addChainMembers,
  recentRegisterTakers,
  removeChainMember,
  reopenChain,
  restrictChain,
  subscribeEventAccess,
} from '@/services/eventAccess';
import type { EventAccess } from '@/types';

const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));
const fetchAttendance = vi.hoisted(() => vi.fn());

/**
 * The transaction, as the three calls `restrictChain` makes on it.
 *
 * `stored` is what the document holds when the transaction reads it —
 * `undefined` for a gathering nobody has restricted before. The fake runs the
 * body once and records what it wrote; there is no retry, because the claims
 * here are about what is written, not about contention.
 */
const transaction = vi.hoisted(() => ({
  stored: undefined as Record<string, unknown> | undefined,
  set: vi.fn(),
  update: vi.fn(),
}));
const runTransaction = vi.hoisted(() =>
  vi.fn(async (_db: unknown, body: (tx: unknown) => Promise<void>) => {
    await body({
      get: async () => ({
        exists: () => transaction.stored !== undefined,
        data: () => transaction.stored,
      }),
      set: transaction.set,
      update: transaction.update,
    });
  }),
);

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/services/attendance', () => ({ fetchAttendance }));
vi.mock('firebase/firestore', () => ({
  Timestamp: class {
    constructor(readonly seconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
  doc: (_db: unknown, path: string) => ({ path }),
  collection: (_db: unknown, path: string) => ({ path }),
  onSnapshot,
  serverTimestamp: () => 'server-timestamp',
  runTransaction,
  updateDoc,
  arrayUnion: (...values: string[]) => ({ union: values }),
  arrayRemove: (...values: string[]) => ({ remove: values }),
}));

/** Runs the subscription and hands back the map it published. */
function published(docs: { id: string; data: Record<string, unknown> | undefined }[]) {
  let held = new Map<string, EventAccess>();
  subscribeEventAccess((next) => {
    held = next;
  });
  const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
    unknown,
    (snapshot: unknown) => void,
  ];
  onNext({ docs: docs.map((entry) => ({ id: entry.id, data: () => entry.data })) });
  return held;
}

/** What the transaction created, when it created rather than updated. */
function created() {
  const call = transaction.set.mock.calls.at(-1) as unknown[] | undefined;
  const ref = call?.[0];
  const data = call?.[1];
  return {
    path: (ref as { path: string } | undefined)?.path,
    data: data as Record<string, unknown>,
  };
}

/** What the transaction wrote over a document that already existed. */
function amended() {
  const call = transaction.update.mock.calls.at(-1) as unknown[] | undefined;
  const ref = call?.[0];
  const data = call?.[1];
  return {
    path: (ref as { path: string } | undefined)?.path,
    data: data as Record<string, unknown>,
  };
}

function updated() {
  const call = updateDoc.mock.calls.at(-1) as unknown[] | undefined;
  const ref = call?.[0];
  const data = call?.[1];
  return {
    path: (ref as { path: string } | undefined)?.path,
    data: data as Record<string, unknown>,
  };
}

beforeEach(() => {
  transaction.stored = undefined;
  transaction.set.mockClear();
  transaction.update.mockClear();
  runTransaction.mockClear();
  updateDoc.mockClear();
  onSnapshot.mockClear();
  fetchAttendance.mockReset();
});

describe('reading the access lists', () => {
  it('watches the whole collection rather than a query', () => {
    // The client has to know about a gathering it is *not* on in order to draw
    // the locked row, so "only mine" would be exactly the wrong selection.
    subscribeEventAccess(() => {});

    const [source] = onSnapshot.mock.calls.at(-1) as unknown as [{ path: string }];
    expect(source.path).toBe('eventAccess');
  });

  it('keys the map by chain, which is what every caller has', () => {
    const access = published([
      { id: 'friday-fellowship', data: { restricted: true, members: ['uid-priya'] } },
    ]);

    expect([...access.keys()]).toEqual(['friday-fellowship']);
    expect(access.get('friday-fellowship')?.chainKey).toBe('friday-fellowship');
  });

  it('reads a restricted gathering as restricted', () => {
    const access = published([{ id: 'friday', data: { restricted: true, members: ['uid-priya'] } }]);

    expect(access.get('friday')?.restricted).toBe(true);
    expect(access.get('friday')?.members.has('uid-priya')).toBe(true);
  });

  it('treats anything but a true flag as open', () => {
    // A document written by an older version, or by hand, must not close a
    // gathering on the strength of a truthy string.
    for (const restricted of [undefined, false, 'true', 1, null]) {
      const access = published([{ id: 'friday', data: { restricted } }]);
      expect(access.get('friday')?.restricted).toBe(false);
    }
  });

  it('reads a document with no members as a gathering nobody is on', () => {
    // Which is refused rather than opened: `restricted` is the switch, and an
    // empty list is somebody's mistake, not a second switch.
    const access = published([{ id: 'friday', data: { restricted: true } }]);

    expect(access.get('friday')?.members.size).toBe(0);
    expect(access.get('friday')?.restricted).toBe(true);
  });

  it('ignores a members field that is not a list', () => {
    const access = published([{ id: 'friday', data: { restricted: true, members: 'uid-priya' } }]);

    expect(access.get('friday')?.members.size).toBe(0);
  });

  it('drops entries in the list that are not uids', () => {
    const access = published([
      { id: 'friday', data: { restricted: true, members: ['uid-priya', 42, null, { a: 1 }] } },
    ]);

    expect([...(access.get('friday')?.members ?? [])]).toEqual(['uid-priya']);
  });

  it('holds the members as a set, because the sheet asks per keystroke', () => {
    const access = published([
      { id: 'friday', data: { restricted: true, members: ['uid-priya', 'uid-priya'] } },
    ]);

    expect(access.get('friday')?.members).toBeInstanceOf(Set);
    expect(access.get('friday')?.members.size).toBe(1);
  });

  it('reads a missing document as an empty one rather than throwing', () => {
    const access = published([{ id: 'friday', data: undefined }]);

    expect(access.get('friday')?.restricted).toBe(false);
    expect(access.get('friday')?.updatedBy).toBe('');
    expect(access.get('friday')?.updatedAt).toBeNull();
  });

  it('has no author when the field is not text', () => {
    const access = published([{ id: 'friday', data: { updatedBy: 7 } }]);

    expect(access.get('friday')?.updatedBy).toBe('');
  });

  it('names the author when there is one', () => {
    const access = published([{ id: 'friday', data: { updatedBy: 'uid-miriam' } }]);

    expect(access.get('friday')?.updatedBy).toBe('uid-miriam');
  });

  it('forwards a refused read to the caller', () => {
    const onError = vi.fn();
    subscribeEventAccess(() => {}, onError);

    const [, , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      ((cause: Error) => void) | undefined,
    ];
    expect(handler).toBe(onError);
  });
});

describe('recentRegisterTakers', () => {
  it('collects everybody who took the register on the nights it read', async () => {
    fetchAttendance.mockImplementation(async (eventId: string) =>
      eventId === 'night-1'
        ? [{ checkedInBy: 'uid-priya' }, { checkedInBy: 'uid-jo' }]
        : [{ checkedInBy: 'uid-priya' }],
    );

    await expect(recentRegisterTakers([{ id: 'night-1' }, { id: 'night-2' }])).resolves.toEqual(
      new Set(['uid-priya', 'uid-jo']),
    );
  });

  it('keeps opening the sheet when one night cannot be read', async () => {
    // A shorter suggestion is better than none, and the person can add anybody.
    fetchAttendance.mockImplementation(async (eventId: string) => {
      if (eventId === 'night-1') throw new Error('refused');
      return [{ checkedInBy: 'uid-jo' }];
    });

    await expect(recentRegisterTakers([{ id: 'night-1' }, { id: 'night-2' }])).resolves.toEqual(
      new Set(['uid-jo']),
    );
  });

  it('reads nothing when there are no nights to read', async () => {
    await expect(recentRegisterTakers([])).resolves.toEqual(new Set());
    expect(fetchAttendance).not.toHaveBeenCalled();
  });

  it('does not try to guess which of these is a person', async () => {
    // An import writes `checkedInBy: 'planning-center'`. Firebase uids are
    // opaque and that string would survive most guesses at their shape, so the
    // caller intersects with the team directory instead.
    fetchAttendance.mockResolvedValue([
      { checkedInBy: 'planning-center' },
      { checkedInBy: 'uid-priya' },
    ]);

    await expect(recentRegisterTakers([{ id: 'night-1' }])).resolves.toEqual(
      new Set(['planning-center', 'uid-priya']),
    );
  });
});

describe('restrictChain', () => {
  it('writes the document that closes a gathering', async () => {
    await restrictChain('friday-fellowship', ['uid-priya'], 'uid-miriam');

    expect(created().path).toBe('eventAccess/friday-fellowship');
    expect(created().data).toMatchObject({
      chainKey: 'friday-fellowship',
      restricted: true,
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-miriam',
    });
  });

  it('always puts the person doing it on the list', async () => {
    // The rules refuse a write that closes a door from outside it, because
    // nobody below an admin could then reopen it.
    await restrictChain('friday', ['uid-priya'], 'uid-miriam');

    expect(created().data.members).toEqual(['uid-priya', 'uid-miriam']);
  });

  it('does not name them twice when they were already on it', async () => {
    await restrictChain('friday', ['uid-priya', 'uid-miriam'], 'uid-miriam');

    expect(created().data.members).toEqual(['uid-priya', 'uid-miriam']);
  });

  it('runs as a transaction that reads the document before writing it', async () => {
    await restrictChain('friday', ['uid-priya'], 'uid-miriam');

    expect(runTransaction).toHaveBeenCalledTimes(1);
    // A gathering nobody has restricted before is written whole, as chosen.
    expect(transaction.set).toHaveBeenCalledTimes(1);
    expect(transaction.update).not.toHaveBeenCalled();
  });

  it('closes a reopened gathering with an update, not a fresh document', async () => {
    transaction.stored = { chainKey: 'friday', restricted: false, members: ['uid-priya'] };

    await restrictChain('friday', ['uid-priya'], 'uid-miriam', ['uid-priya']);

    expect(transaction.set).not.toHaveBeenCalled();
    expect(amended().path).toBe('eventAccess/friday');
    expect(amended().data).toEqual({
      restricted: true,
      members: ['uid-priya', 'uid-miriam'],
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-miriam',
    });
  });

  it('keeps whoever was added while the sheet was open', async () => {
    // Priya added Jo at the door sixty seconds ago; Miriam's sheet, opened
    // before that, never showed Jo. A Tuesday decision must not erase her.
    transaction.stored = { restricted: false, members: ['uid-priya', 'uid-jo'] };

    await restrictChain('friday', ['uid-priya'], 'uid-miriam', ['uid-priya']);

    expect(amended().data.members).toEqual(['uid-priya', 'uid-miriam', 'uid-jo']);
  });

  it('lets a deliberate untick stand', async () => {
    // Sam was on the kept list when the sheet opened and Miriam unticked him.
    // He was seen, so leaving him off is the trim she asked for.
    transaction.stored = { restricted: false, members: ['uid-priya', 'uid-sam'] };

    await restrictChain('friday', ['uid-priya'], 'uid-miriam', ['uid-priya', 'uid-sam']);

    expect(amended().data.members).toEqual(['uid-priya', 'uid-miriam']);
  });

  it('keeps everybody on a document the sheet never saw at all', async () => {
    // Opened on an open gathering with no document; somebody else restricted
    // it in the meantime. Nothing in `seenAtOpen`, so every name is kept.
    transaction.stored = { restricted: true, members: ['uid-dana'] };

    await restrictChain('friday', ['uid-priya'], 'uid-miriam');

    expect(amended().data.members).toEqual(['uid-priya', 'uid-miriam', 'uid-dana']);
  });

  it('ignores a stored list that is not a list of uids', async () => {
    transaction.stored = { restricted: false, members: ['uid-jo', 42, null] };

    await restrictChain('friday', [], 'uid-miriam');

    expect(amended().data.members).toEqual(['uid-miriam', 'uid-jo']);
  });
});

describe('reopenChain', () => {
  it('flips the switch and keeps the list', async () => {
    // Deliberately not a delete — the rules refuse that outright, and changing
    // your mind twice should not mean rebuilding four names from memory.
    await reopenChain('friday', 'uid-miriam');

    expect(updated().path).toBe('eventAccess/friday');
    expect(updated().data).toEqual({
      restricted: false,
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-miriam',
    });
    expect(updated().data).not.toHaveProperty('members');
  });
});

describe('addChainMembers', () => {
  it('adds without rewriting the list', async () => {
    // Two phones hold this sheet at once. A wholesale rewrite means whichever
    // saves second silently undoes the other.
    await addChainMembers('friday', ['uid-jo'], 'uid-priya');

    expect(updated().path).toBe('eventAccess/friday');
    expect(updated().data).toEqual({
      members: { union: ['uid-jo'] },
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-priya',
    });
  });

  it('adds several at once', async () => {
    await addChainMembers('friday', ['uid-jo', 'uid-sam'], 'uid-priya');

    expect(updated().data.members).toEqual({ union: ['uid-jo', 'uid-sam'] });
  });

  it('writes nothing at all when nobody was chosen', async () => {
    // Otherwise an empty save stamps `updatedBy` and moves the timestamp for a
    // change that did not happen.
    await addChainMembers('friday', [], 'uid-priya');

    expect(updateDoc).not.toHaveBeenCalled();
  });
});

describe('removeChainMember', () => {
  it('removes without rewriting the list', async () => {
    await removeChainMember('friday', 'uid-jo', 'uid-miriam');

    expect(updated().path).toBe('eventAccess/friday');
    expect(updated().data).toEqual({
      members: { remove: ['uid-jo'] },
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-miriam',
    });
  });

  it('takes one person off, not the person asking', async () => {
    // Not symmetric with adding: handing over access you hold is one thing,
    // evicting the person who set the gathering up is another.
    await removeChainMember('friday', 'uid-jo', 'uid-miriam');

    expect(updated().data.members).toEqual({ remove: ['uid-jo'] });
  });
});
