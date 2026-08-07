/**
 * The hold, tested where it actually has to hold.
 *
 * `pendingReview` is a boolean, and a test that a boolean can be read would be
 * worthless. What is worth pinning is that *every* path into a backend consults
 * it, because a hold with one bypass is not a hold — and the bypasses are
 * exactly the paths nobody thinks about: the sweep behind a button on the
 * Settings screen, and the repair that re-creates a person somebody deleted
 * upstream.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import type { PcoConfig } from '../config.js';
import type { PcoClient } from '../pco/client.js';
import { pushPendingStudents, pushStudent } from '../pco/pushStudents.js';
import { recreateStudent } from '../pco/recreate.js';
import { scanRoster } from './scan.js';

const CONFIG = { writeBack: 'full', minGrade: 0, maxGrade: 12 } as unknown as PcoConfig;

/** A client that fails the test if anything reaches it. */
function forbiddenClient(): PcoClient {
  const refuse = (): never => {
    throw new Error('A held student reached Planning Center.');
  };
  return { get: refuse, post: refuse, patch: refuse } as unknown as PcoClient;
}

function dbWithHeldStudent(overrides: Record<string, unknown> = {}): FakeFirestore {
  const db = new FakeFirestore();
  db.seed('students/held-1', {
    firstName: 'Robin',
    lastName: 'Fields',
    grade: 4,
    status: 'active',
    isVisitor: true,
    pcoPersonId: null,
    upstreamPushPending: true,
    pendingReview: true,
    ...overrides,
  });
  return db;
}

describe('a student held for review', () => {
  it('is skipped by the immediate push, before anything is read upstream', async () => {
    const db = dbWithHeldStudent();
    const result = await pushStudent({
      db,
      client: forbiddenClient(),
      config: CONFIG,
      studentId: 'held-1',
    });

    expect(result.status).toBe('skipped');
    expect(result.message).toMatch(/waiting to be reviewed/i);
  });

  it('is skipped by the pending sweep — the one-click bypass', async () => {
    const db = dbWithHeldStudent();
    db.seed('students/ordinary-1', {
      firstName: 'Alex',
      lastName: 'Kim',
      grade: 6,
      status: 'active',
      upstreamPushPending: true,
    });

    /*
     * The sweep is a button on the Settings screen that any core-team member
     * may press, and it is the path a hold most easily leaks through: it reads
     * the whole collection and pushes everything queued. Filtered there rather
     * than merely refused inside `pushStudent`, so a held family does not eat
     * the limit or count as a skip somebody has to explain.
     */
    const created: string[] = [];
    const result = await pushPendingStudents({
      db,
      client: {
        // No exact match upstream, so every push falls through to a create.
        get: async () => ({ data: [] }),
        post: async (_path: string, body: { data?: { attributes?: { first_name?: string } } }) => {
          created.push(body.data?.attributes?.first_name ?? '?');
          return { data: { id: `pco_${created.length}`, type: 'Person' } };
        },
        patch: async () => ({}),
      } as unknown as PcoClient,
      config: CONFIG,
    });

    expect(created).toEqual(['Alex']);
    expect(db.get('students/held-1')!.pcoPersonId).toBeNull();
    // Not even as a skip: a held family is not a queue anybody has to unstick.
    expect(result).toEqual({ pushed: 1, skipped: 0, errors: 0 });
  });

  it('is not re-created by the repair that resurrects a deleted person', async () => {
    const db = dbWithHeldStudent();
    const result = await recreateStudent({
      db,
      client: forbiddenClient(),
      config: CONFIG,
      studentId: 'held-1',
    });

    expect(result.status).toBe('not-linked');
    expect(result.message).toMatch(/waiting to be reviewed/i);
  });

  it('counts as waiting rather than as a stuck queue', async () => {
    const db = dbWithHeldStudent();
    db.seed('students/ordinary-1', { status: 'active', firstName: 'Alex', lastName: 'Kim' });

    const scan = await scanRoster(db);
    // A healthy Sunday morning must not read as a broken write-back on the
    // Settings card.
    expect(scan.heldForReview).toBe(1);
    expect(scan.queued).toBe(1);
  });

  it('is pushed like anybody else once the hold comes off', async () => {
    const db = dbWithHeldStudent({ pendingReview: false });
    const result = await pushStudent({
      db,
      client: {
        get: async () => ({ data: [] }),
        post: async () => ({ data: { id: 'pco_500', type: 'Person' } }),
        patch: async () => ({}),
      } as unknown as PcoClient,
      config: CONFIG,
      studentId: 'held-1',
    });

    expect(result.status).not.toBe('skipped');
    expect(db.get('students/held-1')!.pcoPersonId).toBe('pco_500');
  });
});
