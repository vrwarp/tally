/**
 * What Tally does when Planning Center merges or deletes somebody it holds.
 *
 * The scenarios are lifted from a production webhook log of one evening's
 * clean-up: an admin merged twelve duplicate records — five into one keeper,
 * seven into another — and then deleted both keepers too. Through the mirror
 * Tally reads, a merged id answers `410` with `meta.merged_into` naming the
 * survivor; a deleted one answers `410` with no forwarding address; an id the
 * mirror never held is a plain `404`. Every path that reads a person by id
 * has to survive all three, and the merge case has to *follow the trail* —
 * the student did not leave the ministry because an admin tidied a duplicate.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  SIMULATOR_ORIGIN,
  SimulatorStore,
  createSimulatorFetch,
} from '../../../tools/pco-simulator/src/index.js';
import type { PcoConfig, PcoWriteBackMode } from '../config.js';
import { createPcoClient, type PcoClient } from './client.js';
import { createTtlCache } from './cache.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { followPersonLink, isPersonGoneError, mergedForwardOf } from './personLink.js';
import { graftMergedStudent, readThroughMerges } from './studentPerson.js';
import { updateStudentProfile } from './profile.js';
import { pushStudent } from './pushStudents.js';
import { setParentContact } from './parentContact.js';
import { fetchPersonDetails, fetchRoster, pcoStudentId } from './roster.js';
import { PcoApiError } from './client.js';

function config(writeBack: PcoWriteBackMode = 'full'): PcoConfig {
  return {
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    baseUrlOverridden: true,
    minGrade: 6,
    maxGrade: 12,
    writeBack,
    cacheTtlSeconds: 30,
    managedInApp: false,
    configError: null,
  };
}

interface Harness {
  db: FakeFirestore;
  store: SimulatorStore;
  client: PcoClient;
}

function harness(): Harness {
  const store = new SimulatorStore({ pageSize: 50 });
  const client = createPcoClient({
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    fetchImpl: createSimulatorFetch(store),
    sleep: async () => {},
  });
  return { db: new FakeFirestore(), store, client };
}

/** A duplicate student and the record the admin keeps, both real children. */
function seedDuplicatePair(h: Harness): { dupId: string; keptId: string } {
  const dup = h.store.createPerson({
    first_name: 'Rowan', last_name: 'Vasquez-Old', child: true, grade: 8,
  });
  const kept = h.store.createPerson({
    first_name: 'Rowan', last_name: 'Vasquez', child: true, grade: 8,
  });
  return { dupId: dup.id, keptId: kept.id };
}

describe('the primitives', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('reads the forwarding address off the mirror-shaped 410', async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.store.buryPerson(dupId, keptId);

    const error = await h.client.get(`/people/${dupId}`).catch((e: unknown) => e);
    expect(isPersonGoneError(error)).toBe(true);
    expect(mergedForwardOf(error)).toBe(keptId);
  });

  it('follows a chain of merges to the person the church kept', async () => {
    // A→B→C: two tidy-ups in a row, which the log's keeper-of-seven made real.
    const { dupId, keptId } = seedDuplicatePair(h);
    const middle = h.store.createPerson({ first_name: 'Mid', last_name: 'Step', child: true });
    h.store.buryPerson(dupId, middle.id);
    h.store.buryPerson(middle.id, keptId);

    const error = await h.client.get(`/people/${dupId}`).catch((e: unknown) => e);
    const link = await followPersonLink(h.client, dupId, error);
    expect(link).toMatchObject({ outcome: 'live', personId: keptId });
  });

  it('reports a chain that ends in a deleted keeper as gone', async () => {
    // The log's exact shape: seven people merged into a keeper, keeper deleted.
    const { dupId, keptId } = seedDuplicatePair(h);
    h.store.buryPerson(dupId, keptId);
    h.store.buryPerson(keptId, null);

    const error = await h.client.get(`/people/${dupId}`).catch((e: unknown) => e);
    const link = await followPersonLink(h.client, dupId, error);
    expect(link).toEqual({ outcome: 'gone' });
  });

  it('refuses to chase a cycle in corrupt data', async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.store.buryPerson(dupId, keptId);
    h.store.buryPerson(keptId, dupId);

    const error = await h.client.get(`/people/${dupId}`).catch((e: unknown) => e);
    const link = await followPersonLink(h.client, dupId, error);
    expect(link).toEqual({ outcome: 'gone' });
  });

  it('a raw Planning Center 404 is gone, with nothing to follow', async () => {
    const error = await h.client.get('/people/999999').catch((e: unknown) => e);
    expect(isPersonGoneError(error)).toBe(true);
    expect(mergedForwardOf(error)).toBeNull();
    const link = await followPersonLink(h.client, '999999', error);
    expect(link).toEqual({ outcome: 'gone' });
  });
});

describe('grafting the membership onto the surviving record', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('moves a linked student to a pco_<keeper> document and deactivates the old one', async () => {
    h.db.seed('students/pco_101', { status: 'active', notes: 'peanut-free table',
                                    addedToRosterAt: 'earlier' });

    const { studentId } = await graftMergedStudent(h.db, 'pco_101', '202');

    expect(studentId).toBe('pco_202');
    const keeper = (await h.db.doc('students/pco_202').get()).data();
    expect(keeper).toMatchObject({
      pcoPersonId: '202', status: 'active',
      mergedFromStudentId: 'pco_101', addedToRosterAt: 'earlier',
    });
    const old = (await h.db.doc('students/pco_101').get()).data();
    expect(old).toMatchObject({ status: 'inactive', mergedIntoStudentId: 'pco_202' });
    // the note stays where the attendance history is; nothing personal moved
    expect(old?.notes).toBe('peanut-free table');
  });

  it('repoints a visitor document in place, keeping its id', async () => {
    h.db.seed('students/tally-abc', { status: 'active', pcoPersonId: '101' });

    const { studentId } = await graftMergedStudent(h.db, 'tally-abc', '202');

    expect(studentId).toBe('tally-abc');
    const doc = (await h.db.doc('students/tally-abc').get()).data();
    expect(doc).toMatchObject({ pcoPersonId: '202', status: 'active' });
  });

  it('reactivates a keeper document Tally already had, without doubling', async () => {
    h.db.seed('students/pco_101', { status: 'active' });
    h.db.seed('students/pco_202', { status: 'inactive', notes: 'kept' });

    await graftMergedStudent(h.db, 'pco_101', '202');

    const keeper = (await h.db.doc('students/pco_202').get()).data();
    expect(keeper).toMatchObject({ status: 'active', notes: 'kept' });
  });
});

describe('editing a profile after the person was merged', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('follows the merge, saves onto the keeper, and repoints the roster', async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.db.seed(`students/pco_${dupId}`, { status: 'active' });
    h.store.buryPerson(dupId, keptId);

    const result = await updateStudentProfile({
      db: h.db, client: h.client, config: config(),
      studentId: `pco_${dupId}`, firstName: 'Ro',
    });

    expect(result.status).toBe('updated');
    expect(h.store.personById(keptId)?.first_name).toBe('Ro');
    const keeperDoc = (await h.db.doc(`students/pco_${keptId}`).get()).data();
    expect(keeperDoc).toMatchObject({ status: 'active', pcoPersonId: keptId });
    const oldDoc = (await h.db.doc(`students/pco_${dupId}`).get()).data();
    expect(oldDoc).toMatchObject({ status: 'inactive' });
  });

  it('says the student is gone when the whole trail is dead', async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.db.seed(`students/pco_${dupId}`, { status: 'active' });
    h.store.buryPerson(dupId, keptId);
    h.store.buryPerson(keptId, null);

    const result = await updateStudentProfile({
      db: h.db, client: h.client, config: config(),
      studentId: `pco_${dupId}`, firstName: 'Ro',
    });

    expect(result.status).toBe('no-student');
    expect(result.message).toMatch(/deleted or merged/);
  });
});

describe('the roster after an evening of admin tidy-up', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('shows the student under the surviving record and reports the relink', async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.store.buryPerson(dupId, keptId);

    const result = await fetchRoster({
      client: h.client, config: config(), cache: createTtlCache({ ttlMs: 30_000 }),
      personIds: [dupId],
    });

    expect(result.unresolved).toEqual([]);
    expect(result.relinks).toEqual([{ fromPersonId: dupId, toPersonId: keptId }]);
    expect(result.people.map((p) => p.pcoPersonId)).toEqual([keptId]);
    expect(result.people[0]!.id).toBe(pcoStudentId(keptId));
  });

  it('still reports a dead-ended student as unresolved, not silently fewer', async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.store.buryPerson(dupId, keptId);
    h.store.buryPerson(keptId, null);

    const result = await fetchRoster({
      client: h.client, config: config(), cache: createTtlCache({ ttlMs: 30_000 }),
      personIds: [dupId],
    });

    expect(result.people).toEqual([]);
    expect(result.relinks).toEqual([]);
    expect(result.unresolved).toEqual([dupId]);
  });
});

describe('reading details for a merged student', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it("answers with the survivor's details rather than an error", async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.store.buryPerson(dupId, keptId);

    const details = await fetchPersonDetails({
      client: h.client, config: config(), cache: createTtlCache({ ttlMs: 30_000 }),
      personId: dupId,
    });

    expect(details).not.toBeNull();
    expect(details!.pcoPersonId).toBe(keptId);
  });

  it('answers null for a deleted student instead of throwing', async () => {
    const { dupId } = seedDuplicatePair(h);
    h.store.buryPerson(dupId, null);

    const details = await fetchPersonDetails({
      client: h.client, config: config(), cache: createTtlCache({ ttlMs: 30_000 }),
      personId: dupId,
    });

    expect(details).toBeNull();
  });
});

describe('adding a parent contact after the student was merged', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('follows the student to the keeper and writes onto their family', async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.db.seed(`students/pco_${dupId}`, { status: 'active' });
    // The keeper has a household with an adult who has nothing on file.
    const parent = h.store.createPerson({ first_name: 'Dana', last_name: 'Vasquez', child: false });
    h.store.createHousehold({
      attributes: { name: 'Vasquez Household', primary_contact_id: parent.id },
      memberIds: [parent.id, keptId],
    });
    h.store.buryPerson(dupId, keptId);

    const result = await setParentContact({
      db: h.db, client: h.client, config: config(),
      studentId: `pco_${dupId}`, phone: '+15551234567', email: null,
    });

    expect(result.status).toBe('updated');
    expect(h.store.phonesFor(parent.id)).toHaveLength(1);
  });
});

describe('pushing a linked visitor whose person was merged', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('follows the merge, repoints the document, and syncs against the keeper', async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.db.seed('students/tally-v1', {
      status: 'active', pcoPersonId: dupId, pcoPushPending: false,
      firstName: 'Rowan', lastName: 'Vasquez', grade: 9,
    });
    h.store.buryPerson(dupId, keptId);

    const result = await pushStudent({
      db: h.db, client: h.client, config: config(), studentId: 'tally-v1',
    });

    // grade 9 differs from the keeper's 8, so the push has something to write
    expect(result.status).toBe('updated');
    expect(result.pcoPersonId).toBe(keptId);
    expect(h.store.personById(keptId)?.grade).toBe(9);
    const doc = (await h.db.doc('students/tally-v1').get()).data();
    expect(doc?.pcoPersonId).toBe(keptId);
  });

  it('reports a dead-ended link as a skip a leader can act on', async () => {
    const { dupId, keptId } = seedDuplicatePair(h);
    h.db.seed('students/tally-v2', {
      status: 'active', pcoPersonId: dupId, pcoPushPending: false,
      firstName: 'Rowan', lastName: 'Vasquez', grade: 9,
    });
    h.store.buryPerson(dupId, keptId);
    h.store.buryPerson(keptId, null);

    const result = await pushStudent({
      db: h.db, client: h.client, config: config(), studentId: 'tally-v2',
    });

    expect(result.status).toBe('skipped');
    expect(result.message).toMatch(/deleted or merged away/);
    // the link stays for a human to decide about; nothing was invented
    const doc = (await h.db.doc('students/tally-v2').get()).data();
    expect(doc?.pcoPersonId).toBe(dupId);
  });
});

describe('what has not changed', () => {
  it('a real error is still an error, not quietly "gone"', async () => {
    const h = harness();
    const teapot = new PcoApiError(500, '/people/1', []);
    expect(isPersonGoneError(teapot)).toBe(false);

    h.db.seed('students/pco_1', { status: 'active' });
    await expect(
      readThroughMerges({ db: h.db, client: h.client }, 'pco_1', '1', async () => {
        throw teapot;
      }),
    ).rejects.toBe(teapot);
  });
});
