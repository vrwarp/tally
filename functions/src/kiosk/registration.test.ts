/**
 * What the server does with a family that typed itself in.
 *
 * Three groups of claims, in the order they cost somebody something:
 *
 *   - **Refusals.** This is the only write in Tally requested by somebody who
 *     is not on the team, so what it will not accept is the interesting half.
 *   - **The documents.** A child registered here has to look exactly like a
 *     child quick-added at the door, or they fall out of the dashboard lists
 *     the core team works from — plus the one field that differs, which is what
 *     stops the create trigger racing this request's own push.
 *   - **A retry.** A parent taps once; a wifi blip means the call runs twice.
 *     One family either way, or the roster grows a duplicate every time a lobby
 *     has bad signal.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BackendRegistry } from '../backends/registry.js';
import type { PeopleBackend } from '../backends/types.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { PENDING_LAST4_DOC, PHONE_INDEX_DOC } from './phoneIndex.js';
import {
  parseRegisterFamilyRequest,
  registerFamily,
  REGISTRATIONS_COLLECTION,
  RegistrationInputError,
  type RegisterFamilyResult,
} from './registration.js';

const NOW = new Date('2026-08-07T19:05:00Z');
const EVENT_START = new Date('2026-08-07T19:00:00Z');

function goodRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    registrationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    children: [
      { firstName: 'Robin', lastName: 'Fields', grade: 4 },
      { firstName: 'Sam', lastName: 'Fields', grade: null },
    ],
    guardian: { firstName: 'Dana', lastName: 'Fields', phone: '555-010-3344' },
    ...overrides,
  };
}

function dbWithEvent(): FakeFirestore {
  const db = new FakeFirestore();
  db.seed('events/friday-today', {
    status: 'scheduled',
    seriesId: 'friday-fellowship',
    startAt: EVENT_START,
  });
  return db;
}

/** A registry whose default push target is whatever the test wants it to be. */
function registryOf(backend: PeopleBackend | null): BackendRegistry {
  return {
    ids: () => (backend ? [backend.id] : []),
    get: () => backend,
    defaultPush: () => (backend ? { backend } : { error: 'Nothing is connected.' }),
  } as unknown as BackendRegistry;
}

function backendWith(
  overrides: Partial<PeopleBackend> & { writeBack?: 'off' | 'create' | 'full' } = {},
): PeopleBackend {
  const { writeBack = 'full', ...rest } = overrides;
  return {
    id: 'pco',
    displayName: 'Planning Center',
    capabilities: { writeBack, parentCreatable: writeBack === 'full' },
    pushStudent: vi.fn(async () => ({ status: 'created' })),
    updateStudentProfile: vi.fn(async () => ({ status: 'updated' })),
    createFamily: vi.fn(async () => ({ status: 'created' })),
    resetCache: vi.fn(),
    invalidateReachability: vi.fn(),
    ...rest,
  } as unknown as PeopleBackend;
}

async function run(
  db: FakeFirestore,
  args: {
    data?: Record<string, unknown>;
    backend?: PeopleBackend | null;
    source?: 'kiosk' | 'qr';
  } = {},
): Promise<RegisterFamilyResult> {
  const source = args.source ?? 'kiosk';
  return registerFamily({
    db,
    registry: registryOf(args.backend === undefined ? backendWith() : args.backend),
    request: parseRegisterFamilyRequest(args.data ?? goodRequest(), source),
    context:
      source === 'kiosk'
        ? { source, uid: 'staff-uid', eventId: 'friday-today' }
        : { source },
    now: NOW,
  });
}

/* -------------------------------------------------------------------------- */

describe('what it refuses', () => {
  const refusals: [string, Record<string, unknown>][] = [
    ['no children at all', { children: [] }],
    ['more children than one go takes', { children: Array.from({ length: 7 }, () => ({ firstName: 'A', lastName: 'B', grade: 1 })) }],
    ['a name with a number in it', { children: [{ firstName: 'Room 3', lastName: 'Fields', grade: 4 }] }],
    ['a name that is only punctuation', { children: [{ firstName: "''", lastName: 'Fields', grade: 4 }] }],
    ['a grade off the end of the band', { children: [{ firstName: 'Robin', lastName: 'Fields', grade: 13 }] }],
    ['a phone number that is too short', { guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5550103' } }],
    ['a phone number nobody could ring', { guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5555555555' } }],
    ['a registration id somebody made up', { registrationId: 'short' }],
  ];

  it.each(refusals)('refuses %s', (_label, overrides) => {
    expect(() => parseRegisterFamilyRequest(goodRequest(overrides), 'kiosk')).toThrow(
      RegistrationInputError,
    );
  });

  it('accepts a number written the way people write one', () => {
    const parsed = parseRegisterFamilyRequest(
      goodRequest({ guardian: { firstName: 'Dana', lastName: 'Fields', phone: '+1 (555) 010-3344' } }),
      'kiosk',
    );
    expect(parsed.guardian.phone).toBe('5550103344');
  });

  it('refuses allergies from a kiosk, where nothing would ever display them', () => {
    expect(() => parseRegisterFamilyRequest(goodRequest({ allergies: ['peanuts', null] }), 'kiosk')).toThrow(
      RegistrationInputError,
    );
    // The same request from a phone is fine — that form has the field.
    expect(parseRegisterFamilyRequest(goodRequest({ allergies: ['peanuts', null] }), 'qr').allergies).toEqual([
      'peanuts',
      null,
    ]);
  });
});

describe('the documents it writes', () => {
  it('creates each child the way a quick-added visitor is created', async () => {
    const db = dbWithEvent();
    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');

    const child = db.get(`students/${result.children[0]!.studentId}`)!;
    expect(child).toMatchObject({
      firstName: 'Robin',
      lastName: 'Fields',
      grade: 4,
      status: 'active',
      isVisitor: true,
      searchName: 'robin fields',
      pcoPersonId: null,
      pcoPushPending: true,
      createdBy: 'staff-uid',
    });
    // The one field a quick-add has not got: what tells `onStudentCreated` to
    // stand down, because this request pushes its own children.
    expect(child.registrationId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    // No grade is an absent key, never a zero — a nursery child has none.
    expect(db.get(`students/${result.children[1]!.studentId}`)).not.toHaveProperty('grade');
  });

  it('checks everybody in against the gathering, keyed by student id', async () => {
    const db = dbWithEvent();
    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');

    for (const child of result.children) {
      expect(db.get(`events/friday-today/attendance/${child.studentId}`)).toMatchObject({
        studentId: child.studentId,
        eventId: 'friday-today',
        // Read from the event document, never from the request: it decides
        // which repeat chain the visit counts towards.
        seriesId: 'friday-fellowship',
        method: 'kiosk',
        isFirstEver: true,
        checkedInBy: 'staff-uid',
      });
    }
    expect(result.checkedIn).toBe(true);
  });

  it('makes the family findable by their four digits immediately', async () => {
    const db = dbWithEvent();
    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');

    const ids = result.children.map((child) => child.studentId).sort();
    expect(result.last4).toBe('3344');
    // The live index, patched now rather than at the nightly rebuild.
    expect((db.get(PHONE_INDEX_DOC)!.last4 as Record<string, string[]>)['3344']).toEqual(ids);
    // And the overlay, so a rebuild cannot take it away again.
    const entries = db.get(PENDING_LAST4_DOC)!.entries as Record<string, { last4: string }>;
    expect(entries['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']).toMatchObject({ last4: '3344' });
  });

  it('creates without checking anybody in when the request came from a phone', async () => {
    const db = dbWithEvent();
    const result = await run(db, { source: 'qr' });
    if (result.status !== 'created') throw new Error('expected created');

    expect(result.checkedIn).toBe(false);
    expect(db.writtenPaths('events/')).toEqual([]);
    // Nobody was signed in, so the record says so rather than borrowing a uid.
    expect(db.get(`students/${result.children[0]!.studentId}`)!.createdBy).toBe('kiosk-registration');
    expect(db.get(`students/${result.children[0]!.studentId}`)!.firstAttendedAt).toBeNull();
  });
});

describe('a family already on the roster', () => {
  it('sends them to search instead, and writes nothing at all', async () => {
    const db = dbWithEvent();
    db.seed('students/pco_7', { status: 'active', searchName: 'robin fields' });

    const result = await run(db);
    expect(result.status).toBe('duplicate');
    if (result.status !== 'duplicate') return;
    expect(result.duplicateIndexes).toEqual([0]);
    expect(result.message).toMatch(/already on our list/);

    // Not one child, not the sibling who is genuinely new: a half-registered
    // family is worse than one told to search.
    expect(db.writtenPaths('students/')).toEqual([]);
    // The claim is taken before the roster is read — otherwise a retry would
    // find its own children and call them duplicates — and released again here,
    // so a refusal leaves nothing behind for the family's next attempt.
    expect(db.get(`${REGISTRATIONS_COLLECTION}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`)).toBeUndefined();
  });

  it('ignores somebody who has left the roster', async () => {
    const db = dbWithEvent();
    db.seed('students/pco_7', { status: 'inactive', searchName: 'robin fields' });

    expect((await run(db)).status).toBe('created');
  });

  it('matches on the name alone, whatever grade the office recorded', async () => {
    const db = dbWithEvent();
    db.seed('students/pco_7', { status: 'active', firstName: 'Robin', lastName: 'Fields', grade: 9 });

    expect((await run(db)).status).toBe('duplicate');
  });
});

describe('a retried call', () => {
  it('answers the second one instead of creating a second family', async () => {
    const db = dbWithEvent();
    const first = await run(db);
    if (first.status !== 'created') throw new Error('expected created');

    const second = await run(db);
    if (second.status !== 'created') throw new Error('expected created');

    expect(second.children.map((child) => child.studentId)).toEqual(
      first.children.map((child) => child.studentId),
    );
    expect(second.last4).toBe(first.last4);
    // Two children exist, not four.
    expect([...db.data.keys()].filter((path) => path.startsWith('students/'))).toHaveLength(2);
  });

  it('finishes a run that died before it could mark itself complete', async () => {
    const db = dbWithEvent();
    // The claim exists with its ids; the batch never landed.
    db.seed(`${REGISTRATIONS_COLLECTION}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`, {
      status: 'pending',
      source: 'kiosk',
      eventId: 'friday-today',
      studentIds: ['resumed-1', 'resumed-2'],
      childCount: 2,
      last4: '3344',
      checkedIn: true,
      createdAt: NOW,
    });

    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');
    expect(result.children.map((child) => child.studentId)).toEqual(['resumed-1', 'resumed-2']);
    expect(db.get('students/resumed-1')).toBeDefined();
    expect(db.get(`${REGISTRATIONS_COLLECTION}/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`)!.status).toBe(
      'complete',
    );
  });
});

describe('what reaches the church database', () => {
  it('pushes every child, then builds one family around all of them', async () => {
    const db = dbWithEvent();
    const backend = backendWith();
    const result = await run(db, { backend });
    if (result.status !== 'created') throw new Error('expected created');

    expect(backend.pushStudent).toHaveBeenCalledTimes(2);
    // One call with both children — not one household per sibling.
    expect(backend.createFamily).toHaveBeenCalledTimes(1);
    expect(backend.createFamily).toHaveBeenCalledWith(
      expect.objectContaining({
        studentIds: result.children.map((child) => child.studentId),
        firstName: 'Dana',
        lastName: 'Fields',
        phone: '5550103344',
      }),
    );
    expect(result.guardian.upstream).toBe('created');
  });

  it('degrades to children-only when write-back cannot build a family', async () => {
    const db = dbWithEvent();
    const backend = backendWith({ writeBack: 'create' });
    const result = await run(db, { backend });
    if (result.status !== 'created') throw new Error('expected created');

    expect(backend.pushStudent).toHaveBeenCalledTimes(2);
    expect(backend.createFamily).not.toHaveBeenCalled();
    expect(result.guardian.upstream).toBe('skipped');
    // The digits still work, which is the half the family will actually use.
    expect((db.get(PHONE_INDEX_DOC)!.last4 as Record<string, string[]>)['3344']).toHaveLength(2);
  });

  it('leaves the children queued when no backend is connected', async () => {
    const db = dbWithEvent();
    const result = await run(db, { backend: null });
    if (result.status !== 'created') throw new Error('expected created');

    // `pushPendingVisitors` is what picks these up; the flag staying set is the
    // whole mechanism.
    expect(db.get(`students/${result.children[0]!.studentId}`)!.pcoPushPending).toBe(true);
    expect(result.guardian.upstream).toBe('skipped');
  });

  it('still registers the family when the household write fails', async () => {
    const db = dbWithEvent();
    const backend = backendWith({
      createFamily: vi.fn(async () => {
        throw new Error('Planning Center is down');
      }),
    });
    const result = await run(db, { backend });
    if (result.status !== 'created') throw new Error('expected created');

    // The family is standing at the screen; an upstream outage is not their
    // problem and must not be their answer.
    expect(result.guardian.upstream).toBe('failed');
    expect(db.get(`events/friday-today/attendance/${result.children[0]!.studentId}`)).toBeDefined();
  });

  it('sends allergies upstream and never writes them down', async () => {
    const db = dbWithEvent();
    const backend = backendWith();
    const result = await run(db, {
      source: 'qr',
      backend,
      data: goodRequest({ allergies: ['peanuts', null] }),
    });
    if (result.status !== 'created') throw new Error('expected created');

    expect(backend.updateStudentProfile).toHaveBeenCalledTimes(1);
    expect(backend.updateStudentProfile).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: result.children[0]!.studentId, allergies: 'peanuts' }),
    );
    // The rules forbid the key outright; this is the same claim one layer up.
    expect(db.get(`students/${result.children[0]!.studentId}`)).not.toHaveProperty('allergies');
  });
});

describe('what is never stored', () => {
  it('keeps the parent out of Firestore entirely', async () => {
    const db = dbWithEvent();
    const result = await run(db);
    if (result.status !== 'created') throw new Error('expected created');

    const everything = JSON.stringify([...db.data.entries()]);
    // Not the number, and not the parent's name either: `noMirroredPersonalData`
    // forbids both on a student, and nothing else here is a place to hide them.
    expect(everything).not.toContain('5550103344');
    expect(everything).not.toContain('Dana');
    // Four digits, which is the bargain that lets the index exist at all.
    expect(everything).toContain('3344');
  });
});
