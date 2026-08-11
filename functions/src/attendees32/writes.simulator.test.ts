/**
 * Writing Tally's changes into a realistic Attendees server.
 *
 * The properties that matter are the ones with a child's record on the other
 * end: a push links rather than duplicates when the office already typed the
 * visitor in; an edit read-modifies-writes the infos blob rather than
 * clobbering it; a contact lands only in an empty slot; and a family gets at
 * most one adult through this door.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  A32SimulatorStore,
  createSimulatorFetch,
  DEFAULT_TOKEN,
  seedDefaultOrganization,
  SIMULATOR_ORIGIN,
} from '../../../tools/a32-simulator/src/index.js';
import type { A32Config } from '../config.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { createTtlCache, type TtlCache } from '../pco/cache.js';
import { createA32Client, type A32Client } from './client.js';
import { a32Config } from '../testing/a32Config.js';
import {
  addParent,
  checkPerson,
  createFamily,
  findAdultCandidates,
  pushStudent,
  recreateStudent,
  setParentContact,
  updateStudentProfile,
} from './writes.js';

let store: A32SimulatorStore;
let client: A32Client;
let cache: TtlCache;
let config: A32Config;
let db: FakeFirestore;

function idOf(firstName: string): string {
  const found = [...store.attendees.values()].find((attendee) => attendee.firstName === firstName);
  if (!found) throw new Error(`No seeded attendee called ${firstName}`);
  return found.id;
}

beforeEach(() => {
  store = new A32SimulatorStore();
  seedDefaultOrganization(store);
  client = createA32Client({
    token: DEFAULT_TOKEN,
    baseUrl: SIMULATOR_ORIGIN,
    fetchImpl: createSimulatorFetch(store),
    sleep: async () => {},
  });
  cache = createTtlCache({ ttlMs: 30_000 });
  config = a32Config({ writeBack: 'full' });
  db = new FakeFirestore();
});

describe('pushStudent', () => {
  it('creates a person for a queued visitor, with a family folk and an enrollment', async () => {
    db.seed('students/visitor-1', {
      firstName: 'Keanu',
      lastName: 'Māhoe',
      grade: 8,
      status: 'active',
      upstreamPushPending: true,
    });

    const result = await pushStudent({ db, client, config, cache, studentId: 'visitor-1' });
    expect(result.status).toBe('created');
    const createdId = result.pcoPersonId!;

    const attendee = store.attendees.get(createdId)!;
    expect(attendee.firstName).toBe('Keanu');
    expect((attendee.infos.fixed as Record<string, unknown>).grade).toBe(8);
    // The side effects the create headers ask for: a family folk membership
    // and an enrollment in the configured meet.
    expect(store.folkAttendees.some((edge) => edge.attendeeId === createdId && edge.roleId === 27)).toBe(true);
    expect(store.attendingMeets.some((row) => store.attendings.find((a) => a.id === row.attendingId)?.attendeeId === createdId)).toBe(true);

    const doc = db.get('students/visitor-1')!;
    expect(doc.upstreamBackend).toBe('a32');
    expect(doc.upstreamPersonId).toBe(createdId);
    expect(doc.upstreamPushPending).toBe(false);
    // The legacy field means Planning Center and stays untouched.
    expect(doc.pcoPersonId).toBeUndefined();
  });

  /**
   * A nursery child, who has no grade to type at quick-add.
   *
   * This used to be refused outright, leaving them queued on
   * `upstreamPushPending` for ever — a queue that never drains rather than a
   * visible failure.
   */
  it('creates a grade-less child rather than matching a same-named person who has a grade', async () => {
    // The seeded Priya is in 9th, so she is not this child whatever the names
    // say — a grade-less student only ever matches a grade-less record.
    const before = store.attendees.size;
    db.seed('students/nursery-1', {
      firstName: 'Priya',
      lastName: 'Raghunathan',
      status: 'active',
      upstreamPushPending: true,
    });

    const result = await pushStudent({ db, client, config, cache, studentId: 'nursery-1' });

    expect(result.status).toBe('created');
    expect(result.pcoPersonId).not.toBe(idOf('Priya'));
    expect(store.attendees.size).toBe(before + 1);

    // Omitted, not zero: a grade nobody supplied is a claim about a real child.
    const created = store.attendees.get(result.pcoPersonId!)!;
    expect((created.infos.fixed as Record<string, unknown>).grade).toBeUndefined();
    expect(db.get('students/nursery-1')!.upstreamPushPending).toBe(false);
  });

  /**
   * Pre-K, on the backend that is not Planning Center.
   *
   * `-1` is a grade rather than a sentinel for "none", and the two guards that
   * decide whether a grade goes upstream are `!== null` on this side and a
   * range check on the other. Both used to be a truthiness test dressed up as a
   * bound, which dropped Pre-K exactly the way an older one dropped
   * kindergarten — so the number reaches Attendees, and does not become the
   * empty `fixed` blob a grade-less child gets.
   */
  it('sends a Pre-K grade to Attendees rather than treating it as no grade', async () => {
    db.seed('students/prek-1', {
      firstName: 'Shayla',
      lastName: 'Bo',
      grade: -1,
      status: 'active',
      upstreamPushPending: true,
    });

    const result = await pushStudent({ db, client, config, cache, studentId: 'prek-1' });

    expect(result.status).toBe('created');
    const created = store.attendees.get(result.pcoPersonId!)!;
    expect((created.infos.fixed as Record<string, unknown>).grade).toBe(-1);
  });

  /*
   * The grade-less duplicate check, which used to be skipped entirely.
   *
   * The reasoning for skipping it was that Planning Center has a `child` flag
   * to tell a nursery child from an equally grade-less adult volunteer and
   * Attendees has nothing of the kind. It does — as a relation rather than a
   * field — so the same guard Planning Center applies is available here, and a
   * grade-less visitor arriving a second time now lands on their own record.
   */
  it('matches a grade-less child onto the grade-less child already on file', async () => {
    const existing = store.seedStudent({
      firstName: 'Ayo',
      lastName: 'Balogun',
      grade: null,
      parents: [{ firstName: 'Folake' }],
    });
    const before = store.attendees.size;
    db.seed('students/nursery-2', {
      firstName: 'Ayo',
      lastName: 'Balogun',
      status: 'active',
      upstreamPushPending: true,
    });

    const result = await pushStudent({ db, client, config, cache, studentId: 'nursery-2' });

    expect(result.status).toBe('updated');
    expect(result.pcoPersonId).toBe(existing.id);
    expect(store.attendees.size).toBe(before);
  });

  it('never matches a grade-less child onto a same-named adult', async () => {
    // The volunteer and the three-year-old who share a name: the case the
    // skipped check was protecting, and the one the relation guard now covers
    // without giving up on the duplicate.
    store.seedStudent({
      firstName: 'Ayo',
      lastName: 'Balogun',
      grade: null,
      parents: [{ firstName: 'Ayo', lastName: 'Balogun' }],
    });
    const before = store.attendees.size;
    db.seed('students/nursery-3', {
      firstName: 'Ayo',
      lastName: 'Balogun',
      status: 'active',
      upstreamPushPending: true,
    });

    const result = await pushStudent({ db, client, config, cache, studentId: 'nursery-3' });

    // The child on file wins over the adult of the same name — and either way
    // the adult is never the answer.
    const landedOn = store.attendees.get(result.pcoPersonId!)!;
    expect(
      store.folkAttendees.some(
        (edge) => edge.attendeeId === landedOn.id && edge.roleId === 27 && !edge.isRemoved,
      ),
    ).toBe(true);
    expect(store.attendees.size).toBeLessThanOrEqual(before + 1);
  });

  it('links to the person the office already typed in rather than duplicating them', async () => {
    db.seed('students/visitor-2', {
      firstName: 'Priya',
      lastName: 'Raghunathan',
      grade: 9,
      status: 'active',
      upstreamPushPending: true,
    });

    const before = store.attendees.size;
    const result = await pushStudent({ db, client, config, cache, studentId: 'visitor-2' });

    expect(result.status).toBe('updated');
    expect(result.pcoPersonId).toBe(idOf('Priya'));
    expect(store.attendees.size).toBe(before);
    expect(db.get('students/visitor-2')!.upstreamPersonId).toBe(idOf('Priya'));
  });

  it('carries drifted managed fields onto a linked record under full write-back', async () => {
    const priya = idOf('Priya');
    db.seed(`students/a32_${priya}`, {
      firstName: 'Priya',
      lastName: 'Raghunathan-Iyer',
      grade: 10,
      status: 'active',
    });

    const result = await pushStudent({ db, client, config, cache, studentId: `a32_${priya}` });
    expect(result.status).toBe('updated');

    const attendee = store.attendees.get(priya)!;
    expect(attendee.lastName).toBe('Raghunathan-Iyer');
    expect((attendee.infos.fixed as Record<string, unknown>).grade).toBe(10);
    // The read-modify-write must not lose what else lived in infos.
    expect((attendee.infos.fixed as Record<string, unknown>).allergies).toBe('Tree nuts');
  });

  it('leaves the queue flag set when write-back is off', async () => {
    config = a32Config({ writeBack: 'off' });
    db.seed('students/visitor-3', {
      firstName: 'New',
      lastName: 'Visitor',
      grade: 7,
      status: 'active',
      upstreamPushPending: true,
    });

    const result = await pushStudent({ db, client, config, cache, studentId: 'visitor-3' });
    expect(result.status).toBe('skipped');
    expect(db.get('students/visitor-3')!.upstreamPushPending).toBe(true);
  });
});

describe('updateStudentProfile', () => {
  it('saves the changed fields and answers with the finished roster row', async () => {
    const wei = idOf('Wei');
    db.seed(`students/a32_${wei}`, { status: 'active' });

    const result = await updateStudentProfile({
      db,
      client,
      config,
      cache,
      studentId: `a32_${wei}`,
      grade: 12,
      allergies: 'Peanuts',
    });

    expect(result.status).toBe('updated');
    expect(result.wrote.sort()).toEqual(['allergies', 'grade']);
    expect(result.person).toMatchObject({ grade: 12, hasAllergies: true });

    const attendee = store.attendees.get(wei)!;
    const fixed = attendee.infos.fixed as Record<string, unknown>;
    expect(fixed.grade).toBe(12);
    expect(fixed.allergies).toBe('Peanuts');
  });

  it('writes a day-only birthday through the 1800 sentinel on a person with no year', async () => {
    const salote = idOf('Salote');
    db.seed(`students/a32_${salote}`, { status: 'active' });

    const result = await updateStudentProfile({
      db,
      client,
      config,
      cache,
      studentId: `a32_${salote}`,
      birthday: '07-19',
    });

    expect(result.status).toBe('updated');
    expect(store.attendees.get(salote)!.estimatedBirthday).toBe('1800-07-19');
    // And the row comes back reading the day.
    expect(result.person!.birthday).toBe('07-19');
  });

  it('keeps the year on file when only the day is corrected', async () => {
    const priya = idOf('Priya');
    db.seed(`students/a32_${priya}`, { status: 'active' });

    await updateStudentProfile({
      db,
      client,
      config,
      cache,
      studentId: `a32_${priya}`,
      birthday: '03-15',
    });
    expect(store.attendees.get(priya)!.actualBirthday).toBe('2011-03-15');
  });

  it('reports unchanged without writing when Attendees already matches', async () => {
    const priya = idOf('Priya');
    db.seed(`students/a32_${priya}`, { status: 'active' });

    const result = await updateStudentProfile({
      db,
      client,
      config,
      cache,
      studentId: `a32_${priya}`,
      grade: 9,
    });
    expect(result.status).toBe('unchanged');
    expect(result.person).not.toBeNull();
  });

  it('refuses when write-back is not full', async () => {
    config = a32Config({ writeBack: 'create' });
    const result = await updateStudentProfile({
      db,
      client,
      config,
      cache,
      studentId: `a32_${idOf('Priya')}`,
      grade: 8,
    });
    expect(result.status).toBe('disabled');
  });
});

describe('a merged attendee', () => {
  /**
   * The behaviour this backend declared it did not have.
   *
   * `capabilities.mergeAware` was false and honestly so: a merged-away person
   * read as a person who was gone, so a queued edit for them was reported as
   * `orphaned` and a leader was offered a re-create for somebody who already
   * existed under another id. attendees32 answers `410` with `merged_into`
   * now, which is the same question Planning Center's mirror answers.
   */
  it('follows the edit onto the survivor and says whose record it landed on', async () => {
    const wei = idOf('Wei');
    const salote = idOf('Salote');
    db.seed(`students/a32_${wei}`, { status: 'active' });
    // Read before the merge: asserting against a literal would pass by
    // accident whenever the fixture happened to hold the same grade.
    const tombstoneGradeBefore = (store.attendees.get(wei)!.infos.fixed as Record<string, unknown>)
      .grade;
    store.mergeAttendee(wei, salote);

    const result = await updateStudentProfile({
      db,
      client,
      config,
      cache,
      studentId: `a32_${wei}`,
      grade: 11,
    });

    expect(result.status).toBe('updated');
    // The id that came back is not the id the edit named, which is exactly
    // what the queue reads to report `merged` rather than `landed`.
    expect(result.person?.pcoPersonId).toBe(salote);
    expect((store.attendees.get(salote)!.infos.fixed as Record<string, unknown>).grade).toBe(11);
    // And nothing was written to the tombstone.
    expect((store.attendees.get(wei)!.infos.fixed as Record<string, unknown>).grade).toBe(
      tombstoneGradeBefore,
    );
  });

  it('follows a chain to its end', async () => {
    const wei = idOf('Wei');
    const salote = idOf('Salote');
    const third = store.createAttendee({ firstName: 'Mele', lastName: 'Tui' });
    db.seed(`students/a32_${wei}`, { status: 'active' });
    store.mergeAttendee(wei, salote);
    store.mergeAttendee(salote, third.id);

    const result = await updateStudentProfile({
      db,
      client,
      config,
      cache,
      studentId: `a32_${wei}`,
      grade: 9,
    });

    expect(result.person?.pcoPersonId).toBe(third.id);
  });

  it('is gone, not merged, when the trail ends nowhere', async () => {
    const wei = idOf('Wei');
    const salote = idOf('Salote');
    db.seed(`students/a32_${wei}`, { status: 'active' });
    store.mergeAttendee(wei, salote);
    // The survivor is deleted afterwards, which a tidy-up does.
    store.attendees.get(salote)!.isRemoved = true;

    const result = await updateStudentProfile({
      db,
      client,
      config,
      cache,
      studentId: `a32_${wei}`,
      grade: 9,
    });

    expect(result.status).toBe('no-student');
  });

  it('relinks rather than reporting a person missing', async () => {
    const wei = idOf('Wei');
    const salote = idOf('Salote');
    store.mergeAttendee(wei, salote);

    // Adding somebody by an id that has since been merged should land on the
    // person, not offer to create a second copy of the record a coworker has
    // just finished de-duplicating.
    expect(await checkPerson(client, wei)).toEqual({ outcome: 'relinked', personId: salote });
  });
});

describe('a nickname on Attendees', () => {
  /**
   * The field that used to report success and write nothing.
   *
   * The bracketed half of the composite is Attendees' CJK name, and
   * `mapping.ts` deliberately never writes those fields — Tally cannot tell
   * which half is the family name. The decision was right; the consequence
   * was that the field fell through, nothing was written, and the job landed
   * under a strip reading "Saved in Attendees".
   */
  it('is refused rather than silently dropped', async () => {
    const wei = idOf('Wei');
    db.seed(`students/a32_${wei}`, { status: 'active' });
    const before = store.attendees.get(wei)!.firstName2;

    const result = await updateStudentProfile({
      db,
      client,
      config,
      cache,
      studentId: `a32_${wei}`,
      nickname: 'Ah Wei',
    });

    expect(result.status).toBe('invalid');
    expect(result.wrote).toEqual([]);
    expect(result.message).toMatch(/Attendees/);
    expect(store.attendees.get(wei)!.firstName2).toBe(before);
  });
});

describe('setParentContact', () => {
  it('fills only the empty slot and never overwrites what is on file', async () => {
    const wei = idOf('Wei');
    db.seed(`students/a32_${wei}`, { status: 'active' });

    // Hana has a phone and no email.
    const result = await setParentContact({
      db,
      client,
      config,
      cache,
      studentId: `a32_${wei}`,
      phone: '555-9999',
      email: 'hana@example.org',
    });

    expect(result.status).toBe('updated');
    expect(result.wrote).toEqual(['email']);
    expect(result.skipped).toEqual(['phone']);

    const hana = [...store.attendees.values()].find((attendee) => attendee.firstName === 'Hana')!;
    const contacts = hana.infos.contacts as Record<string, string>;
    expect(contacts.phone1).toBe('555-0322');
    expect(contacts.email1).toBe('hana@example.org');
  });

  it('says when there is no adult to attach the contact to', async () => {
    const nkechi = idOf('Nkechi');
    db.seed(`students/a32_${nkechi}`, { status: 'active' });

    const result = await setParentContact({
      db,
      client,
      config,
      cache,
      studentId: `a32_${nkechi}`,
      phone: '555-1234',
    });
    expect(result.status).toBe('no-household-adult');
  });
});

describe('addParent', () => {
  it('refuses once an adult is already in the family', async () => {
    const priya = idOf('Priya');
    db.seed(`students/a32_${priya}`, { status: 'active' });

    const result = await addParent({
      db,
      client,
      config,
      cache,
      studentId: `a32_${priya}`,
      firstName: 'Second',
      lastName: 'Parent',
    });
    expect(result.status).toBe('already-has-adult');
  });

  it('offers existing adults by that name before creating anybody', async () => {
    const nkechi = idOf('Nkechi');
    db.seed(`students/a32_${nkechi}`, { status: 'active' });

    const result = await addParent({
      db,
      client,
      config,
      cache,
      studentId: `a32_${nkechi}`,
      firstName: 'Meena',
      lastName: 'Raghunathan',
    });
    expect(result.status).toBe('existing-people');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.reachable).toBe(true);
  });

  it('builds the family when told to create: folk, membership, contacts', async () => {
    const nkechi = idOf('Nkechi');
    db.seed(`students/a32_${nkechi}`, { status: 'active', lastName: 'Obasanjo' });

    const result = await addParent({
      db,
      client,
      config,
      cache,
      studentId: `a32_${nkechi}`,
      firstName: 'Chidi',
      lastName: 'Obasanjo',
      phone: '555-4321',
      createNew: true,
    });

    expect(result.status).toBe('added');
    expect(result.createdPerson).toBe(true);
    expect(result.createdHousehold).toBe(true);
    expect(result.wrote).toEqual(['phone']);

    const chidi = [...store.attendees.values()].find((attendee) => attendee.firstName === 'Chidi')!;
    // Both ends of the family: the student as child, the parent as parent.
    const folkIds = store.folkAttendees
      .filter((edge) => edge.attendeeId === chidi.id && edge.roleId === 30)
      .map((edge) => edge.folkId);
    expect(folkIds).toHaveLength(1);
    expect(
      store.folkAttendees.some(
        (edge) => edge.folkId === folkIds[0] && edge.attendeeId === nkechi && edge.roleId === 27,
      ),
    ).toBe(true);
  });
});

describe('recreateStudent + checkPerson', () => {
  it('confirms a live person instead of re-creating them', async () => {
    const priya = idOf('Priya');
    db.seed(`students/a32_${priya}`, { status: 'active', upstreamRecordMissing: true });

    const result = await recreateStudent({ db, client, config, cache, studentId: `a32_${priya}` });
    expect(result.status).toBe('still-there');
    expect(db.get(`students/a32_${priya}`)!.upstreamRecordMissing).toBe(false);
  });

  it('re-creates a gone person and moves the membership to the new document', async () => {
    const dmitri = idOf('Dmitri');
    store.attendees.get(dmitri)!.isRemoved = true;
    db.seed(`students/a32_${dmitri}`, {
      status: 'active',
      upstreamRecordMissing: true,
      firstName: 'Dmitri',
      lastName: 'Volkov',
      grade: 12,
    });

    const result = await recreateStudent({
      db,
      client,
      config,
      cache,
      studentId: `a32_${dmitri}`,
      firstName: 'Dmitri',
      lastName: 'Volkov',
      grade: 12,
    });

    expect(result.status).toBe('recreated');
    const newId = result.pcoPersonId!;
    expect(newId).not.toBe(dmitri);
    expect(result.studentId).toBe(`a32_${newId}`);

    expect(db.get(`students/a32_${newId}`)).toMatchObject({
      upstreamBackend: 'a32',
      upstreamPersonId: newId,
      status: 'active',
      upstreamRecordMissing: false,
    });
    expect(db.get(`students/a32_${dmitri}`)).toMatchObject({
      status: 'inactive',
      mergedIntoStudentId: `a32_${newId}`,
    });
  });

  it('checkPerson answers gone with no forwarding address', async () => {
    const gone = idOf('Aroha');
    store.attendees.get(gone)!.isRemoved = true;
    expect(await checkPerson(client, gone)).toEqual({ outcome: 'gone' });
    expect(await checkPerson(client, idOf('Priya'))).toEqual({
      outcome: 'exists',
      personId: idOf('Priya'),
    });
  });
});

/* -------------------------------------------------------------------------- */
/* createFamily — the same judgement as Planning Center, over folks            */
/* -------------------------------------------------------------------------- */

describe('createFamily', () => {
  /** A child Tally pushed a moment ago: linked, in the folk the push minted. */
  const pushed = async (studentId: string, firstName: string, lastName: string) => {
    db.seed(`students/${studentId}`, {
      firstName,
      lastName,
      grade: 8,
      status: 'active',
      upstreamPushPending: true,
    });
    const result = await pushStudent({ db, client, config, cache, studentId });
    return result.pcoPersonId!;
  };

  const build = (patch: {
    studentIds: string[];
    parentPersonId?: string;
    createNewParent?: boolean;
    phone?: string;
  }) =>
    createFamily({
      db,
      client,
      config,
      cache,
      firstName: 'Test',
      lastName: 'Person',
      ...patch,
    });

  /*
   * The Attendees half of the bug a real Planning Center showed: one family
   * registering twice on one night, approved a card at a time, ending with one
   * adult at the head of two families.
   */
  it('puts a second registration in the family the first one built', async () => {
    const first = await pushed('t-1', 'Testtwo', 'Person');
    const one = await build({ studentIds: ['t-1'], phone: '(123) 123-1234' });
    expect(one.status).toBe('created');

    const second = await pushed('t-2', 'Testthree', 'Person');
    const before = store.folks.size;

    const two = await build({ studentIds: ['t-2'], phone: '123-123-1234' });

    expect(two.status).toBe('joined');
    expect(two.parentPersonId).toBe(one.parentPersonId);
    expect(two.createdHousehold).toBe(false);
    // No new folk, and the parent holds exactly one family membership.
    expect(store.folks.size).toBe(before);
    const parentFamilies = store
      .familyFolksOf(one.parentPersonId!)
      .filter((folk) => folk.category === 0);
    expect(parentFamilies).toHaveLength(1);
    expect(store.familyFolksOf(second).map((folk) => folk.id)).toContain(parentFamilies[0]!.id);
    expect(store.familyFolksOf(first).map((folk) => folk.id)).toContain(parentFamilies[0]!.id);
  });

  it('never corroborates a child as the parent, even one of another family', async () => {
    /*
     * The screenshot's confusion, in the backend with no `child` flag: a child
     * already on file who shares the guardian's whole name *and* has a phone
     * number of their own. Planning Center filters these out with
     * `where[child]=false`; here the family relation has to say it.
     */
    store.seedStudent({
      firstName: 'Test',
      lastName: 'Person',
      grade: 10,
      contacts: { phone1: '(123) 123-1234' },
      parents: [{ firstName: 'Someone' }],
    });
    await pushed('t-9', 'Testfour', 'Person');

    const result = await build({ studentIds: ['t-9'], phone: '(123) 123-1234' });

    expect(result.status).toBe('created');
    expect(result.createdPerson).toBe(true);
  });

  it('corroborates on a number in any slot, not only the first', async () => {
    const parent = store.createAttendee({
      firstName: 'Test',
      lastName: 'Person',
      infos: { contacts: { phone1: '(555) 999-0000', phone2: '(123) 123-1234' } },
    });
    await pushed('t-10', 'Testfive', 'Person');

    const result = await build({ studentIds: ['t-10'], phone: '(123) 123-1234' });

    expect(result.status).toBe('joined');
    expect(result.parentPersonId).toBe(parent.id);
  });

  it('uses the adult a reviewer named, and reports one Attendees no longer has', async () => {
    const chosen = store.createAttendee({ firstName: 'Test', lastName: 'Person' });
    await pushed('t-11', 'Testsix', 'Person');

    const named = await build({ studentIds: ['t-11'], parentPersonId: chosen.id });
    expect(named.status).toBe('joined');
    expect(named.parentPersonId).toBe(chosen.id);

    await pushed('t-12', 'Testseven', 'Person');
    const missing = await build({ studentIds: ['t-12'], parentPersonId: 'no-such-attendee' });
    expect(missing.status).toBe('parent-not-found');
  });

  it('creates a fresh adult when a reviewer overrules the corroboration', async () => {
    const twin = store.createAttendee({
      firstName: 'Test',
      lastName: 'Person',
      infos: { contacts: { phone1: '(123) 123-1234' } },
    });
    await pushed('t-13', 'Testeight', 'Person');

    const result = await build({
      studentIds: ['t-13'],
      createNewParent: true,
      phone: '(123) 123-1234',
    });

    expect(result.status).toBe('created');
    expect(result.parentPersonId).not.toBe(twin.id);
  });
});

describe('findAdultCandidates', () => {
  it('offers adults with the phone evidence attached, and no children', async () => {
    const child = store.seedStudent({
      firstName: 'Test',
      lastName: 'Person',
      grade: 9,
      parents: [{ firstName: 'Other' }],
    });
    const matching = store.createAttendee({
      firstName: 'Test',
      lastName: 'Person',
      infos: { contacts: { phone1: '(123) 123-1234' } },
    });
    const namesake = store.createAttendee({ firstName: 'Test', lastName: 'Person' });

    const candidates = await findAdultCandidates({
      db,
      client,
      config,
      cache,
      firstName: 'Test',
      lastName: 'Person',
      phone: '(123) 123-1234',
    });

    const ids = candidates.map((candidate) => candidate.personId);
    expect(ids).toContain(matching.id);
    expect(ids).toContain(namesake.id);
    expect(ids).not.toContain(child.id);
    expect(candidates.find((c) => c.personId === matching.id)?.corroborated).toBe(true);
    expect(candidates.find((c) => c.personId === namesake.id)?.corroborated).toBe(false);
  });

  it('leaves out the family’s own children', async () => {
    const parent = store.createAttendee({ firstName: 'Test', lastName: 'Person' });
    const candidates = await findAdultCandidates({
      db,
      client,
      config,
      cache,
      firstName: 'Test',
      lastName: 'Person',
      excludePersonIds: [parent.id],
    });
    expect(candidates).toEqual([]);
  });
});
