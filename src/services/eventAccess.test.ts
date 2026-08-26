/**
 * Who may work each gathering, and how that list is edited without two phones
 * undoing each other.
 *
 * Every write here except the one that creates the document is a Firestore
 * transform — `arrayUnion`, `arrayRemove` — and that is the claim most worth
 * pinning. Two people plausibly hold this sheet at once: Miriam trimming the
 * list on the event page while Priya adds a volunteer at the door. A wholesale
 * rewrite of `members` means whichever phone saves second silently undoes the
 * other, and nobody sees it happen.
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

const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));
const fetchAttendance = vi.hoisted(() => vi.fn());

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
  setDoc,
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

function written() {
  const call = setDoc.mock.calls.at(-1) as unknown[] | undefined;
  const ref = call?.[0];
  const data = call?.[1];
  const options = call?.[2];
  return {
    path: (ref as { path: string } | undefined)?.path,
    data: data as Record<string, unknown>,
    options: options as Record<string, unknown>,
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
  setDoc.mockClear();
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

    expect(written().path).toBe('eventAccess/friday-fellowship');
    expect(written().data).toMatchObject({
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

    expect(written().data.members).toEqual(['uid-priya', 'uid-miriam']);
  });

  it('does not name them twice when they were already on it', async () => {
    await restrictChain('friday', ['uid-priya', 'uid-miriam'], 'uid-miriam');

    expect(written().data.members).toEqual(['uid-priya', 'uid-miriam']);
  });

  it('merges, so closing a gathering again does not lose an earlier round', async () => {
    await restrictChain('friday', ['uid-priya'], 'uid-miriam');

    expect(written().options).toEqual({ merge: true });
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
