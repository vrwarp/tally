/**
 * Re-creating a Planning Center person for a student whose record died.
 *
 * The scenarios mirror the freeze this exists to thaw: a student flagged
 * `pcoRecordMissing` is refused check-ins by the rules, and this flow is the
 * sanctioned way back that does not take them off the roster. The tests lean
 * on what the flow must *refuse* to do — create where the record still
 * exists, create where a merge survivor lives, create a duplicate of somebody
 * findable by name — because a wrong create here is a new duplicate in the
 * church's permanent database.
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
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { recreateStudent } from './recreate.js';

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

const run = (h: Harness, studentId: string, extra: Record<string, unknown> = {}) =>
  recreateStudent({ db: h.db, client: h.client, config: config(), studentId, ...extra });

describe('what it refuses to create', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('clears the flag when the record is actually still there', async () => {
    const person = h.store.createPerson({ first_name: 'Still', last_name: 'Here', child: true });
    h.db.seed(`students/pco_${person.id}`, { status: 'active', pcoRecordMissing: true });

    const result = await run(h, `pco_${person.id}`);

    expect(result.status).toBe('still-there');
    expect(h.store.people.filter((p) => p.last_name === 'Here')).toHaveLength(1);
    const docData = (await h.db.doc(`students/pco_${person.id}`).get()).data();
    expect(docData?.pcoRecordMissing).toBe(false);
  });

  it('relinks to a merge survivor instead of creating a duplicate', async () => {
    const dup = h.store.createPerson({ first_name: 'Rowan', last_name: 'Vasquez', child: true });
    const kept = h.store.createPerson({ first_name: 'Rowan', last_name: 'Vasquez', child: true });
    h.db.seed(`students/pco_${dup.id}`, { status: 'active', pcoRecordMissing: true });
    h.store.buryPerson(dup.id, kept.id);

    const result = await run(h, `pco_${dup.id}`);

    expect(result.status).toBe('relinked');
    expect(result.pcoPersonId).toBe(kept.id);
    expect(result.studentId).toBe(`pco_${kept.id}`);
    const keeperDoc = (await h.db.doc(`students/pco_${kept.id}`).get()).data();
    expect(keeperDoc).toMatchObject({ status: 'active', pcoRecordMissing: false });
  });

  it('does nothing at all while write-back is off', async () => {
    h.db.seed('students/tally-v1', {
      status: 'active', pcoPersonId: '9', firstName: 'A', lastName: 'B', grade: 8,
    });
    const result = await recreateStudent({
      db: h.db, client: h.client, config: config('off'), studentId: 'tally-v1',
    });
    expect(result.status).toBe('disabled');
    expect(h.store.requestLog.filter((entry) => entry.method === 'POST')).toEqual([]);
  });

  it('points an unlinked visitor at the ordinary push instead', async () => {
    h.db.seed('students/tally-v2', {
      status: 'active', pcoPersonId: null, firstName: 'A', lastName: 'B', grade: 8,
    });
    const result = await run(h, 'tally-v2');
    expect(result.status).toBe('not-linked');
  });
});

describe('re-creating for a visitor document', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('re-creates through the push, which links the document and thaws it', async () => {
    const dead = h.store.createPerson({ first_name: 'Gone', last_name: 'Entirely', child: true });
    h.db.seed('students/tally-v3', {
      status: 'active', pcoPersonId: dead.id, pcoPushPending: false,
      pcoRecordMissing: true, firstName: 'Priya', lastName: 'Natarajan', grade: 8,
    });
    h.store.buryPerson(dead.id, null);

    const result = await run(h, 'tally-v3');

    expect(result.status).toBe('recreated');
    const created = h.store.people.find((p) => p.last_name === 'Natarajan');
    expect(created).toBeTruthy();
    const docData = (await h.db.doc('students/tally-v3').get()).data();
    expect(docData).toMatchObject({
      pcoPersonId: created!.id,
      pcoPushPending: false,
      pcoRecordMissing: false,
    });
  });

  it('matches an existing person by name rather than creating a twin', async () => {
    const dead = h.store.createPerson({ first_name: 'Priya', last_name: 'Natarajan', child: true });
    const twin = h.store.createPerson({
      first_name: 'Priya', last_name: 'Natarajan', child: true, grade: 8,
    });
    h.db.seed('students/tally-v4', {
      status: 'active', pcoPersonId: dead.id, pcoRecordMissing: true,
      firstName: 'Priya', lastName: 'Natarajan', grade: 8,
    });
    h.store.buryPerson(dead.id, null);
    const before = h.store.people.length;

    const result = await run(h, 'tally-v4');

    expect(result.status).toBe('recreated');
    expect(result.pcoPersonId).toBe(twin.id);
    expect(h.store.people.length).toBe(before);
  });
});

describe('re-creating for a pco_ document, which holds no name', () => {
  let h: Harness;
  beforeEach(() => { h = harness(); });

  it('asks for the name it never stored', async () => {
    const dead = h.store.createPerson({ first_name: 'Name', last_name: 'Lost', child: true });
    h.db.seed(`students/pco_${dead.id}`, { status: 'active', pcoRecordMissing: true });
    h.store.buryPerson(dead.id, null);

    const result = await run(h, `pco_${dead.id}`);

    expect(result.status).toBe('needs-details');
    expect(h.store.people.find((p) => p.last_name === 'Lost')).toBeUndefined();
  });

  it('creates from the typed name and migrates the membership', async () => {
    const dead = h.store.createPerson({ first_name: 'Name', last_name: 'Lost', child: true });
    h.db.seed(`students/pco_${dead.id}`, {
      status: 'active', pcoRecordMissing: true, addedToRosterAt: 'earlier',
    });
    h.store.buryPerson(dead.id, null);

    const result = await run(h, `pco_${dead.id}`, {
      firstName: 'Jordan', lastName: 'Reyes', grade: 10,
    });

    expect(result.status).toBe('recreated');
    const created = h.store.people.find((p) => p.last_name === 'Reyes');
    expect(created).toBeTruthy();
    expect(created!.child).toBe(true);
    expect(result.studentId).toBe(`pco_${created!.id}`);
    const fresh = (await h.db.doc(`students/pco_${created!.id}`).get()).data();
    expect(fresh).toMatchObject({
      pcoPersonId: created!.id,
      status: 'active',
      pcoRecordMissing: false,
      recreatedFromStudentId: `pco_${dead.id}`,
      addedToRosterAt: 'earlier',
    });
    const old = (await h.db.doc(`students/pco_${dead.id}`).get()).data();
    expect(old).toMatchObject({
      status: 'inactive',
      recreatedAsStudentId: `pco_${created!.id}`,
    });
  });
});

describe('the roster separates known-gone from could-not-look', () => {
  it('reports a dead-end straggler in missing, and a relinked one not', async () => {
    const h = harness();
    const { fetchRoster } = await import('./roster.js');
    const { createTtlCache } = await import('./cache.js');
    const gone = h.store.createPerson({ first_name: 'Dead', last_name: 'End', child: true });
    const dup = h.store.createPerson({ first_name: 'Merged', last_name: 'Away', child: true });
    const kept = h.store.createPerson({ first_name: 'Merged', last_name: 'Kept', child: true });
    h.store.buryPerson(gone.id, null);
    h.store.buryPerson(dup.id, kept.id);

    const result = await fetchRoster({
      client: h.client, config: config(), cache: createTtlCache({ ttlMs: 0 }),
      personIds: [gone.id, dup.id],
    });

    expect(result.missing).toEqual([gone.id]);
    expect(result.unresolved).toEqual([gone.id]);
    expect(result.relinks).toEqual([{ fromPersonId: dup.id, toPersonId: kept.id }]);
  });
});
