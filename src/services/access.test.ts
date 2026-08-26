/**
 * The allowlist: who an admin has said may sign in, and as what.
 *
 * An invitation exists because authorisation has to be decided *before* the
 * person first appears — there is no `users/{uid}` to grant a role on until
 * somebody has signed in, and the rules rightly forbid anyone creating their
 * own. Two consequences are asserted here because both have bitten:
 *
 * The document id is derived from the address, never generated, which is the
 * whole of what makes inviting somebody twice safe. And a stored document is
 * read defensively: an invitation may have been written by an older version of
 * this app or by hand in the console, so a missing `active`, an unknown role,
 * or a missing `email` each has a defined answer rather than a crash on the
 * team screen.
 *
 * Firestore is mocked at the SDK boundary. These are claims about the writes
 * this module builds; whether the rules permit them is `firestore-tests`.
 */
import { Timestamp } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inviteToTally,
  setInvitationActive,
  subscribeInvitations,
  withdrawInvitation,
} from '@/services/access';
import type { Invitation } from '@/types';

const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const updateDoc = vi.hoisted(() => vi.fn(async () => {}));
const deleteDoc = vi.hoisted(() => vi.fn(async () => {}));
const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));
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
  serverTimestamp: () => 'server-timestamp',
  setDoc,
  updateDoc,
  deleteDoc,
}));

/** The write `setDoc` was handed, as `{ ref, data, options }`. */
function written() {
  const call = setDoc.mock.calls.at(-1) as unknown[] | undefined;
  const ref = call?.[0];
  const data = call?.[1];
  const options = call?.[2];
  return {
    path: (ref as { path: string } | undefined)?.path,
    data: data as Record<string, unknown> | undefined,
    options: options as Record<string, unknown> | undefined,
  };
}

/** Runs the subscription and hands back whatever it published. */
function published(docs: { id: string; data: Record<string, unknown> | undefined }[]) {
  let held: Invitation[] = [];
  subscribeInvitations((next) => {
    held = next;
  });
  const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
    unknown,
    (snapshot: unknown) => void,
  ];
  onNext({ docs: docs.map((entry) => ({ id: entry.id, data: () => entry.data })) });
  return held;
}

beforeEach(() => {
  setDoc.mockClear();
  updateDoc.mockClear();
  deleteDoc.mockClear();
  onSnapshot.mockClear();
  orderBy.mockClear();
});

describe('inviteToTally', () => {
  it('keys the document on the address, so inviting twice is one invitation', () => {
    void inviteToTally('Miriam@Example.org', 'core', 'uid-admin');

    // Dots become commas because the address is the key and the key is a path
    // segment.
    expect(written().path).toBe('invitations/miriam@example,org');
  });

  it('stores the address folded, so a sign-in finds it however it was typed', () => {
    void inviteToTally('  Miriam@Example.org  ', 'counselor', 'uid-admin');

    expect(written().data).toMatchObject({ email: 'miriam@example.org' });
  });

  it('writes the role, who invited them, and an active flag', () => {
    void inviteToTally('miriam@example.org', 'admin', 'uid-admin');

    expect(written().data).toMatchObject({
      role: 'admin',
      active: true,
      invitedBy: 'uid-admin',
      invitedAt: 'server-timestamp',
    });
  });

  it('merges, so changing somebody role does not blank the rest', () => {
    void inviteToTally('miriam@example.org', 'core', 'uid-admin');

    expect(written().options).toEqual({ merge: true });
  });

  it('keeps a note when there is one', () => {
    void inviteToTally('miriam@example.org', 'core', 'uid-admin', '  Wednesday volunteer  ');

    expect(written().data).toMatchObject({ note: 'Wednesday volunteer' });
  });

  it('writes no note key at all for whitespace', () => {
    // An empty string on the document would show as a blank line under the
    // address rather than as no note.
    void inviteToTally('miriam@example.org', 'core', 'uid-admin', '   ');

    expect(written().data).not.toHaveProperty('note');
  });

  it('writes no note key when none was given', () => {
    void inviteToTally('miriam@example.org', 'core', 'uid-admin');

    expect(written().data).not.toHaveProperty('note');
  });

  it('refuses an empty address rather than writing a document nobody can match', () => {
    expect(inviteToTally('   ', 'core', 'uid-admin')).rejects.toThrow(
      'An email address is required.',
    );
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('pausing and withdrawing', () => {
  it('pauses an invitation without retyping the address', async () => {
    // A summer volunteer goes on hold and comes back in September.
    await setInvitationActive('miriam@example,org', false);

    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'invitations/miriam@example,org' },
      { active: false },
    );
  });

  it('restores one the same way', async () => {
    await setInvitationActive('miriam@example,org', true);

    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'invitations/miriam@example,org' },
      { active: true },
    );
  });

  it('withdraws by deleting the document', async () => {
    await withdrawInvitation('miriam@example,org');

    expect(deleteDoc).toHaveBeenCalledWith({ path: 'invitations/miriam@example,org' });
  });
});

describe('subscribeInvitations', () => {
  it('reads the collection in address order', () => {
    subscribeInvitations(() => {});

    const [source] = onSnapshot.mock.calls.at(-1) as unknown as [
      { path: string; constraints: unknown[] },
    ];
    expect(source.path).toBe('invitations');
    expect(orderBy).toHaveBeenCalledWith('email');
  });

  it('maps a stored invitation', () => {
    const [invitation] = published([
      {
        id: 'miriam@example,org',
        data: {
          email: 'miriam@example.org',
          role: 'core',
          active: true,
          invitedAt: new Timestamp(1_767_607_200, 0),
          invitedBy: 'uid-admin',
          note: 'Wednesday volunteer',
        },
      },
    ]);

    expect(invitation).toEqual({
      id: 'miriam@example,org',
      email: 'miriam@example.org',
      role: 'core',
      active: true,
      invitedAt: new Date(1_767_607_200_000),
      invitedBy: 'uid-admin',
      note: 'Wednesday volunteer',
    });
  });

  it('turns the stored timestamp into a date', () => {
    const [invitation] = published([
      {
        id: 'a@b,org',
        data: { invitedAt: new Timestamp(1_767_607_200, 0) },
      },
    ]);

    expect(invitation?.invitedAt).toEqual(new Date(1_767_607_200_000));
  });

  it('has no date when the field is missing or not a timestamp', () => {
    // A locally-pending `serverTimestamp()` reads back as null until the
    // server acknowledges, and the team screen has to render either way.
    const rows = published([
      { id: 'a@b,org', data: {} },
      { id: 'c@d,org', data: { invitedAt: 'yesterday' } },
    ]);

    expect(rows.map((row) => row.invitedAt)).toEqual([null, null]);
  });

  it('reads the address back out of the id when the document has none', () => {
    // Older invitations were written without the display copy, and a row with
    // no address is a row nobody can act on.
    const [invitation] = published([{ id: 'miriam@example,org', data: {} }]);

    expect(invitation?.email).toBe('miriam@example.org');
  });

  it('treats an invitation with no flag as active', () => {
    // Absent means "nobody has paused this", which is what every invitation
    // written before the pause switch existed looks like.
    const [invitation] = published([{ id: 'a@b,org', data: { active: undefined } }]);

    expect(invitation?.active).toBe(true);
  });

  it('honours a paused flag', () => {
    const [invitation] = published([{ id: 'a@b,org', data: { active: false } }]);

    expect(invitation?.active).toBe(false);
  });

  it('falls back to the least privilege for an unknown role', () => {
    // A role typed by hand in the console must not become an admin.
    const [invitation] = published([{ id: 'a@b,org', data: { role: 'owner' } }]);

    expect(invitation?.role).toBe('counselor');
  });

  it('keeps the two roles it does recognise', () => {
    const rows = published([
      { id: 'a@b,org', data: { role: 'admin' } },
      { id: 'c@d,org', data: { role: 'core' } },
    ]);

    expect(rows.map((row) => row.role)).toEqual(['admin', 'core']);
  });

  it('leaves out a note that is not text', () => {
    const [invitation] = published([{ id: 'a@b,org', data: { note: 42 } }]);

    expect(invitation).not.toHaveProperty('note');
  });

  it('leaves out an empty note', () => {
    const [invitation] = published([{ id: 'a@b,org', data: { note: '' } }]);

    expect(invitation).not.toHaveProperty('note');
  });

  it('reads a missing document as an empty one rather than throwing', () => {
    const [invitation] = published([{ id: 'a@b,org', data: undefined }]);

    expect(invitation?.email).toBe('a@b.org');
    expect(invitation?.invitedBy).toBeNull();
  });

  it('has no inviter when the field is not text', () => {
    const [invitation] = published([{ id: 'a@b,org', data: { invitedBy: 7 } }]);

    expect(invitation?.invitedBy).toBeNull();
  });

  it('forwards a refused read to the caller', () => {
    const onError = vi.fn();
    subscribeInvitations(() => {}, onError);

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
    subscribeInvitations(() => {});

    const [, , handler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (cause: Error) => void,
    ];

    expect(() => handler(new Error('refused'))).not.toThrow();
  });
});
