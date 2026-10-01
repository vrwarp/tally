/**
 * Folding one roster row into another, and the four times it refuses to.
 *
 * The refusals are the interesting half. A merge is easy to write and easy to
 * write in a way that loses something — the row the church's database actually
 * knows, a chain nothing follows, a second duplicate the keeper silently
 * forgets. Each of those is a test here because each of them is a real
 * possibility on a screen whose whole job is a judgement call.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { PULSE_DOC } from '../kiosk/pulse.js';
import { mergeStudents, unmergeStudents } from './mergeStudents.js';
import { scanRoster } from './scan.js';

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
