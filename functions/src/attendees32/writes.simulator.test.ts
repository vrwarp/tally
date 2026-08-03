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
      pcoPushPending: true,
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
    expect(doc.pcoPushPending).toBe(false);
    // The legacy field means Planning Center and stays untouched.
    expect(doc.pcoPersonId).toBeUndefined();
  });

  it('links to the person the office already typed in rather than duplicating them', async () => {
    db.seed('students/visitor-2', {
      firstName: 'Priya',
      lastName: 'Raghunathan',
      grade: 9,
      status: 'active',
      pcoPushPending: true,
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
      pcoPushPending: true,
    });

    const result = await pushStudent({ db, client, config, cache, studentId: 'visitor-3' });
    expect(result.status).toBe('skipped');
    expect(db.get('students/visitor-3')!.pcoPushPending).toBe(true);
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
    db.seed(`students/a32_${priya}`, { status: 'active', pcoRecordMissing: true });

    const result = await recreateStudent({ db, client, config, cache, studentId: `a32_${priya}` });
    expect(result.status).toBe('still-there');
    expect(db.get(`students/a32_${priya}`)!.pcoRecordMissing).toBe(false);
  });

  it('re-creates a gone person and moves the membership to the new document', async () => {
    const dmitri = idOf('Dmitri');
    store.attendees.get(dmitri)!.isRemoved = true;
    db.seed(`students/a32_${dmitri}`, {
      status: 'active',
      pcoRecordMissing: true,
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
      pcoRecordMissing: false,
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
