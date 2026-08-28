/**
 * The aging-out record, and the four claims its shape rests on.
 *
 * A release says one gathering no longer expects one student (docs/aging-out.md),
 * and everything downstream of it — a resolved MIA row, a student surfaced weeks
 * later on the pooled list, a ledger entry naming who decided — reads fields
 * this module writes. So what is pinned here is the writing:
 *
 *  - the document is addressed by the *pair*, which is what makes performing
 *    the act twice replace rather than stack;
 *  - a `setDoc`, never an update, so a changed mind carries a fresh
 *    `releasedAt` and the release is not born inert against old attendance;
 *  - the reason is one of exactly two values, and an unknown one read back
 *    means the widening one rather than the silencing one;
 *  - undo is the only delete, and the system's own contradiction — the student
 *    walking back in — is derived by readers instead (`isInertRelease`).
 *
 * Firestore is mocked at the SDK boundary; `firestore-tests/rules.test.ts` is
 * where the rules these writes have to satisfy are checked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { releaseStudent, subscribeTransitions, transitionId, undoRelease } from '@/services/transitions';
import type { Transition } from '@/types';

/** The mocked `Timestamp` above, as the converter will see it. */
const stamp = (at: Date) => new (Timestamp as unknown as new (at: Date) => unknown)(at);

const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const deleteDoc = vi.hoisted(() => vi.fn(async () => {}));
const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  Timestamp: class {
    constructor(readonly at: Date) {}
    toDate() {
      return this.at;
    }
  },
  doc: (_db: unknown, path: string) => ({ path }),
  collection: (_db: unknown, path: string) => ({ path }),
  onSnapshot,
  serverTimestamp: () => 'server-timestamp',
  setDoc,
  deleteDoc,
}));

const RELEASE = {
  chainKey: 'sunday-kids',
  studentId: 'pco_5101',
  reason: 'moved-on' as const,
  uid: 'uid-ruth',
  authorName: 'Ruth Adeyemi',
};

beforeEach(() => {
  setDoc.mockClear();
  deleteDoc.mockClear();
  onSnapshot.mockClear();
});

/** Runs the subscription over one snapshot and hands back what it published. */
function published(docs: { id: string; data: Record<string, unknown> | undefined }[]): Transition[] {
  let held: Transition[] = [];
  subscribeTransitions((next) => {
    held = next;
  });
  const handler = (onSnapshot.mock.calls[0] as unknown as unknown[])[1] as (snapshot: {
    docs: { id: string; data: () => Record<string, unknown> | undefined }[];
  }) => void;
  handler({ docs: docs.map((entry) => ({ id: entry.id, data: () => entry.data })) });
  return held;
}

describe('transitionId', () => {
  it('addresses the pair, so the act is idempotent by construction', () => {
    expect(transitionId('sunday-kids', 'pco_5101')).toBe('sunday-kids__pco_5101');
  });

  it('keeps two students on one gathering apart, and one student on two', () => {
    expect(transitionId('sunday-kids', 'a')).not.toBe(transitionId('sunday-kids', 'b'));
    expect(transitionId('friday', 'a')).not.toBe(transitionId('sunday-kids', 'a'));
  });
});

describe('releaseStudent', () => {
  it('writes the whole record at the pair’s own address', async () => {
    await releaseStudent(RELEASE);

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0] as unknown as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(ref.path).toBe('transitions/sunday-kids__pco_5101');
    expect(payload).toEqual({
      chainKey: 'sunday-kids',
      studentId: 'pco_5101',
      reason: 'moved-on',
      note: null,
      releasedBy: 'uid-ruth',
      releasedByName: 'Ruth Adeyemi',
      releasedAt: 'server-timestamp',
    });
  });

  it('carries the silencing reason when that is what was chosen', async () => {
    await releaseStudent({ ...RELEASE, reason: 'departed' });

    const [, payload] = setDoc.mock.calls[0] as unknown as [unknown, { reason: string }];
    expect(payload.reason).toBe('departed');
  });

  it('trims a note, and stores an empty one as no note at all', async () => {
    await releaseStudent({ ...RELEASE, note: '  graduated  ' });
    expect((setDoc.mock.calls[0] as unknown as [unknown, { note: unknown }])[1].note).toBe(
      'graduated',
    );

    setDoc.mockClear();
    await releaseStudent({ ...RELEASE, note: '   ' });
    expect((setDoc.mock.calls[0] as unknown as [unknown, { note: unknown }])[1].note).toBeNull();

    setDoc.mockClear();
    await releaseStudent(RELEASE);
    expect((setDoc.mock.calls[0] as unknown as [unknown, { note: unknown }])[1].note).toBeNull();
  });

  it('re-performing the act replaces the same document rather than stacking', async () => {
    await releaseStudent(RELEASE);
    await releaseStudent({ ...RELEASE, reason: 'departed', note: 'moved to Austin' });

    const paths = setDoc.mock.calls.map((call) => (call as unknown as [{ path: string }])[0].path);
    expect(paths).toEqual([
      'transitions/sunday-kids__pco_5101',
      'transitions/sunday-kids__pco_5101',
    ]);
    // A whole record, not a patch: the second act is a fresh claim with a fresh
    // instant, which is what keeps a re-release from being born inert against
    // the attendance that stood the first one down.
    const [, second] = setDoc.mock.calls[1] as unknown as [unknown, Record<string, unknown>];
    expect(second.releasedAt).toBe('server-timestamp');
    expect(second.note).toBe('moved to Austin');
  });
});

describe('undoRelease', () => {
  it('deletes the pair’s document, and only that', async () => {
    await undoRelease('sunday-kids', 'pco_5101');

    expect(deleteDoc).toHaveBeenCalledTimes(1);
    const [ref] = deleteDoc.mock.calls[0] as unknown as [{ path: string }];
    expect(ref.path).toBe('transitions/sunday-kids__pco_5101');
  });
});

describe('subscribeTransitions', () => {
  it('reads the whole collection — the pooled list needs every chain', () => {
    subscribeTransitions(() => {});
    const [ref] = onSnapshot.mock.calls[0] as unknown as [{ path: string }];
    expect(ref.path).toBe('transitions');
  });

  it('hydrates a record, keeping the note and the author who decided', () => {
    const at = new Date('2026-09-08T11:15:00');
    const [entry] = published([
      {
        id: 'sunday-kids__pco_5110',
        data: {
          chainKey: 'sunday-kids',
          studentId: 'pco_5110',
          reason: 'moved-on',
          note: 'up to youth group',
          releasedBy: 'uid-ruth',
          releasedByName: 'Ruth Adeyemi',
          releasedAt: stamp(at),
        },
      },
    ]);

    expect(entry).toEqual({
      id: 'sunday-kids__pco_5110',
      chainKey: 'sunday-kids',
      studentId: 'pco_5110',
      reason: 'moved-on',
      note: 'up to youth group',
      releasedBy: 'uid-ruth',
      releasedByName: 'Ruth Adeyemi',
      releasedAt: at,
    });
  });

  it('reads the departed reason back as itself', () => {
    const [entry] = published([
      { id: 'a__b', data: { chainKey: 'a', studentId: 'b', reason: 'departed' } },
    ]);
    expect(entry!.reason).toBe('departed');
  });

  /*
   * The one direction a bad read may fall. `departed` suppresses a student from
   * the pooled "not seen anywhere" list; `moved-on` keeps them on the
   * ministry's radar. A value nobody recognises must therefore not be read as
   * the silencing one — the same fail-open direction every other reader of this
   * record takes.
   */
  it('reads an unrecognised reason as the widening one, never as silencing', () => {
    const [entry] = published([
      { id: 'a__b', data: { chainKey: 'a', studentId: 'b', reason: 'left-the-country' } },
    ]);
    expect(entry!.reason).toBe('moved-on');
  });

  it('survives a document with nothing in it', () => {
    const [entry] = published([{ id: 'a__b', data: undefined }]);

    expect(entry!.chainKey).toBe('');
    expect(entry!.studentId).toBe('');
    expect(entry!.reason).toBe('moved-on');
    expect(entry!.note).toBeNull();
    expect(entry!.releasedBy).toBe('');
    // The ledger has to name somebody; "Somebody" is the honest placeholder.
    expect(entry!.releasedByName).toBe('Somebody');
  });

  it('treats an empty note as no note', () => {
    const [entry] = published([{ id: 'a__b', data: { note: '' } }]);
    expect(entry!.note).toBeNull();
  });

  /*
   * A pending `serverTimestamp()` reads back null in the optimistic local
   * snapshot, and every reader of this record compares `releasedAt` against
   * attendance. A null there would make the release apply to all of history —
   * inert against the student's every past visit — so the local answer for an
   * act just performed is "just now".
   */
  it('stands in for a timestamp the server has not written yet', () => {
    const before = Date.now();
    const [entry] = published([{ id: 'a__b', data: { releasedAt: null } }]);

    expect(entry!.releasedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(entry!.releasedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('hands back the unsubscribe the caller has to keep', () => {
    const stop = vi.fn();
    onSnapshot.mockReturnValueOnce(stop);

    expect(subscribeTransitions(() => {})).toBe(stop);
  });

  it('passes an error handler through to the listener', () => {
    const onError = vi.fn();
    subscribeTransitions(() => {}, onError);

    expect((onSnapshot.mock.calls[0] as unknown as unknown[])[2]).toBe(onError);
  });
});
