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
import type { CreateFamilyResult, PeopleBackend } from '../backends/types.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { PHONE_INDEX_DOC } from './phoneIndex.js';
import { PULSE_DOC } from './pulse.js';
import { REGISTRATIONS_COLLECTION } from './registration.js';
import { approveRegistration, discardRegistration, listPendingRegistrations } from './review.js';

/**
 * A whole `CreateFamilyResult`, because a partial one is not a double of
 * anything.
 *
 * Only two of these fields are ever asserted on, and it would be tempting to
 * return just those — but `backendWith` casts its own literal, so a short
 * object there typechecks while the same object passed *in* does not, and the
 * shape a caller may rely on stops being obvious. The real adapter always
 * returns every field; so does this.
 */
function familyResult(
  status: CreateFamilyResult['status'],
  message: string,
): CreateFamilyResult {
  return {
    status,
    contactName: null,
    parentPersonId: null,
    createdPerson: false,
    createdHousehold: false,
    linkedChildren: [],
    wrote: [],
    skipped: [],
    message,
  };
}

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
     * `adultCreatable: true` regardless of the mode, because that is what both
     * real adapters do — it says the adapter knows how to build a family, not
     * that this deployment permits one. The write-back mode is only discovered
     * inside `createFamily`, which answers `disabled`. A double that folded the
     * two together would hide exactly the case below.
     */
    capabilities: { writeBack, adultCreatable: true },
    pushStudent: vi.fn(async () => ({ status: 'created' })),
    updateStudentProfile: vi.fn(async () => ({ status: 'updated' })),
    createFamily: vi.fn(async () => familyResult('created', 'Added the family.')),
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
      upstreamPushPending: true,
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
        // No phone index seeded here, so no signal either way — see the two
        // tests below for what this field is for.
        sharesFamilyDigits: false,
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

  it('marks the candidate the church already finds under the family’s own digits', async () => {
    /*
     * A name and a grade are often not enough: two children can share both, and
     * a grade rolls over between terms. The phone index settles it — if the
     * church already answers for that roster row under the number this family
     * typed, they are almost certainly the same household.
     */
    const db = dbWithRegistration({
      last4: '3344',
      possibleDuplicateOf: { '0': ['roster-same-family', 'roster-stranger'] },
    });
    db.seed('students/roster-same-family', { firstName: 'Robin', lastName: 'Fields', status: 'active' });
    db.seed('students/roster-stranger', { firstName: 'Robin', lastName: 'Fields', status: 'active' });
    db.seed(PHONE_INDEX_DOC, { last4: { '3344': ['roster-same-family'] } });

    const [row] = await listPendingRegistrations(db, NOW);
    const [sameFamily, stranger] = row!.children[0]!.possibleDuplicates;
    expect(sameFamily!.sharesFamilyDigits).toBe(true);
    // Two rows with the same name and the same grade, and only one of them is
    // this family's — which is the whole reason the flag exists.
    expect(stranger!.sharesFamilyDigits).toBe(false);
  });

  it('treats a missing phone index as no signal rather than as no match', async () => {
    const db = dbWithRegistration({ possibleDuplicateOf: { '0': ['roster-1'] } });
    db.seed('students/roster-1', { firstName: 'Robin', lastName: 'Fields', status: 'active' });

    const [row] = await listPendingRegistrations(db, NOW);
    expect(row!.children[0]!.possibleDuplicates[0]!.sharesFamilyDigits).toBe(false);
  });

  it('asks the backend for the names it holds, so a candidate is never anonymous', async () => {
    /*
     * The screen lists candidates side by side and asks which of them is the
     * same child. An option reading "a student on the roster" cannot be told
     * from the one above it, and the wrong answer is a duplicate in a database
     * with no delete — so the names are fetched rather than shrugged at.
     */
    const db = dbWithRegistration({ possibleDuplicateOf: { '0': ['pco_9'] } });
    db.seed('students/pco_9', { status: 'active' });
    const fetchRoster = vi.fn(async () => ({
      people: [
        {
          id: 'pco_9',
          pcoPersonId: '9',
          backendId: 'pco' as const,
          firstName: 'Ethan',
          lastName: 'Nguyen',
          grade: 9,
          status: 'active' as const,
          searchName: 'ethan nguyen',
        },
      ],
      unresolved: [],
    }));

    const [row] = await listPendingRegistrations(db, NOW, {
      registry: registryOf(backendWith({ fetchRoster } as unknown as Partial<PeopleBackend>)),
    });

    const candidate = row!.children[0]!.possibleDuplicates[0]!;
    expect(candidate.known).toBe(true);
    expect(candidate.firstName).toBe('Ethan');
    expect(candidate.grade).toBe(9);
    // One call for the page, not one per candidate: a queue of a dozen
    // families would otherwise walk the backend's rate limit on page load.
    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });

  it('leaves the labels alone when the backend cannot be reached', async () => {
    const db = dbWithRegistration({ possibleDuplicateOf: { '0': ['pco_9'] } });
    db.seed('students/pco_9', { status: 'active' });
    const fetchRoster = vi.fn(async () => {
      throw new Error('Planning Center is unavailable');
    });

    const [row] = await listPendingRegistrations(db, NOW, {
      registry: registryOf(backendWith({ fetchRoster } as unknown as Partial<PeopleBackend>)),
    });

    // Degraded and honest: the same screen this shipped with, never an empty
    // line and never a thrown page.
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
    // And *which* half failed, so the screen offers finishing-without-the-adult
    // rather than a retry of the refusal.
    expect(record.lastErrorKind).toBe('guardian');
  });

  it('records which half failed when the children are the ones the backend refused', async () => {
    const db = dbWithRegistration();
    const pushStudent = vi.fn(async () => ({ status: 'skipped' as const }));
    await approveRegistration({
      db,
      registry: registryOf(backendWith({ pushStudent } as unknown as Partial<PeopleBackend>)),
      registrationId: ID,
      uid: 'core-uid',
      now: NOW,
    });

    // Worth retrying — the usual cause is an outage that has since passed —
    // which is the opposite of the guardian case above.
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)!.lastErrorKind).toBe('children');
  });

  it('can finish without the adult, for a household the backend will not build', async () => {
    /*
     * The dead end this exists to end: a guardian write refused for a reason no
     * retry can fix. Before, the record survived for ever offering a button
     * that reattempted the same refusal, and the only alternative was
     * discarding a family whose children may already be upstream where nothing
     * deletes them.
     */
    const db = dbWithRegistration();
    const createFamily = vi.fn(async () => familyResult('created', 'Added the family.'));
    const backend = backendWith({ createFamily });

    const result = await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      uid: 'core-uid',
      withoutGuardian: true,
      now: NOW,
    });

    // The children land; the adult is never attempted, not merely failed.
    expect(result.status).toBe('approved');
    expect(result.pushed).toBe(2);
    expect(createFamily).not.toHaveBeenCalled();
    expect(result.message).toMatch(/were not recorded in Planning Center/i);
    // And the job is over: the record goes, and the number with it, rather
    // than being held thirty days to serve a retry the reviewer declined.
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)).toBeUndefined();
  });

  it('still pushes nobody twice when finishing without the adult', async () => {
    // The children are already upstream from the attempt that half-failed;
    // finishing must not create second people for them.
    const db = dbWithRegistration({ lastError: 'That number is already on file.' });
    const pushStudent = vi.fn(async () => ({ status: 'skipped' as const }));
    const result = await approveRegistration({
      db,
      registry: registryOf(backendWith({ pushStudent } as unknown as Partial<PeopleBackend>)),
      registrationId: ID,
      uid: 'core-uid',
      withoutGuardian: true,
      now: NOW,
    });

    expect(pushStudent).toHaveBeenCalledTimes(2);
    // A skip is not a landing, so the record stays and says so — finishing
    // without the adult is not a licence to declare the children done.
    expect(result.status).toBe('partial');
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)).toBeDefined();
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
    expect(db.get('students/held-1')!.upstreamPushPending).toBe(true);
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
     * `adultCreatable` is hardcoded true on both adapters — it says the
     * adapter knows how, not that the deployment allows it. The write-back mode
     * is only discovered inside `createFamily`, which answers `disabled`, so
     * that answer is what has to be recognised as finished.
     */
    const backend = backendWith({
      writeBack: 'create',
      createFamily: vi.fn(async () =>
        familyResult('disabled', 'Creating families from Tally is switched off.'),
      ),
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
      upstreamPushPending: false,
    });
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)).toBeUndefined();
    // The lobby screens are told, so the kiosk stops offering a check-in for
    // children a reviewer just said were not real.
    expect((db.get(PULSE_DOC)?.roster as { rev?: number })?.rev).toBeDefined();
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

/* -------------------------------------------------------------------------- */
/* One family, two cards                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The case a real Planning Center showed: one household registering twice on
 * one night, same number, one child each time.
 *
 * Approved a card at a time, the parent was correctly deduplicated and a second
 * household was built around them anyway — one adult heading two families, in a
 * database with no merge for households. The backends now survive that press
 * on their own; this is the other half, where the reviewer can see the two
 * cards are one family and say so before anything is written.
 */
describe('two registrations, one household', () => {
  const OTHER = 'ffffffff-1111-2222-3333-444444444444';

  /** A second card for the same family: same digits, a different child. */
  function withSecondRegistration(db: FakeFirestore): FakeFirestore {
    db.seed('students/held-3', {
      firstName: 'Ada',
      lastName: 'Fields',
      status: 'active',
      isVisitor: true,
      upstreamPushPending: true,
      pendingReview: true,
      registrationId: OTHER,
    });
    db.seed(`${REGISTRATIONS_COLLECTION}/${OTHER}`, {
      status: 'complete',
      source: 'kiosk',
      eventId: 'friday-today',
      studentIds: ['held-3'],
      childCount: 1,
      last4: '3344',
      checkedIn: true,
      createdAt: REGISTERED_AT,
      // Written differently on purpose — the same ten digits is the test.
      guardian: { firstName: 'Dana', lastName: 'Fields', phone: '(555) 010-3344' },
      children: [{ firstName: 'Ada', lastName: 'Fields', grade: 6 }],
      allergies: [],
      possibleDuplicateOf: {},
      anchorStudentIds: [],
      lastError: null,
    });
    return db;
  }

  it('tells a reviewer that another card typed the same number', async () => {
    const db = withSecondRegistration(dbWithRegistration());
    const rows = await listPendingRegistrations(db, NOW, { registry: registryOf(backendWith()) });

    // Symmetric: a reviewer works down the queue and has to see it from
    // whichever card they reach first.
    const first = rows.find((row) => row.registrationId === ID)!;
    const second = rows.find((row) => row.registrationId === OTHER)!;
    expect(first.sameFamily.map((hint) => hint.registrationId)).toEqual([OTHER]);
    expect(second.sameFamily.map((hint) => hint.registrationId)).toEqual([ID]);
    // Named, not counted — three cards on screen and the reviewer has to know
    // which one it means.
    expect(first.sameFamily[0]!.guardianName).toBe('Dana Fields');
    expect(first.sameFamily[0]!.childNames).toEqual(['Ada Fields']);
  });

  it('reports the other card’s unsettled children, so grouping cannot reach around them', async () => {
    const db = withSecondRegistration(dbWithRegistration());
    // A roster row Ada collides with — the other card's approve button is held
    // on it, and a press on this card would otherwise push her regardless.
    db.seed('students/roster-ada', { firstName: 'Ada', lastName: 'Fields', status: 'active' });
    db.seed(`${REGISTRATIONS_COLLECTION}/${OTHER}`, {
      ...db.get(`${REGISTRATIONS_COLLECTION}/${OTHER}`)!,
      possibleDuplicateOf: { '0': ['roster-ada'] },
    });

    const rows = await listPendingRegistrations(db, NOW, { registry: registryOf(backendWith()) });
    const first = rows.find((row) => row.registrationId === ID)!;
    expect(first.sameFamily[0]!.unsettledChildren).toBe(1);
    // And the other way round, where there is nothing to settle.
    const second = rows.find((row) => row.registrationId === OTHER)!;
    expect(second.sameFamily[0]!.unsettledChildren).toBe(0);
  });

  it('does not tie together families who merely share four digits', async () => {
    const db = withSecondRegistration(dbWithRegistration());
    db.seed(`${REGISTRATIONS_COLLECTION}/${OTHER}`, {
      ...db.get(`${REGISTRATIONS_COLLECTION}/${OTHER}`)!,
      guardian: { firstName: 'Rosa', lastName: 'Salgado', phone: '5559993344' },
    });

    const rows = await listPendingRegistrations(db, NOW, { registry: registryOf(backendWith()) });
    expect(rows.every((row) => row.sameFamily.length === 0)).toBe(true);
  });

  it('approves both cards as one family, with one call for the household', async () => {
    const db = withSecondRegistration(dbWithRegistration());
    const backend = backendWith();

    const result = await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      withRegistrationIds: [OTHER],
      uid: 'core-uid',
      now: NOW,
    });

    expect(result.status).toBe('approved');
    // Every child of both cards, and exactly one household for the lot — the
    // failure `createFamily` exists to avoid, now reachable from two records.
    expect(backend.pushStudent).toHaveBeenCalledTimes(3);
    expect(backend.createFamily).toHaveBeenCalledTimes(1);
    expect(backend.createFamily).toHaveBeenCalledWith(
      expect.objectContaining({ studentIds: ['held-1', 'held-2', 'held-3'] }),
    );
    // Both records go: neither can help any more, and each holds a number.
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)).toBeUndefined();
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${OTHER}`)).toBeUndefined();
    expect(db.get('students/held-3')!.pendingReview).toBe(false);
  });

  it('keeps every card in the group when the family write fails', async () => {
    const db = withSecondRegistration(dbWithRegistration());
    const backend = backendWith({
      createFamily: vi.fn(async () => familyResult('no-linked-children', 'Nothing to build.')),
    });

    const result = await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      withRegistrationIds: [OTHER],
      uid: 'core-uid',
      now: NOW,
    });

    // All or none. A half-kept group offers a retry carrying some of the
    // children and silently dropping the rest, and a household built from
    // what is left is the second family this whole change exists to stop.
    expect(result.status).toBe('partial');
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)!.lastErrorKind).toBe('guardian');
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${OTHER}`)!.lastErrorKind).toBe('guardian');
  });

  it('carries on when a card in the group was already dealt with', async () => {
    const db = dbWithRegistration();
    const backend = backendWith();

    const result = await approveRegistration({
      db,
      registry: registryOf(backend),
      registrationId: ID,
      withRegistrationIds: [OTHER],
      uid: 'core-uid',
      now: NOW,
    });

    // Somebody's other tab got there first, which is not a reason to strand
    // the family in front of this reviewer.
    expect(result.status).toBe('approved');
    expect(backend.createFamily).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* The adult, decided by a person rather than by a phone number                */
/* -------------------------------------------------------------------------- */

describe('who each child already is', () => {
  it('offers the people the backend has, and never one the roster already holds', async () => {
    const backend = backendWith({
      findStudentCandidates: vi.fn(async () => [
        { personId: '55', name: 'Robin Fields', grade: 4, wouldMatch: true },
        // Already a roster row below, so already offered — under the *other*
        // heading, as a merge. Asking about the same person twice, in two
        // framings with two different consequences, is the confusion this
        // suppression exists to prevent.
        { personId: '7', name: 'Robin Fields', grade: 4, wouldMatch: false },
      ]),
    });
    const db = dbWithRegistration({}, ['held-1']);
    db.seed('students/pco_7', { firstName: 'Robin', lastName: 'Fields', status: 'active' });

    const [row] = await listPendingRegistrations(db, NOW, { registry: registryOf(backend) });

    expect(row!.children[0]!.upstreamCandidates.map((c) => c.personId)).toEqual(['55']);
  });

  it('asks once for children who share a name and a grade', async () => {
    const backend = backendWith({ findStudentCandidates: vi.fn(async () => []) });
    const db = dbWithRegistration({}, ['held-1', 'held-2']);

    await listPendingRegistrations(db, NOW, { registry: registryOf(backend) });

    // Two children, two distinct names, two searches — but a queue full of
    // repeats collapses to one apiece, which is what keeps this affordable.
    expect(backend.findStudentCandidates).toHaveBeenCalledTimes(2);
  });

  it('asks nothing about a child the push already linked', async () => {
    // Cast for the same reason every other `fetchRoster` double here is cast:
    // `RosterResult` carries five bookkeeping fields this assertion has no
    // opinion about, and spelling them out would bury what the test is for.
    const backend = backendWith({
      findStudentCandidates: vi.fn(async () => []),
      fetchRoster: vi.fn(async () => ({
        people: [
          {
            id: 'pco_55',
            pcoPersonId: '55',
            backendId: 'pco' as const,
            firstName: 'Robin',
            lastName: 'Fields',
            grade: 4,
            status: 'active' as const,
            searchName: 'robin fields',
          },
        ],
        unresolved: [],
      })),
    } as unknown as Partial<PeopleBackend>);
    const db = dbWithRegistration({}, ['held-1']);
    db.seed('students/held-1', {
      firstName: 'Robin',
      lastName: 'Fields',
      status: 'active',
      pendingReview: false,
      upstreamPersonId: '55',
      registrationId: ID,
    });

    const [row] = await listPendingRegistrations(db, NOW, { registry: registryOf(backend) });

    // A counselor's card: the trigger pushed this child minutes after the door,
    // so the question is closed. It is *named* rather than re-asked.
    expect(backend.findStudentCandidates).not.toHaveBeenCalled();
    expect(row!.children[0]!.linkedTo).toEqual({ personId: '55', name: 'Robin Fields' });
  });

  it('leaves the queue standing when the backend cannot answer', async () => {
    const backend = backendWith({
      findStudentCandidates: vi.fn(async () => {
        throw new Error('Planning Center is down.');
      }),
    });

    const [row] = await listPendingRegistrations(dbWithRegistration({}, ['held-1']), NOW, {
      registry: registryOf(backend),
    });

    expect(row!.children[0]!.upstreamCandidates).toEqual([]);
  });

  it('asks nobody when the deployment takes no writes at all', async () => {
    const backend = backendWith({ writeBack: 'off', findStudentCandidates: vi.fn(async () => []) });

    await listPendingRegistrations(dbWithRegistration({}, ['held-1']), NOW, {
      registry: registryOf(backend),
    });

    expect(backend.findStudentCandidates).not.toHaveBeenCalled();
  });
});

describe('who the guardian already is', () => {
  it('offers the adults the backend already has, with the phone evidence', async () => {
    const backend = backendWith({
      findAdultCandidates: vi.fn(async () => [
        { personId: '900', name: 'Dana Fields', reachable: true, corroborated: true },
        { personId: '901', name: 'Dana Fields', reachable: false, corroborated: false },
      ]),
    });

    const [row] = await listPendingRegistrations(dbWithRegistration(), NOW, {
      registry: registryOf(backend),
    });

    expect(row!.guardianCandidates).toHaveLength(2);
    expect(backend.findAdultCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Dana', lastName: 'Fields', phone: '5550103344' }),
    );
  });

  it('asks nobody when the deployment could not build a family anyway', async () => {
    const backend = backendWith({ writeBack: 'create', findAdultCandidates: vi.fn(async () => []) });
    const [row] = await listPendingRegistrations(dbWithRegistration(), NOW, {
      registry: registryOf(backend),
    });

    expect(backend.findAdultCandidates).not.toHaveBeenCalled();
    expect(row!.guardianCandidates).toEqual([]);
  });

  it('leaves the queue standing when the backend cannot answer', async () => {
    const backend = backendWith({
      findAdultCandidates: vi.fn(async () => {
        throw new Error('Planning Center is down.');
      }),
    });

    const [row] = await listPendingRegistrations(dbWithRegistration(), NOW, {
      registry: registryOf(backend),
    });

    // Empty is "we did not find out", and the screen must not read it as
    // evidence that the guardian is new — but the card still works.
    expect(row!.guardianCandidates).toEqual([]);
    expect(row!.children).toHaveLength(2);
  });

  it("passes a reviewer's choice through instead of letting the backend guess", async () => {
    const backend = backendWith();
    await approveRegistration({
      db: dbWithRegistration(),
      registry: registryOf(backend),
      registrationId: ID,
      guardianPersonId: '900',
      uid: 'core-uid',
      now: NOW,
    });

    expect(backend.createFamily).toHaveBeenCalledWith(
      expect.objectContaining({ parentPersonId: '900', createNewParent: false }),
    );
  });

  it('passes "none of these" through as its own decision', async () => {
    const backend = backendWith();
    await approveRegistration({
      db: dbWithRegistration(),
      registry: registryOf(backend),
      registrationId: ID,
      createNewGuardian: true,
      uid: 'core-uid',
      now: NOW,
    });

    // Distinct from sending nothing, which means nobody was asked: this
    // suppresses the corroboration guess.
    expect(backend.createFamily).toHaveBeenCalledWith(
      expect.objectContaining({ parentPersonId: null, createNewParent: true }),
    );
  });
});
