/**
 * What the server does with a parent a counselor was given at a door.
 *
 * The claims worth making are about restraint. This call must leave the child
 * exactly as the quick-add left them — on the roster, checked in, queued for
 * the church's database in the ordinary way — put the adult somewhere no client
 * can read, and be safe to make twice.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { PENDING_LAST4_DOC, PHONE_INDEX_DOC } from './phoneIndex.js';
import { REGISTRATIONS_COLLECTION, RegistrationInputError } from './registration.js';
import {
  parseRecordVisitorParentRequest,
  recordVisitorParent,
  type RecordVisitorParentResult,
} from './visitorParent.js';

const NOW = new Date('2026-08-07T19:05:00Z');
const REGISTRATION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function goodRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    studentId: 'student-1',
    registrationId: REGISTRATION_ID,
    guardian: { firstName: 'Dana', lastName: 'Fields', phone: '555-010-3344' },
    eventId: 'friday-today',
    ...overrides,
  };
}

/** A roster exactly as `quickAddAndCheckIn` leaves it. */
function dbWithVisitor(student: Record<string, unknown> = {}): FakeFirestore {
  const db = new FakeFirestore();
  db.seed('students/student-1', {
    firstName: 'Robin',
    lastName: 'Fields',
    grade: 9,
    status: 'active',
    isVisitor: true,
    upstreamPushPending: true,
    pcoPersonId: null,
    searchName: 'robin fields',
    ...student,
  });
  db.seed('events/friday-today/attendance/student-1', {
    studentId: 'student-1',
    eventId: 'friday-today',
    method: 'quick-add',
  });
  return db;
}

async function run(
  db: FakeFirestore,
  args: { data?: Record<string, unknown> } = {},
): Promise<RecordVisitorParentResult> {
  return recordVisitorParent({
    db,
    request: parseRecordVisitorParentRequest(args.data ?? goodRequest()),
    uid: 'counselor-uid',
    now: NOW,
  });
}

function recordFor(db: FakeFirestore, id = REGISTRATION_ID) {
  return db.get(`${REGISTRATIONS_COLLECTION}/${id}`)!;
}

/* -------------------------------------------------------------------------- */

describe('what it refuses', () => {
  const refusals: [string, Record<string, unknown>][] = [
    ['a name with a number in it', { guardian: { firstName: 'Room 3', lastName: 'Fields', phone: '5550103344' } }],
    ['a parent with no surname', { guardian: { firstName: 'Dana', lastName: '', phone: '5550103344' } }],
    ['a number that is too short', { guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5550103' } }],
    ['a number nobody could ring', { guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5555555555' } }],
    ['a registration id somebody made up', { registrationId: 'short' }],
    ['no student at all', { studentId: '' }],
  ];

  it.each(refusals)('refuses %s', (_label, overrides) => {
    expect(() => parseRecordVisitorParentRequest(goodRequest(overrides))).toThrow(
      RegistrationInputError,
    );
  });

  it('accepts a number written the way people write one', () => {
    const parsed = parseRecordVisitorParentRequest(
      goodRequest({ guardian: { firstName: 'Dana', lastName: 'Fields', phone: '+1 (555) 010-3344' } }),
    );
    expect(parsed.guardian.phone).toBe('5550103344');
  });

  it('refuses a student who is already held for review', async () => {
    // They arrived through the kiosk and already have a record with an adult on
    // it. A second one is two households waiting to happen.
    const db = dbWithVisitor({ pendingReview: true });
    await expect(run(db)).rejects.toBeInstanceOf(RegistrationInputError);
    expect(db.get(`${REGISTRATIONS_COLLECTION}/${REGISTRATION_ID}`)).toBeUndefined();
  });

  it('refuses a student who is no longer on the roster', async () => {
    const db = dbWithVisitor({ status: 'inactive' });
    await expect(run(db)).rejects.toBeInstanceOf(RegistrationInputError);
  });
});

describe('the record it writes', () => {
  it('holds the adult for the Review screen, and says where it came from', async () => {
    const db = dbWithVisitor();
    const result = await run(db);

    expect(result.status).toBe('recorded');
    expect(result.last4).toBe('3344');
    expect(recordFor(db)).toMatchObject({
      status: 'complete',
      source: 'counselor',
      eventId: 'friday-today',
      studentIds: ['student-1'],
      childCount: 1,
      last4: '3344',
      checkedIn: true,
      guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5550103344' },
      // The child as the *roster* has them, not as a client asserted them a
      // second time: a reviewer decides a household by this name.
      children: [{ firstName: 'Robin', lastName: 'Fields', grade: 9 }],
      allergies: [null],
      anchorStudentIds: [],
      lastError: null,
    });
  });

  it('leaves the student exactly as the quick-add left them', async () => {
    const db = dbWithVisitor();
    const before = { ...db.get('students/student-1')! };
    await run(db);

    // No hold, no push flag flipped, nothing about a parent on the document —
    // `noMirroredPersonalData` forbids the last one and this is the reason the
    // record above exists at all.
    expect(db.get('students/student-1')).toEqual(before);
  });

  it('records a name that is already on the roster as a suspicion', async () => {
    const db = dbWithVisitor();
    db.seed('students/older-row', {
      firstName: 'Robin',
      lastName: 'Fields',
      status: 'active',
    });
    await run(db);
    expect(recordFor(db).possibleDuplicateOf).toEqual({ '0': ['older-row'] });
  });

  it('says the child was not checked in when they were not', async () => {
    const db = dbWithVisitor();
    await run(db, { data: goodRequest({ eventId: 'some-other-night' }) });
    expect(recordFor(db).checkedIn).toBe(false);
  });

  it('makes the family findable at the kiosk by those four digits', async () => {
    const db = dbWithVisitor();
    await run(db);

    expect(db.get(PHONE_INDEX_DOC)).toMatchObject({ last4: { '3344': ['student-1'] } });
    expect(db.get(PENDING_LAST4_DOC)?.entries).toMatchObject({
      [REGISTRATION_ID]: { last4: '3344', studentIds: ['student-1'] },
    });
  });
});

describe('a retry', () => {
  it('answers the same press twice without a second record', async () => {
    const db = dbWithVisitor();
    await run(db);
    const first = { ...recordFor(db) };

    const again = await run(db);
    expect(again.status).toBe('already-recorded');
    expect(again.last4).toBe('3344');
    expect(recordFor(db)).toEqual(first);
    expect(
      [...db.data.keys()].filter((key) => key.startsWith(`${REGISTRATIONS_COLLECTION}/`)),
    ).toHaveLength(1);
  });
});
