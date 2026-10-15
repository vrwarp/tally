/**
 * Folding one roster row into another, and the four times it refuses to.
 *
 * The refusals are the interesting half. A merge is easy to write and easy to
 * write in a way that loses something — the row the church's database actually
 * knows, a chain nothing follows, a second duplicate the keeper silently
 * forgets. Each of those is a test here because each of them is a real
 * possibility on a screen whose whole job is a judgement call.
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { PULSE_DOC } from '../kiosk/pulse.js';
import { mergeStudents, unmergeStudents } from './mergeStudents.js';
import type { BackendRegistry } from './registry.js';
import { scanRoster } from './scan.js';
import type { PeopleBackend, UpstreamMergeResult } from './types.js';

const NOW = new Date('2026-08-11T10:00:00Z');

function db(): FakeFirestore {
  return new FakeFirestore();
}

function merge(store: FakeFirestore, keeperId: string, foldId: string) {
  return mergeStudents({ db: store, keeperId, foldId, uid: 'core-uid', now: NOW });
}

describe('merging', () => {
  it('points the duplicate at the keeper and leaves its document standing', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active', firstName: 'Robin', lastName: 'Fields' });
    store.seed('students/held-1', {
      status: 'active',
      firstName: 'Robin',
      lastName: 'Fields',
      pendingReview: true,
      upstreamPushPending: true,
    });

    const result = await merge(store, 'pco_7', 'held-1');
    expect(result.status).toBe('merged');

    // Inactive, never deleted: attendance records point at this id.
    expect(store.get('students/held-1')).toMatchObject({
      status: 'inactive',
      mergedIntoStudentId: 'pco_7',
      // Not waiting for anything any more, in either sense.
      pendingReview: false,
      upstreamPushPending: false,
    });
    expect(store.get('students/pco_7')!.mergedFromStudentIds).toEqual(['held-1']);
    // And the lobby screens are told: the folded row must leave the kiosk
    // search within a poll, not a six-hour TTL.
    expect((store.get(PULSE_DOC)?.roster as { rev?: number })?.rev).toBeDefined();
  });

  it('relinks a never-pushed duplicate onto the keeper’s person on the way out', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active', firstName: 'Robin' });
    store.seed('students/held-1', { status: 'active', firstName: 'Robin' });

    await merge(store, 'pco_7', 'held-1');
    // So anything resolving the dead row through a backend lands on the right
    // human rather than on nothing.
    expect(store.get('students/held-1')).toMatchObject({
      upstreamBackend: 'pco',
      upstreamPersonId: '7',
      pcoPersonId: '7',
    });
  });

  it('leaves a duplicate that reached a backend pointing at its own person', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active', firstName: 'Robin' });
    store.seed('students/held-1', {
      status: 'active',
      firstName: 'Robin',
      upstreamBackend: 'pco',
      upstreamPersonId: '999',
      pcoPersonId: '999',
    });

    await merge(store, 'pco_7', 'held-1');
    // Precisely what somebody needs when they go and merge these two upstream.
    expect(store.get('students/held-1')!.upstreamPersonId).toBe('999');
  });

  it('remembers every duplicate a keeper absorbs, not only the last', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active' });
    store.seed('students/held-1', { status: 'active' });
    store.seed('students/held-2', { status: 'active' });

    await merge(store, 'pco_7', 'held-1');
    await merge(store, 'pco_7', 'held-2');

    // The single-valued `mergedFromStudentId` overwrote the first, which is
    // half a child's history vanishing off the only screen that shows it all.
    expect(store.get('students/pco_7')!.mergedFromStudentIds).toEqual(['held-1', 'held-2']);
  });
});

describe('what it refuses', () => {
  it('refuses a student folded into themselves', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active' });
    expect((await merge(store, 'pco_7', 'pco_7')).status).toBe('refused');
  });

  it('refuses a keeper that has itself been merged away', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'inactive', mergedIntoStudentId: 'pco_9' });
    store.seed('students/held-1', { status: 'active' });

    const result = await merge(store, 'pco_7', 'held-1');
    expect(result.status).toBe('refused');
    expect(result.message).toMatch(/already been merged/i);
  });

  it('refuses to put the backend’s own record on the losing side', async () => {
    const store = db();
    store.seed('students/tally-1', { status: 'active' });
    store.seed('students/pco_7', { status: 'active' });

    const result = await merge(store, 'tally-1', 'pco_7');
    expect(result.status).toBe('refused');
    expect(result.message).toMatch(/keep that one/i);
  });

  it('refuses two backend people, which is a merge only the backend can do', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active' });
    store.seed('students/pco_9', { status: 'active' });

    const result = await merge(store, 'pco_7', 'pco_9');
    expect(result.status).toBe('refused');
    expect(result.message).toMatch(/Merge them there/i);
  });
});

describe('un-merging', () => {
  it('puts the duplicate back and forgets both pointers', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active' });
    store.seed('students/held-1', { status: 'active' });
    await merge(store, 'pco_7', 'held-1');

    const result = await unmergeStudents({
      db: store,
      foldId: 'held-1',
      uid: 'core-uid',
      now: NOW,
    });

    expect(result.status).toBe('merged');
    expect(store.get('students/held-1')).toMatchObject({
      status: 'active',
      mergedIntoStudentId: null,
    });
    expect(store.get('students/pco_7')!.mergedFromStudentIds).toEqual([]);
    expect(store.get('students/pco_7')!.mergedFromStudentId).toBeNull();
  });

  it('takes the grafted linkage back off a never-pushed duplicate and puts it back as it was', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active', firstName: 'Robin', lastName: 'Fields' });
    store.seed('students/held-1', {
      status: 'active',
      firstName: 'Robyn',
      lastName: 'Fieldes',
      pcoPersonId: null,
      pendingReview: true,
      upstreamPushPending: true,
    });
    await merge(store, 'pco_7', 'held-1');

    await unmergeStudents({ db: store, foldId: 'held-1', uid: 'core-uid', now: NOW });

    /*
     * The merge pointed the duplicate at the keeper's person so the dead row
     * still resolved to somebody. Left on a row that is active again, that
     * pointer makes the duplicate a *linked* student: the roster overlays the
     * keeper's name on it, the sweep skips it, and a full write-back push
     * rewrites the keeper's Planning Center person with the name typed at the
     * door. An un-merge is meant to be a return to before the judgement call.
     */
    const fold = store.get('students/held-1')!;
    expect(fold.pcoPersonId ?? null).toBeNull();
    expect(fold.upstreamBackend ?? null).toBeNull();
    expect(fold.upstreamPersonId ?? null).toBeNull();
    // Held and queued again, which is where the family was before the merge.
    expect(fold).toMatchObject({
      status: 'active',
      pendingReview: true,
      upstreamPushPending: true,
    });
    // And the scan files nobody under the keeper's person but the keeper.
    const scan = await scanRoster(store);
    expect(scan.linkedPersonIds.pco).toEqual([]);
    expect(scan.heldForReview).toBe(1);
  });

  it('leaves a duplicate that reached a backend pointing at its own person', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active', firstName: 'Robin' });
    store.seed('students/held-1', {
      status: 'active',
      firstName: 'Robin',
      upstreamBackend: 'pco',
      upstreamPersonId: '999',
      pcoPersonId: '999',
    });
    await merge(store, 'pco_7', 'held-1');

    await unmergeStudents({ db: store, foldId: 'held-1', uid: 'core-uid', now: NOW });

    // Nothing was grafted, so there is nothing to take back: this is the
    // pointer somebody needs when they go and merge the two upstream.
    expect(store.get('students/held-1')).toMatchObject({
      status: 'active',
      upstreamBackend: 'pco',
      upstreamPersonId: '999',
      pcoPersonId: '999',
    });
  });

  it('refuses a student nobody merged', async () => {
    const store = db();
    store.seed('students/held-1', { status: 'active' });
    const result = await unmergeStudents({
      db: store,
      foldId: 'held-1',
      uid: 'core-uid',
      now: NOW,
    });
    expect(result.status).toBe('refused');
  });
});

/* -------------------------------------------------------------------------- */
/* When the backend can merge the two people itself                           */
/* -------------------------------------------------------------------------- */

type MergingBackend = PeopleBackend & {
  mergePeople: ReturnType<typeof vi.fn>;
  unmergePeople: ReturnType<typeof vi.fn>;
};

/** An Attendees adapter that answers as told, and remembers what it was asked. */
function attendeesBackend(
  answers: { merge?: UpstreamMergeResult; unmerge?: UpstreamMergeResult } = {},
): MergingBackend {
  return {
    id: 'a32',
    displayName: 'Attendees',
    capabilities: { mergeSupported: true },
    mergePeople: vi.fn(async () => answers.merge ?? { status: 'done' }),
    unmergePeople: vi.fn(async () => answers.unmerge ?? { status: 'done' }),
  } as unknown as MergingBackend;
}

/** Planning Center, which has no merge call. */
function planningCenterBackend(): PeopleBackend {
  return { id: 'pco', displayName: 'Planning Center', capabilities: { mergeSupported: false } } as unknown as PeopleBackend;
}

function registryOf(backends: Partial<Record<'pco' | 'a32', PeopleBackend>>): BackendRegistry {
  return { get: (id: 'pco' | 'a32') => backends[id] ?? null } as unknown as BackendRegistry;
}

function mergeWith(store: FakeFirestore, registry: BackendRegistry | undefined, keeperId: string, foldId: string) {
  return mergeStudents({ db: store, keeperId, foldId, uid: 'core-uid', now: NOW, registry });
}

function unmergeWith(store: FakeFirestore, registry: BackendRegistry | undefined, foldId: string) {
  return unmergeStudents({ db: store, foldId, uid: 'core-uid', now: NOW, registry });
}

describe('merging two Attendees people', () => {
  it('asks Attendees to merge the duplicate into the keeper, then folds', async () => {
    const store = db();
    store.seed('students/a32_aaa', { status: 'active', firstName: 'Sam' });
    store.seed('students/a32_bbb', { status: 'active', firstName: 'Sam' });
    const attendees = attendeesBackend();

    const result = await mergeWith(store, registryOf({ a32: attendees }), 'a32_aaa', 'a32_bbb');

    expect(result.status).toBe('merged');
    expect(result.message).toMatch(/in Attendees too/);
    expect(attendees.mergePeople).toHaveBeenCalledWith(
      expect.objectContaining({ duplicatePersonId: 'bbb', primaryPersonId: 'aaa' }),
    );
    // The fold remembers that the backend merged them as well, for the undo.
    expect(store.get('students/a32_bbb')).toMatchObject({
      status: 'inactive',
      mergedIntoStudentId: 'a32_aaa',
      upstreamMerge: { backendId: 'a32', duplicatePersonId: 'bbb', primaryPersonId: 'aaa' },
    });
    expect(store.get('students/a32_aaa')!.mergedFromStudentIds).toEqual(['a32_bbb']);
  });

  it('does the same for a pushed visitor and the Attendees row it duplicates', async () => {
    const store = db();
    store.seed('students/a32_aaa', { status: 'active', firstName: 'Sam' });
    store.seed('students/held-1', {
      status: 'active',
      firstName: 'Sam',
      upstreamBackend: 'a32',
      upstreamPersonId: 'bbb',
    });
    const attendees = attendeesBackend();

    const result = await mergeWith(store, registryOf({ a32: attendees }), 'a32_aaa', 'held-1');

    expect(result.status).toBe('merged');
    expect(attendees.mergePeople).toHaveBeenCalledWith(
      expect.objectContaining({ duplicatePersonId: 'bbb', primaryPersonId: 'aaa' }),
    );
    // Its own linkage stays: the id now forwards to the keeper's person upstream.
    expect(store.get('students/held-1')).toMatchObject({
      mergedIntoStudentId: 'a32_aaa',
      upstreamBackend: 'a32',
      upstreamPersonId: 'bbb',
      upstreamMerge: { backendId: 'a32', duplicatePersonId: 'bbb', primaryPersonId: 'aaa' },
    });
    expect(store.get('students/held-1')!.mergeGraft).toBeUndefined();
  });

  it('does not fold when Attendees refuses', async () => {
    const store = db();
    store.seed('students/a32_aaa', { status: 'active' });
    store.seed('students/a32_bbb', { status: 'active' });
    const attendees = attendeesBackend({
      merge: { status: 'refused', reason: 'Both attendees have a login; remove one first.' },
    });

    const result = await mergeWith(store, registryOf({ a32: attendees }), 'a32_aaa', 'a32_bbb');

    expect(result.status).toBe('refused');
    expect(result.message).toMatch(/Attendees would not merge them: Both attendees have a login/);
    // Nothing on Tally's side moved either: the two must not disagree.
    expect(store.get('students/a32_bbb')).toMatchObject({ status: 'active' });
    expect(store.get('students/a32_bbb')!.mergedIntoStudentId).toBeUndefined();
    expect(store.get('students/a32_aaa')!.mergedFromStudentIds).toBeUndefined();
  });

  it('still refuses two Planning Center people, which Planning Center merges itself', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active' });
    store.seed('students/pco_9', { status: 'active' });

    const result = await mergeWith(store, registryOf({ pco: planningCenterBackend() }), 'pco_7', 'pco_9');

    expect(result.status).toBe('refused');
    expect(result.message).toMatch(/Merge them there/);
  });

  it('refuses two Attendees rows while Attendees is not connected', async () => {
    const store = db();
    store.seed('students/a32_aaa', { status: 'active' });
    store.seed('students/a32_bbb', { status: 'active' });

    const result = await mergeWith(store, registryOf({}), 'a32_aaa', 'a32_bbb');

    expect(result.status).toBe('refused');
    expect(result.message).toMatch(/Merge them there/);
    expect(store.get('students/a32_bbb')).toMatchObject({ status: 'active' });
  });

  it('refuses two people held by different backends', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active' });
    store.seed('students/a32_bbb', { status: 'active' });
    const attendees = attendeesBackend();

    const result = await mergeWith(
      store,
      registryOf({ pco: planningCenterBackend(), a32: attendees }),
      'pco_7',
      'a32_bbb',
    );

    expect(result.status).toBe('refused');
    expect(attendees.mergePeople).not.toHaveBeenCalled();
  });
});

describe('un-merging a merge Attendees made too', () => {
  async function merged(attendees: MergingBackend): Promise<FakeFirestore> {
    const store = db();
    store.seed('students/a32_aaa', { status: 'active', firstName: 'Sam' });
    store.seed('students/a32_bbb', { status: 'active', firstName: 'Sam' });
    await mergeWith(store, registryOf({ a32: attendees }), 'a32_aaa', 'a32_bbb');
    return store;
  }

  it('undoes it in Attendees first and forgets the marker', async () => {
    const attendees = attendeesBackend();
    const store = await merged(attendees);

    const result = await unmergeWith(store, registryOf({ a32: attendees }), 'a32_bbb');

    expect(result.status).toBe('merged');
    expect(attendees.unmergePeople).toHaveBeenCalledWith(expect.objectContaining({ duplicatePersonId: 'bbb' }));
    const fold = store.get('students/a32_bbb')!;
    expect(fold.status).toBe('active');
    expect(fold.mergedIntoStudentId ?? null).toBeNull();
    expect(fold.upstreamMerge ?? null).toBeNull();
    expect(store.get('students/a32_aaa')!.mergedFromStudentIds).toEqual([]);
  });

  it('keeps the fold when Attendees would not undo it', async () => {
    const attendees = attendeesBackend({
      unmerge: { status: 'refused', reason: 'The login that moved has changed since; move it back by hand first.' },
    });
    const store = await merged(attendees);

    const result = await unmergeWith(store, registryOf({ a32: attendees }), 'a32_bbb');

    expect(result.status).toBe('refused');
    expect(result.message).toMatch(/Attendees would not undo the merge: The login that moved/);
    expect(store.get('students/a32_bbb')).toMatchObject({ status: 'inactive', mergedIntoStudentId: 'a32_aaa' });
  });

  it('refuses while Attendees is not connected any more', async () => {
    const store = await merged(attendeesBackend());

    const result = await unmergeWith(store, registryOf({}), 'a32_bbb');

    expect(result.status).toBe('refused');
    expect(result.message).toMatch(/not connected now/);
    expect(store.get('students/a32_bbb')).toMatchObject({ status: 'inactive', mergedIntoStudentId: 'a32_aaa' });
  });

  it('undoes a fold nobody merged upstream without asking any backend', async () => {
    const store = db();
    store.seed('students/pco_7', { status: 'active' });
    store.seed('students/held-1', { status: 'active' });
    const attendees = attendeesBackend();
    await mergeWith(store, registryOf({ a32: attendees }), 'pco_7', 'held-1');

    const result = await unmergeWith(store, registryOf({ a32: attendees }), 'held-1');

    expect(result.status).toBe('merged');
    expect(attendees.unmergePeople).not.toHaveBeenCalled();
    expect(store.get('students/held-1')).toMatchObject({ status: 'active' });
  });
});
