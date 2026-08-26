/**
 * The document that decides what somebody may do.
 *
 * A Firebase Auth account grants nothing. `users/{uid}` is what the security
 * rules read on every request, so a revoked counselor loses access on their
 * next operation rather than at their next sign-in — which is why the profile
 * is watched rather than fetched.
 *
 * Two details here are load-bearing and neither is obvious:
 *
 * `includeMetadataChanges`. "No document, from the local cache" and "no
 * document, confirmed by the server" carry identical data and opposite
 * meanings — *not yet* against *not authorised*. Without the flag the SDK calls
 * the move between them a metadata-only change and never delivers it, and a
 * counselor whose first read missed stays locked out until they think to
 * reload.
 *
 * And `createdAt` is written once, ever. It is the record of when somebody
 * joined the team, and an edit that re-stamped it would quietly rewrite that.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getUserProfileFromServer,
  subscribeUserProfile,
  subscribeUsers,
  touchLastSeen,
  upsertUser,
} from '@/services/users';
import type { UserProfile } from '@/types';

const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));
const getDoc = vi.hoisted(() => vi.fn());
const getDocFromServer = vi.hoisted(() => vi.fn());
const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const orderBy = vi.hoisted(() => vi.fn((field: string) => ({ orderBy: field })));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
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
  orderBy,
  onSnapshot,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp: () => 'server-timestamp',
}));

/** A profile document as Firestore hands it over. */
function snapshot(data: Record<string, unknown> | null, fromCache = false) {
  return {
    id: 'uid-miriam',
    exists: () => data !== null,
    data: () => data ?? undefined,
    metadata: { fromCache, hasPendingWrites: false },
  };
}

function written() {
  const [ref, data, options] = setDoc.mock.calls.at(-1) ?? [];
  return {
    path: (ref as { path: string } | undefined)?.path,
    data: data as Record<string, unknown>,
    options: options as Record<string, unknown>,
  };
}

beforeEach(() => {
  onSnapshot.mockClear();
  getDoc.mockReset();
  getDocFromServer.mockReset();
  setDoc.mockClear();
  updateDoc.mockReset().mockResolvedValue(undefined);
  orderBy.mockClear();
});

describe('subscribeUserProfile', () => {
  it('watches the one document the rules read', () => {
    subscribeUserProfile('uid-miriam', () => {});

    const [ref] = onSnapshot.mock.calls.at(-1) as unknown as [{ path: string }];
    expect(ref.path).toBe('users/uid-miriam');
  });

  it('asks for metadata changes, which is what makes a cache miss recoverable', () => {
    subscribeUserProfile('uid-miriam', () => {});

    const [, options] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      { includeMetadataChanges: boolean },
    ];
    expect(options).toEqual({ includeMetadataChanges: true });
  });

  it('publishes the profile and says where the answer came from', () => {
    const seen: { profile: UserProfile | null; fromCache: boolean }[] = [];
    subscribeUserProfile('uid-miriam', (profile, source) =>
      seen.push({ profile, fromCache: source.fromCache }),
    );

    const [, , onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (snap: unknown) => void,
    ];
    onNext(snapshot({ email: 'miriam@example.org', role: 'core', active: true }));

    expect(seen[0]?.profile?.email).toBe('miriam@example.org');
    expect(seen[0]?.fromCache).toBe(false);
  });

  it('reports an absence from the cache as an absence from the cache', () => {
    // *Not yet*, not *not authorised*. The caller is the one that has to tell
    // those apart, so this has to hand it both facts.
    const seen: { profile: UserProfile | null; fromCache: boolean }[] = [];
    subscribeUserProfile('uid-miriam', (profile, source) =>
      seen.push({ profile, fromCache: source.fromCache }),
    );

    const [, , onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (snap: unknown) => void,
    ];
    onNext(snapshot(null, true));

    expect(seen[0]?.profile).toBeNull();
    expect(seen[0]?.fromCache).toBe(true);
  });

  it('forwards a refused read to the caller', () => {
    const onError = vi.fn();
    subscribeUserProfile('uid-miriam', () => {}, onError);

    const [, , , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      unknown,
      (cause: Error) => void,
    ];
    const refusal = new Error('Missing or insufficient permissions.');
    handler(refusal);

    expect(onError).toHaveBeenCalledWith(refusal);
  });

  it('survives a refused read with nobody listening for it', () => {
    subscribeUserProfile('uid-miriam', () => {});

    const [, , , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      unknown,
      (cause: Error) => void,
    ];

    expect(() => handler(new Error('refused'))).not.toThrow();
  });
});

describe('getUserProfileFromServer', () => {
  it('goes past the cache, because a cached absence is what got it here', () => {
    getDocFromServer.mockResolvedValue(snapshot({ email: 'miriam@example.org' }));

    void getUserProfileFromServer('uid-miriam');

    expect(getDocFromServer).toHaveBeenCalledWith({ path: 'users/uid-miriam' });
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('hands back the profile', async () => {
    getDocFromServer.mockResolvedValue(
      snapshot({ email: 'miriam@example.org', role: 'admin', active: true }),
    );

    await expect(getUserProfileFromServer('uid-miriam')).resolves.toMatchObject({
      email: 'miriam@example.org',
      role: 'admin',
    });
  });

  it('hands back nothing for somebody with no document', async () => {
    getDocFromServer.mockResolvedValue(snapshot(null));

    await expect(getUserProfileFromServer('uid-miriam')).resolves.toBeNull();
  });
});

describe('subscribeUsers', () => {
  it('reads the team in address order', () => {
    subscribeUsers(() => {});

    const [source] = onSnapshot.mock.calls.at(-1) as unknown as [{ path: string }];
    expect(source.path).toBe('users');
    expect(orderBy).toHaveBeenCalledWith('email');
  });

  it('publishes every profile the snapshot held', () => {
    let held: UserProfile[] = [];
    subscribeUsers((next) => {
      held = next;
    });

    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snap: unknown) => void,
    ];
    onNext({
      docs: [
        snapshot({ email: 'miriam@example.org' }),
        { ...snapshot({ email: 'priya@example.org' }), id: 'uid-priya' },
      ],
    });

    expect(held.map((profile) => profile.email)).toEqual([
      'miriam@example.org',
      'priya@example.org',
    ]);
  });

  it('forwards a refused read to the caller', () => {
    const onError = vi.fn();
    subscribeUsers(() => {}, onError);

    const [, , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (cause: Error) => void,
    ];
    const refusal = new Error('refused');
    handler(refusal);

    expect(onError).toHaveBeenCalledWith(refusal);
  });

  it('survives a refused read with nobody listening for it', () => {
    subscribeUsers(() => {});

    const [, , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (cause: Error) => void,
    ];

    expect(() => handler(new Error('refused'))).not.toThrow();
  });
});

describe('touchLastSeen', () => {
  it('stamps the server clock on the one field', async () => {
    await touchLastSeen('uid-miriam');

    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'users/uid-miriam' },
      { lastSeenAt: 'server-timestamp' },
    );
  });

  it('swallows a failure rather than blocking a check-in', async () => {
    // A counselor whose profile is momentarily unwritable should still be able
    // to check students in.
    updateDoc.mockRejectedValueOnce(new Error('refused'));

    await expect(touchLastSeen('uid-miriam')).resolves.toBeUndefined();
  });
});

describe('upsertUser', () => {
  const patch = {
    email: '  Miriam@Example.org  ',
    displayName: '  Miriam  ',
    role: 'core' as const,
    active: true,
  };

  it('folds the address, because that is what authorisation is keyed on', async () => {
    getDoc.mockResolvedValue(snapshot(null));

    await upsertUser('uid-miriam', patch);

    expect(written().path).toBe('users/uid-miriam');
    expect(written().data).toMatchObject({
      email: 'miriam@example.org',
      displayName: 'Miriam',
      role: 'core',
      active: true,
    });
  });

  it('stamps the joining date on somebody new', async () => {
    getDoc.mockResolvedValue(snapshot(null));

    await upsertUser('uid-miriam', patch);

    expect(written().data).toMatchObject({
      createdAt: 'server-timestamp',
      lastSeenAt: null,
    });
  });

  it('never re-stamps it on an edit', async () => {
    // It is the record of when somebody joined the team.
    getDoc.mockResolvedValue(snapshot({ email: 'miriam@example.org' }));

    await upsertUser('uid-miriam', { ...patch, role: 'admin' });

    expect(written().data).not.toHaveProperty('createdAt');
    expect(written().data).not.toHaveProperty('lastSeenAt');
    expect(written().data.role).toBe('admin');
  });

  it('merges, so an edit does not blank what it did not mention', async () => {
    getDoc.mockResolvedValue(snapshot({ email: 'miriam@example.org' }));

    await upsertUser('uid-miriam', patch);

    expect(written().options).toEqual({ merge: true });
  });

  it('stores no display name rather than an empty one', async () => {
    // A blank string would render as a nameless row on the team screen; null is
    // what every reader already falls back from.
    getDoc.mockResolvedValue(snapshot(null));

    await upsertUser('uid-miriam', { ...patch, displayName: '   ' });
    expect(written().data.displayName).toBeNull();

    await upsertUser('uid-miriam', { ...patch, displayName: null });
    expect(written().data.displayName).toBeNull();

    await upsertUser('uid-miriam', { ...patch, displayName: undefined });
    expect(written().data.displayName).toBeNull();
  });

  it('can deactivate somebody without touching anything else', async () => {
    getDoc.mockResolvedValue(snapshot({ email: 'miriam@example.org' }));

    await upsertUser('uid-miriam', { ...patch, active: false });

    expect(written().data.active).toBe(false);
  });
});
