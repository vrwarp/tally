/**
 * Correcting a family before they become permanent.
 *
 * Four claims, and only the first is about the field being corrected:
 *
 *   - **A rename re-asks the roster.** `possibleDuplicateOf` is the answer to a
 *     question about the name as typed. Fixing a misspelling can *reveal* the
 *     collision the door missed — that is the commonest reason for a
 *     misspelling to matter at all — and a correction that left the old hints
 *     standing would release the approve button on a duplicate it had just
 *     manufactured.
 *   - **A corrected number moves the family in the kiosk's index, both ways.**
 *     Into the digits they will type next week and *out of* the digits they
 *     mistyped, which now belong to a stranger who could otherwise be handed
 *     somebody else's children by name.
 *   - **Only what is still held may be corrected.** A pushed child and a merged
 *     child are refused, with the reason, rather than silently edited into a
 *     copy nobody reads.
 *   - **The record keeps what the family typed** — the names, never the number.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { amendRegistration } from './amend.js';
import { PENDING_LAST4_DOC, PHONE_INDEX_DOC } from './phoneIndex.js';
import { REGISTRATIONS_COLLECTION, RegistrationInputError } from './registration.js';
import { listPendingRegistrations } from './review.js';

const NOW = new Date('2026-08-11T10:00:00Z');
const REGISTERED_AT = new Date('2026-08-09T19:05:00Z');
const ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const UID = 'reviewer-1';

/** A held family, exactly as `registerFamily` leaves one. */
function dbWithRegistration(overrides: Record<string, unknown> = {}): FakeFirestore {
  const db = new FakeFirestore();
  db.seed('students/held-1', {
    firstName: 'Micheal',
    lastName: 'Okonkwo',
    grade: 4,
    searchName: 'micheal okonkwo',
    status: 'active',
    isVisitor: true,
    pendingReview: true,
    upstreamPushPending: true,
    registrationId: ID,
  });
  db.seed('students/held-2', {
    firstName: 'Ada',
    lastName: 'Okonkwo',
    grade: 7,
    searchName: 'ada okonkwo',
    status: 'active',
    isVisitor: true,
    pendingReview: true,
    upstreamPushPending: true,
    registrationId: ID,
  });
  db.seed(`${REGISTRATIONS_COLLECTION}/${ID}`, {
    status: 'complete',
    source: 'kiosk',
    eventId: 'friday-today',
    studentIds: ['held-1', 'held-2'],
    childCount: 2,
    last4: '3344',
    checkedIn: true,
    createdAt: REGISTERED_AT,
    guardian: { firstName: 'Chidi', lastName: 'Okonkwo', phone: '5550103344' },
    children: [
      { firstName: 'Micheal', lastName: 'Okonkwo', grade: 4 },
      { firstName: 'Ada', lastName: 'Okonkwo', grade: 7 },
    ],
    allergies: [null, null],
    possibleDuplicateOf: {},
    anchorStudentIds: [],
    lastError: null,
    ...overrides,
  });
  return db;
}

/** Somebody the church already has, spelled the way the parent meant to. */
function seedRosterMichael(db: FakeFirestore): void {
  db.seed('students/pco_9', {
    firstName: 'Michael',
    lastName: 'Okonkwo',
    grade: 4,
    status: 'active',
  });
}

function record(db: FakeFirestore): Record<string, unknown> {
  return db.get(`${REGISTRATIONS_COLLECTION}/${ID}`)!;
}

/* -------------------------------------------------------------------------- */

describe('correcting a child', () => {
  it('renames the roster row and the record together', async () => {
    const db = dbWithRegistration();

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: {
        index: 0,
        firstName: 'Michael',
        lastName: 'Okonkwo',
        grade: 4,
        allergies: null,
      },
    });

    expect(result.status).toBe('amended');
    const student = db.get('students/held-1')!;
    expect(student.firstName).toBe('Michael');
    // The kiosk searches on this. A name corrected on Tuesday that stopped
    // being findable on Friday would be a worse bug than the typo.
    expect(student.searchName).toBe('michael okonkwo');
    expect(record(db).children).toEqual([
      { firstName: 'Michael', lastName: 'Okonkwo', grade: 4 },
      { firstName: 'Ada', lastName: 'Okonkwo', grade: 7 },
    ]);
  });

  it('asks the roster again, and says so when the fix reveals a duplicate', async () => {
    const db = dbWithRegistration();
    seedRosterMichael(db);

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Michael', lastName: 'Okonkwo', grade: 4, allergies: null },
    });

    // The whole reason this is a callable rather than a field write: the
    // collision did not exist under the misspelling, and the approve button is
    // held on it from here.
    expect(record(db).possibleDuplicateOf).toEqual({ '0': ['pco_9'], '1': [] });
    expect(result.possibleDuplicates).toBe(1);
    expect(result.message).toContain('Settle their row before approving');

    const [row] = await listPendingRegistrations(db, NOW);
    expect(row!.children[0]!.possibleDuplicates.map((hit) => hit.studentId)).toEqual(['pco_9']);
  });

  it('clears a hint the correction made wrong', async () => {
    // The mirror image: the door flagged a collision that only existed because
    // of the typo, and the fix has to be able to *remove* a warning as well as
    // raise one.
    const db = dbWithRegistration({ possibleDuplicateOf: { '0': ['pco_9'] } });
    db.seed('students/pco_9', {
      firstName: 'Micheal',
      lastName: 'Okonkwo',
      grade: 4,
      status: 'active',
    });

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Michael', lastName: 'Okonkwo', grade: 4, allergies: null },
    });

    // Written as an explicit empty list, not omitted: a merged write cannot
    // remove a key, so an omission would have left the disproved warning up.
    expect(record(db).possibleDuplicateOf).toEqual({ '0': [], '1': [] });
    expect(result.possibleDuplicates).toBe(0);
  });

  it('keeps what the family typed, once and only once', async () => {
    const db = dbWithRegistration();

    await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Michael', lastName: 'Okonkwo', grade: 4, allergies: null },
    });
    await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Mikael', lastName: 'Okonkwo', grade: 4, allergies: null },
    });

    // The *family's* typing, not the previous reviewer's. A second correction
    // must not overwrite the provenance the first one recorded.
    expect(record(db).typedChildren).toEqual([
      { firstName: 'Micheal', lastName: 'Okonkwo', grade: 4 },
      { firstName: 'Ada', lastName: 'Okonkwo', grade: 7 },
    ]);

    const [row] = await listPendingRegistrations(db, NOW);
    expect(row!.children[0]!.typedAs).toEqual({
      firstName: 'Micheal',
      lastName: 'Okonkwo',
      grade: 4,
    });
    // And nothing on the sibling nobody touched: a caption reading "typed as
    // Ada Okonkwo" under the name Ada Okonkwo is noise on a screen whose job is
    // to make one difference visible.
    expect(row!.children[1]!.typedAs).toBeNull();
  });

  it('removes a grade rather than storing a null for it', async () => {
    const db = dbWithRegistration();

    await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Micheal', lastName: 'Okonkwo', grade: null, allergies: null },
    });

    // `firestore.rules` asserts `!('grade' in d.keys()) || d.grade is int`, so
    // a stored null would be a document no client could ever have written.
    const student = db.get('students/held-1')!;
    expect('grade' in student).toBe(false);
    // And the rest of the row survives the whole-document rewrite that takes.
    expect(student.registrationId).toBe(ID);
    expect(student.pendingReview).toBe(true);
    expect(student.searchName).toBe('micheal okonkwo');
  });

  it('records an allergy note, and clears one back to nothing', async () => {
    const db = dbWithRegistration();

    await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: {
        index: 0,
        firstName: 'Micheal',
        lastName: 'Okonkwo',
        grade: 4,
        allergies: '  Peanuts — carries an EpiPen  ',
      },
    });
    expect(record(db).allergies).toEqual(['Peanuts — carries an EpiPen', null]);

    await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Micheal', lastName: 'Okonkwo', grade: 4, allergies: '   ' },
    });
    // Whitespace is nothing recorded, not an empty string somebody typed.
    expect(record(db).allergies).toEqual([null, null]);
  });

  it('refuses a name the door would have refused, in the door’s own words', async () => {
    const db = dbWithRegistration();

    await expect(
      amendRegistration({
        db,
        registrationId: ID,
        uid: UID,
        now: NOW,
        child: { index: 0, firstName: 'Room 3', lastName: 'Okonkwo', grade: 4, allergies: null },
      }),
    ).rejects.toBeInstanceOf(RegistrationInputError);

    expect(db.get('students/held-1')!.firstName).toBe('Micheal');
  });

  it('refuses to make one registration hold the same child twice', async () => {
    const db = dbWithRegistration();

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Ada', lastName: 'Okonkwo', grade: 4, allergies: null },
    });

    expect(result.status).toBe('refused');
    expect(result.message).toContain('already on this registration');
    expect(db.get('students/held-1')!.firstName).toBe('Micheal');
  });

  it('refuses a child who has already been pushed', async () => {
    const db = dbWithRegistration();
    db.seed('students/held-1', { ...db.get('students/held-1')!, pendingReview: false });

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Michael', lastName: 'Okonkwo', grade: 4, allergies: null },
    });

    // Tally could rename its own copy, and that is exactly the problem: the
    // church's database would keep the old spelling with nothing to say which
    // of the two is right.
    expect(result.status).toBe('refused');
    expect(result.message).toContain('student page');
    expect(db.get('students/held-1')!.firstName).toBe('Micheal');
  });

  it('refuses a child who has been merged into another row', async () => {
    const db = dbWithRegistration();
    db.seed('students/held-1', { ...db.get('students/held-1')!, mergedIntoStudentId: 'pco_9' });

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Michael', lastName: 'Okonkwo', grade: 4, allergies: null },
    });

    // Approval pushes the row that survived, so editing the one that lost
    // changes nothing anybody will ever read.
    expect(result.status).toBe('refused');
    expect(result.message).toContain('Undo the merge first');
  });

  it('says nothing changed rather than writing for the sake of it', async () => {
    const db = dbWithRegistration();
    const before = db.writes.length;

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Micheal', lastName: 'Okonkwo', grade: 4, allergies: null },
    });

    expect(result.status).toBe('unchanged');
    expect(db.writes.length).toBe(before);
  });
});

describe('correcting the adult', () => {
  it('moves the family into the digits they will type, and out of the ones they will not', async () => {
    const db = dbWithRegistration();
    db.seed(PHONE_INDEX_DOC, { last4: { '3344': ['held-1', 'held-2', 'someone-else'] } });

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      guardian: { firstName: 'Chidi', lastName: 'Okonkwo', phone: '(555) 010-3355' },
    });

    expect(result.last4Changed).toBe(true);
    const index = db.get(PHONE_INDEX_DOC)!.last4 as Record<string, string[]>;
    expect(index['3355']).toEqual(['held-1', 'held-2']);
    /*
     * The half that is easy to forget and expensive to skip: leaving the
     * children under 3344 means a stranger whose own number ends 3344 types it
     * at the lobby and is handed somebody else's children by name.
     */
    expect(index['3344']).toEqual(['someone-else']);
    expect(record(db).last4).toBe('3355');

    // And the overlay follows, or the nightly rebuild folds the mistyped
    // digits straight back in a week later.
    const entries = db.get(PENDING_LAST4_DOC)!.entries as Record<string, { last4: string }>;
    expect(entries[ID]!.last4).toBe('3355');
  });

  it('leaves the index alone when only the spelling changed', async () => {
    const db = dbWithRegistration();
    db.seed(PHONE_INDEX_DOC, { last4: { '3344': ['held-1', 'held-2'] } });

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      guardian: { firstName: 'Chidi', lastName: 'Okonkwo-Bello', phone: '5550103344' },
    });

    expect(result.last4Changed).toBe(false);
    expect((db.get(PHONE_INDEX_DOC)!.last4 as Record<string, string[]>)['3344']).toEqual([
      'held-1',
      'held-2',
    ]);
    expect(record(db).guardian).toEqual({
      firstName: 'Chidi',
      lastName: 'Okonkwo-Bello',
      phone: '5550103344',
    });
  });

  it('keeps the name the family typed and never the number', async () => {
    const db = dbWithRegistration();

    await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      guardian: { firstName: 'Chidinma', lastName: 'Okonkwo', phone: '5550103355' },
    });

    const held = record(db);
    expect(held.typedGuardianName).toEqual({ firstName: 'Chidi', lastName: 'Okonkwo' });
    expect(held.phoneCorrected).toBe(true);
    // A mistyped number belongs to a stranger. That it was corrected is all a
    // second reviewer needs; the digits themselves are not kept anywhere.
    expect(JSON.stringify(held)).not.toContain('3344');

    const [row] = await listPendingRegistrations(db, NOW);
    expect(row!.typedGuardianName).toEqual({ firstName: 'Chidi', lastName: 'Okonkwo' });
    expect(row!.phoneCorrected).toBe(true);
  });

  it('refuses a registration that never had an adult', async () => {
    const db = dbWithRegistration({ guardian: null, anchorStudentIds: ['pco_9'] });

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      guardian: { firstName: 'Chidi', lastName: 'Okonkwo', phone: '5550103344' },
    });

    // The sibling journey. Inventing an adult here would attach a brand new
    // person to a household that already has one upstream.
    expect(result.status).toBe('refused');
    expect(result.message).toContain('no adult on it');
  });

  it('still corrects the adult on a card whose children are not held', async () => {
    /*
     * Two real cards look like this and both want the correction. A counselor's
     * parent contact is a record whose child was never held — quick-added at a
     * door and queued in the ordinary way — and whose adult is the entire point
     * of it. A kiosk family whose children landed but whose guardian was
     * refused is kept precisely so somebody can try the adult again, and a
     * mistyped number is the likeliest reason that refusal happened.
     */
    const db = dbWithRegistration({ source: 'counselor' });
    for (const id of ['held-1', 'held-2']) {
      db.seed(`students/${id}`, { ...db.get(`students/${id}`)!, pendingReview: false });
    }

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      guardian: { firstName: 'Chidi', lastName: 'Okonkwo', phone: '5550103355' },
    });

    expect(result.status).toBe('amended');
    expect((record(db).guardian as { phone: string }).phone).toBe('5550103355');
  });

  it('refuses once the adult itself has landed upstream', async () => {
    /*
     * The one state where this record outlives its own adult: approval wrote
     * the guardian and then failed on a child, so what is being kept is a retry
     * for the children. Correcting the name here would change a copy that is
     * about to be deleted and nothing the church can see.
     */
    const db = dbWithRegistration({
      lastError: 'Planning Center is unavailable.',
      lastErrorKind: 'children',
    });

    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      guardian: { firstName: 'Chidinma', lastName: 'Okonkwo', phone: '5550103344' },
    });

    expect(result.status).toBe('refused');
    expect(result.message).toContain('already been added to the church’s database');
    expect((record(db).guardian as { firstName: string }).firstName).toBe('Chidi');
  });
});

describe('the shape of a correction', () => {
  it('takes one person at a time', async () => {
    const db = dbWithRegistration();
    const both = {
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Michael', lastName: 'Okonkwo', grade: 4, allergies: null },
      guardian: { firstName: 'Chidi', lastName: 'Okonkwo', phone: '5550103344' },
    };
    await expect(amendRegistration(both)).rejects.toBeInstanceOf(RegistrationInputError);
    await expect(
      amendRegistration({ db, registrationId: ID, uid: UID, now: NOW }),
    ).rejects.toBeInstanceOf(RegistrationInputError);
  });

  it('answers a registration somebody else already dealt with', async () => {
    const db = new FakeFirestore();
    const result = await amendRegistration({
      db,
      registrationId: ID,
      uid: UID,
      now: NOW,
      child: { index: 0, firstName: 'Michael', lastName: 'Okonkwo', grade: 4, allergies: null },
    });
    expect(result.status).toBe('not-found');
  });
});
