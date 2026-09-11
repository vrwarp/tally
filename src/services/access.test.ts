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
 * this app or by hand in the console, so an unknown role, a missing `email`, or
 * the retired `active` flag each has a defined answer rather than a crash on
 * the team screen.
 *
 * Firestore is mocked at the SDK boundary. These are claims about the writes
 * this module builds; whether the rules permit them is `firestore-tests`.
 */
import { Timestamp } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteToTally, subscribeInvitations, withdrawInvitation } from '@/services/access';
import type { Invitation } from '@/types';

const setDoc = vi.hoisted(() => vi.fn(async () => {}));
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
  deleteField: () => 'delete-field',
  setDoc,
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

  it('writes the role and who invited them', () => {
    void inviteToTally('miriam@example.org', 'admin', 'uid-admin');

    expect(written().data).toMatchObject({
      role: 'admin',
      invitedBy: 'uid-admin',
      invitedAt: 'server-timestamp',
    });
  });

  it('takes the retired pause flag off any document it rewrites', () => {
    // The switch is gone, so the field is deleted rather than merged over: a
    // value left on the record is one somebody reads later as still meaning
    // something.
    void inviteToTally('miriam@example.org', 'core', 'uid-admin');

    expect(written().data).toMatchObject({ active: 'delete-field' });
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

describe('the gatherings an invitation carries', () => {
  it('writes the ticked chains whole, so unticking one on a re-invite takes it off', () => {
    void inviteToTally('jo@example.org', 'counselor', 'uid-admin', undefined, [
      'sunday-school',
      'nursery',
    ]);

    expect(written().data?.gatherings).toEqual(['sunday-school', 'nursery']);
  });

  it('copies the list rather than storing the caller’s array', () => {
    // The caller owns a `Set`'s spread or a piece of component state; handing
    // the same reference to Firestore lets a later mutation change what was
    // written.
    const chosen = ['sunday-school'];
    void inviteToTally('jo@example.org', 'counselor', 'uid-admin', undefined, chosen);
    chosen.push('nursery');

    expect(written().data?.gatherings).toEqual(['sunday-school']);
  });

  it('writes an empty list when nothing was ticked, rather than leaving the field off', () => {
    /*
     * The write merges, so an absent key keeps whatever a previous invitation
     * put there — and "I unticked everything" would silently mean "leave it as
     * it was".
     */
    void inviteToTally('jo@example.org', 'counselor', 'uid-admin');

    expect(written().data?.gatherings).toEqual([]);
  });
});

describe('withdrawing', () => {
  it('withdraws by deleting the document', async () => {
    await withdrawInvitation('miriam@example,org');

    expect(deleteDoc).toHaveBeenCalledWith({ path: 'invitations/miriam@example,org' });
  });
});

describe('subscribeInvitations', () => {
  it('reads the whole collection unordered, because an order is also a filter', () => {
    /*
     * It used to `orderBy('email')`. Firestore drops from an ordered query every
     * document that lacks the field — and a link invitation has no address until
     * somebody redeems it, so the day links arrived every one of them would have
     * been missing from the list that exists to show them. The sort is on this
     * side now; the collection is small enough to carry it.
     */
    subscribeInvitations(() => {});

    const [source] = onSnapshot.mock.calls.at(-1) as unknown as [{ path: string }];
    expect(source.path).toBe('invitations');
    expect(orderBy).not.toHaveBeenCalled();
  });

  it('publishes a link, which has a label instead of an address', () => {
    const [invitation] = published([
      {
        id: 'link_abc123',
        data: {
          kind: 'link',
          role: 'counselor',
          label: 'Jo, nursery, Marie’s daughter',
          invitedBy: 'uid-miriam',
          tokenExpiresAt: new Timestamp(1_767_607_200, 0),
          gatherings: ['sunday-school'],
        },
      },
    ]);

    expect(invitation).toMatchObject({
      id: 'link_abc123',
      kind: 'link',
      label: 'Jo, nursery, Marie’s daughter',
      gatherings: ['sunday-school'],
      tokenExpiresAt: new Date(1_767_607_200_000),
    });
    // And no address is invented for it: the id is a hash, not a mailbox.
    expect(invitation?.email).toBeUndefined();
  });

  it('publishes what a redemption left behind, which is what Arrived this week reads', () => {
    const [invitation] = published([
      {
        id: 'link_abc123',
        data: {
          kind: 'link',
          label: 'Jo, nursery',
          resolvedAt: new Timestamp(1_767_607_200, 0),
          redeemedBy: 'uid-jo',
          redeemedEmail: 'jo.smith84@gmail.com',
          redeemedName: 'Jo Smith',
          placed: ['nursery'],
          skipped: ['sunday-school'],
        },
      },
    ]);

    expect(invitation).toMatchObject({
      resolvedAt: new Date(1_767_607_200_000),
      redeemedEmail: 'jo.smith84@gmail.com',
      redeemedName: 'Jo Smith',
      placed: ['nursery'],
      skipped: ['sunday-school'],
    });
  });

  it('puts the newest first, so the row somebody just made is the one they see', () => {
    /*
     * Alphabetical order and date order disagree on purpose. With 'new' and
     * 'old' as the addresses they agree, and a sort that ignored the date
     * entirely would have passed.
     */
    const rows = published([
      { id: 'aaron@x,org', data: { email: 'aaron@x.org', invitedAt: new Timestamp(1_000, 0) } },
      { id: 'zoe@x,org', data: { email: 'zoe@x.org', invitedAt: new Timestamp(2_000, 0) } },
    ]);

    expect(rows.map((row) => row.email)).toEqual(['zoe@x.org', 'aaron@x.org']);
  });

  it('falls back to the name only when two rows were invited at the same moment', () => {
    const same = new Timestamp(1_767_607_200, 0);
    const rows = published([
      { id: 'zoe@x,org', data: { email: 'zoe@x.org', invitedAt: same } },
      { id: 'aaron@x,org', data: { email: 'aaron@x.org', invitedAt: same } },
    ]);

    expect(rows.map((row) => row.email)).toEqual(['aaron@x.org', 'zoe@x.org']);
  });

  it('sorts a link by its label and a bare row by its id, because neither has an address', () => {
    /*
     * The tie-break reads `email ?? label ?? id`, and each rung has to be the
     * one that answers for its own kind of row: an address invitation has an
     * address, a link has only the label its inviter typed, and a row that has
     * neither still has to land somewhere rather than throw.
     */
    const same = new Timestamp(1_767_607_200, 0);
    const rows = published([
      { id: 'zzz-bare-row', data: { invitedAt: same } },
      { id: 'link_b', data: { kind: 'link', label: 'Moira, Fridays', invitedAt: same } },
      { id: 'aaron@x,org', data: { email: 'aaron@x.org', invitedAt: same } },
    ]);

    expect(rows.map((row) => row.email ?? row.label ?? row.id)).toEqual([
      'aaron@x.org',
      'Moira, Fridays',
      'zzz-bare-row',
    ]);
  });

  it('sorts a row that has no date under the ones that have one', () => {
    // `?? 0` is what makes an undated row oldest rather than newest.
    const rows = published([
      { id: 'undated@x,org', data: { email: 'undated@x.org' } },
      { id: 'dated@x,org', data: { email: 'dated@x.org', invitedAt: new Timestamp(1_000, 0) } },
    ]);

    expect(rows.map((row) => row.email)).toEqual(['dated@x.org', 'undated@x.org']);
  });

  it('gives a link the address a redemption stored on it', () => {
    // The `kind: 'link'` branch supplies no address, so this is the only way a
    // link row ever carries one — and the row is the audit record of who spent
    // the token, so dropping it would lose the answer.
    const [invitation] = published([
      { id: 'link_abc', data: { kind: 'link', email: 'jo@example.org', label: 'Jo' } },
    ]);

    expect(invitation?.email).toBe('jo@example.org');
  });

  it('ignores a stored address that is not a string, on either kind of row', () => {
    const [link] = published([{ id: 'link_abc', data: { kind: 'link', email: 42 } }]);
    expect(link?.email).toBeUndefined();

    // An address row falls back to its own id, which is the address with its
    // dots swapped for commas.
    const [addressed] = published([{ id: 'a,b@x,org', data: { email: 42 } }]);
    expect(addressed?.email).toBe('a.b@x.org');
  });

  it('carries no label at all when the stored one is empty or not a string', () => {
    const [blank] = published([{ id: 'link_a', data: { kind: 'link', label: '' } }]);
    expect(Object.keys(blank ?? {})).not.toContain('label');

    const [wrong] = published([{ id: 'link_b', data: { kind: 'link', label: 7 } }]);
    expect(Object.keys(wrong ?? {})).not.toContain('label');
  });

  it('carries no redemption keys at all until there is a redemption', () => {
    /*
     * Absent, not undefined. `toEqual` treats a key holding `undefined` as
     * absent, so asserting the whole shape cannot tell the two apart — and the
     * difference matters: `redeemedBy` present-and-undefined would make a row
     * that nobody has spent read as one somebody has.
     */
    const [fresh] = published([{ id: 'link_a', data: { kind: 'link' } }]);
    const keys = Object.keys(fresh ?? {});
    expect(keys).not.toContain('redeemedBy');
    expect(keys).not.toContain('redeemedEmail');
    expect(keys).not.toContain('redeemedName');

    const [wrong] = published([
      { id: 'link_b', data: { kind: 'link', redeemedBy: 1, redeemedEmail: 2, redeemedName: 3 } },
    ]);
    expect(Object.keys(wrong ?? {})).not.toContain('redeemedBy');
  });

  it('keeps only the strings out of a stored list, and answers [] for anything else', () => {
    const [mixed] = published([
      {
        id: 'link_a',
        data: { kind: 'link', gatherings: ['sunday-school', 7, null, 'nursery'] },
      },
    ]);
    expect(mixed?.gatherings).toEqual(['sunday-school', 'nursery']);

    const [wrong] = published([
      { id: 'link_b', data: { kind: 'link', gatherings: 'sunday-school', placed: 3 } },
    ]);
    expect(wrong?.gatherings).toEqual([]);
    expect(wrong?.placed).toEqual([]);
  });

  it('maps a stored invitation', () => {
    const [invitation] = published([
      {
        id: 'miriam@example,org',
        data: {
          email: 'miriam@example.org',
          role: 'core',
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
      invitedAt: new Date(1_767_607_200_000),
      invitedBy: 'uid-admin',
      note: 'Wednesday volunteer',
      // The link half of the shape, empty on an address invitation that
      // nobody has redeemed — the state every row starts in.
      tokenExpiresAt: null,
      resolvedAt: null,
      gatherings: [],
      placed: [],
      skipped: [],
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

  it('shows the address as it was typed, not as it was folded into an id', () => {
    // The id is `emailKey`'d — trimmed, lowercased, dots to commas — because
    // that is what makes inviting twice one invitation. The display copy is
    // what an admin typed, and it is what the team screen shows back to them.
    const [invitation] = published([
      { id: 'miriam@example,org', data: { email: 'Miriam.Chen@Example.org' } },
    ]);

    expect(invitation?.email).toBe('Miriam.Chen@Example.org');
  });

  it('falls back to the id for a display copy that is not a string', () => {
    const [invitation] = published([{ id: 'miriam@example,org', data: { email: 42 } }]);

    expect(invitation?.email).toBe('miriam@example.org');
  });

  it('puts every dot back, not just the first', () => {
    const [invitation] = published([{ id: 'a,b@sub,example,org', data: {} }]);

    expect(invitation?.email).toBe('a.b@sub.example.org');
  });

  it('drops the retired pause flag, however an old document left it', () => {
    // The switch is gone from the screen and from the server. A `false` still
    // sitting on a document written before that must not come back as a
    // property the team screen could draw a "Suspended" badge from.
    const rows = published([
      { id: 'a@b,org', data: { active: false } },
      { id: 'c@d,org', data: { active: true } },
    ]);

    for (const row of rows) expect(row).not.toHaveProperty('active');
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
