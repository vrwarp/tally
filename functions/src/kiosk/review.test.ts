/**
 * The decisions the door stopped making.
 *
 * Three claims worth pinning, because getting any of them wrong is invisible
 * until somebody looks at the church's database months later:
 *
 *   - **A held child reaches no backend.** Not by the trigger, not by the
 *     sweep, not by a button. The hold is the only gate, so every path has to
 *     honour it or the review screen is decoration.
 *   - **Approval replays in the right order.** Every child, then *one*
 *     household — with the sibling's household when there is one. Per-child
 *     approval would mint one household per sibling, which is the failure
 *     `createFamily` exists to avoid.
 *   - **The record's lifetime.** It holds a parent's phone number, so it must
 *     go the moment it stops being able to help, and only then.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BackendRegistry } from '../backends/registry.js';
import type { PeopleBackend } from '../backends/types.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { REGISTRATIONS_COLLECTION } from './registration.js';
import { approveRegistration, discardRegistration, listPendingRegistrations } from './review.js';

const NOW = new Date('2026-08-11T10:00:00Z');
const REGISTERED_AT = new Date('2026-08-09T19:05:00Z');
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function backendWith(
  overrides: Partial<PeopleBackend> & { writeBack?: 'off' | 'create' | 'full' } = {},
): PeopleBackend {
  const { writeBack = 'full', ...rest } = overrides;
  return {
    id: 'pco',
    displayName: 'Planning Center',
    /*
     * `parentCreatable: true` regardless of the mode, because that is what both
     * real adapters do — it says the adapter knows how to build a family, not
     * that this deployment permits one. The write-back mode is only discovered
     * inside `createFamily`, which answers `disabled`. A double that folded the
     * two together would hide exactly the case below.
     */
    capabilities: { writeBack, parentCreatable: true },
    pushStudent: vi.fn(async () => ({ status: 'created' })),
    updateStudentProfile: vi.fn(async () => ({ status: 'updated' })),
    createFamily: vi.fn(async () => ({ status: 'created', message: 'Added the family.' })),
    resetCache: vi.fn(),
    invalidateReachability: vi.fn(),
    ...rest,
  } as unknown as PeopleBackend;
}

function registryOf(backend: PeopleBackend | null): BackendRegistry {
  return {
    ids: () => (backend ? [backend.id] : []),
    get: () => backend,
    defaultPush: () => (backend ? { backend } : { error: 'Nothing is connected.' }),
  } as unknown as BackendRegistry;
}

/** A registration as `registerFamily` leaves it: held children, a record. */
function dbWithRegistration(
  overrides: Record<string, unknown> = {},
  children = ['held-1', 'held-2'],
): FakeFirestore {
  const db = new FakeFirestore();
  for (const [index, id] of children.entries()) {
    db.seed(`students/${id}`, {
      firstName: index === 0 ? 'Robin' : 'Sam',
      lastName: 'Fields',
      status: 'active',
      isVisitor: true,
      pcoPersonId: null,
      pcoPushPending: true,
      pendingReview: true,
      registrationId: ID,
    });
  }
  db.seed(`${REGISTRATIONS_COLLECTION}/${ID}`, {
    status: 'complete',
    source: 'kiosk',
    eventId: 'friday-today',
    studentIds: children,
    childCount: children.length,
    last4: '3344',
    checkedIn: true,
    createdAt: REGISTERED_AT,
    guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5550103344' },
    children: [
      { firstName: 'Robin', lastName: 'Fields', grade: 4 },
      { firstName: 'Sam', lastName: 'Fields', grade: null },
    ].slice(0, children.length),
    allergies: [],
    possibleDuplicateOf: {},
    anchorStudentIds: [],
    lastError: null,
    ...overrides,
  });
  return db;
}

/* -------------------------------------------------------------------------- */

describe('what a reviewer is shown', () => {
  it('names the family as they typed it, with the digits and the ageing', async () => {
    const db = dbWithRegistration();
    const [row] = await listPendingRegistrations(db, NOW);

    expect(row!.guardian).toEqual({ firstName: 'Dana', lastName: 'Fields', phone: '5550103344' });
    expect(row!.last4).toBe('3344');
    expect(row!.children.map((child) => child.firstName)).toEqual(['Robin', 'Sam']);
    expect(row!.children.every((child) => child.pendingReview)).toBe(true);
    expect(row!.settled).toBe(false);
    // Two days in of a thirty-day window.
    expect(row!.expiresInMs).toBeGreaterThan(27 * 24 * 60 * 60_000);
  });

  it('resolves the roster rows a child might be a duplicate of', async () => {
    const db = dbWithRegistration({ possibleDuplicateOf: { '0': ['pco_7'] } });
    db.seed('students/pco_7', {
      status: 'active',
      firstName: 'Robin',
      lastName: 'Fields',
      grade: 9,
    });

    const [row] = await listPendingRegistrations(db, NOW);
    expect(row!.children[0]!.possibleDuplicates).toEqual([
      {
        studentId: 'pco_7',
        firstName: 'Robin',
        lastName: 'Fields',
        grade: 9,
        known: true,
        status: 'active',
      },
    ]);
    expect(row!.children[1]!.possibleDuplicates).toEqual([]);
  });

  it('says so rather than showing a blank when the name lives in a backend', async () => {
    const db = dbWithRegistration({ possibleDuplicateOf: { '0': ['pco_9'] } });
    db.seed('students/pco_9', { status: 'active' });

    const [row] = await listPendingRegistrations(db, NOW);
    expect(row!.children[0]!.possibleDuplicates[0]!.known).toBe(false);
  });
});

describe('approving', () => {
  it('pushes every child, then builds exactly one household', async () => {
    const db = dbWithRegistration();
    const backend = backendWith();
    const result = await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });

    expect(backend.pushStudent).toHaveBeenCalledTimes(2);
    // One call with both children. Per-child approval would mint one household
    // per sibling — the failure `createFamily` exists to avoid.
    expect(backend.createFamily).toHaveBeenCalledTimes(1);
    expect(backend.createFamily).toHaveBeenCalledWith(
      expect.objectContaining({
        studentIds: ['held-1', 'held-2'],
        firstName: 'Dana',
        phone: '5550103344',
      }),
    );
    expect(result.status).toBe('approved');
  });

  it('takes the hold off before pushing, so a failed push is an ordinary queue', async () => {
    const db = dbWithRegistration();
    await approveRegistration({
      db,
      registry: registryOf(backendWith()),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });

    expect(db.get('students/held-1')!.pendingReview).toBe(false);
    expect(db.get('students/held-1')!.reviewedBy).toBe('core-uid');
  });

  it('passes the siblings through, so the new child joins the family that exists', async () => {
    const db = dbWithRegistration({ anchorStudentIds: ['pco_7'] }, ['held-1']);
    const backend = backendWith();
    await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });

    expect(backend.createFamily).toHaveBeenCalledWith(
      expect.objectContaining({ anchorStudentIds: ['pco_7'] }),
    );
  });

  it('sends the allergies the phone form collected, and keeps them nowhere else', async () => {
    const db = dbWithRegistration({ allergies: ['peanuts', null] });
    const backend = backendWith();
    await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });

    expect(backend.updateStudentProfile).toHaveBeenCalledTimes(1);
    expect(backend.updateStudentProfile).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'held-1', allergies: 'peanuts' }),
    );
    expect(db.get('students/held-1')).not.toHaveProperty('allergies');
  });

  it('deletes the record once the guardian has landed', async () => {
    const db = dbWithRegistration();
    await approveRegistration({
      db,
      registry: registryOf(backendWith()),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)).toBeUndefined();
  });

  it('keeps the record — and the number — when the household write failed', async () => {
    const db = dbWithRegistration();
    const backend = backendWith({
      createFamily: vi.fn(async () => {
        throw new Error('Planning Center is down');
      }),
    });
    const result = await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });

    expect(result.status).toBe('partial');
    const record = db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)!;
    expect(record.lastError).toMatch(/Planning Center is down/);
    // Retryable: the guardian's details are still here to try again with.
    expect(record.guardian).toMatchObject({ phone: '5550103344' });
  });

  it('finishes, and forgets the number, when there is nowhere to push', async () => {
    const db = dbWithRegistration();
    const result = await approveRegistration({
      db,
      registry: registryOf(null),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });

    expect(result.status).toBe('approved');
    // Approved and queued in the ordinary way; the record cannot help them.
    expect(db.get('students/held-1')!.pendingReview).toBe(false);
    expect(db.get('students/held-1')!.pcoPushPending).toBe(true);
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)).toBeUndefined();
  });

  /*
   * The expensive, invisible one.
   *
   * A merged-away child is still named on the registration. Pushing that
   * document would create upstream exactly the duplicate the merge was
   * performed to avoid — permanently, since there is no delete anywhere in
   * this codebase and Attendees has no merges at all.
   */
  it('pushes the row that survived a merge, never the one that lost', async () => {
    const db = dbWithRegistration({}, ['held-1']);
    db.seed('students/pco_7', { status: 'active', firstName: 'Robin', lastName: 'Fields' });
    db.seed('students/held-1', {
      ...db.get('students/held-1')!,
      status: 'inactive',
      pendingReview: false,
      mergedIntoStudentId: 'pco_7',
    });

    const backend = backendWith();
    await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });

    expect(backend.pushStudent).toHaveBeenCalledTimes(1);
    expect(backend.pushStudent).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 'pco_7' }),
    );
    // And the guardian lands on the family that was already on file.
    expect(backend.createFamily).toHaveBeenCalledWith(
      expect.objectContaining({ studentIds: ['pco_7'] }),
    );
  });

  /*
   * Under `create` write-back there is no household to build and no
   * `createFamily` to call, so the guardian can never land — not now, not on a
   * retry. Keeping the record as "retryable" would put a button on the Review
   * screen that can never do anything and hold a phone number for thirty days
   * to no purpose.
   */
  it('finishes under create-only write-back, and says the guardian went nowhere', async () => {
    const db = dbWithRegistration();
    /*
     * `parentCreatable` is hardcoded true on both adapters — it says the
     * adapter knows how, not that the deployment allows it. The write-back mode
     * is only discovered inside `createFamily`, which answers `disabled`, so
     * that answer is what has to be recognised as finished.
     */
    const backend = backendWith({
      writeBack: 'create',
      createFamily: vi.fn(async () => ({
        status: 'disabled',
        message: 'Creating families from Tally is switched off.',
      })),
    });
    const result = await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });

    expect(backend.pushStudent).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('approved');
    expect(result.guardian).toBe('disabled');
    expect(result.message).toMatch(/switched off/i);
    // Not kept as retryable: pressing again could never change the answer.
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)).toBeUndefined();
  });

  it('answers rather than throwing for a registration somebody already handled', async () => {
    const db = new FakeFirestore();
    const result = await approveRegistration({
      db,
      registry: registryOf(backendWith()),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });
    expect(result.status).toBe('not-found');
  });
});

describe('discarding', () => {
  it('takes them off the roster without deleting anything', async () => {
    const db = dbWithRegistration();
    const result = await discardRegistration({ db, registrationId: ID, uid: 'core-uid', now: NOW });

    expect(result.deactivated).toBe(2);
    // Inactive, never deleted: attendance records point at these documents and
    // deleting one would drop a head count somebody has already reported.
    expect(db.get('students/held-1')).toMatchObject({
      status: 'inactive',
      pendingReview: false,
      pcoPushPending: false,
    });
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)).toBeUndefined();
  });

  it('leaves alone a child somebody has already approved', async () => {
    const db = dbWithRegistration();
    db.seed('students/held-1', {
      ...db.get('students/held-1')!,
      pendingReview: false,
      pcoPersonId: 'pco_400',
    });

    const result = await discardRegistration({ db, registrationId: ID, uid: 'core-uid', now: NOW });
    expect(result.deactivated).toBe(1);
    // In the church's database now; taking them off Tally's roster is a
    // different decision, made on the Students screen.
    expect(db.get('students/held-1')!.status).toBe('active');
    expect(db.get('students/held-2')!.status).toBe('inactive');
  });
});
