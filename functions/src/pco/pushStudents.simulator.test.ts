/**
 * Write-back, against a realistic Planning Center.
 *
 * This is the riskiest code in the integration: it writes into a database Tally
 * does not own, from data a volunteer thumb-typed at a door. The tests below are
 * mostly about *restraint* — that it creates only what it must, links rather
 * than duplicates, and does nothing at all when told not to.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  FIXTURE_IDS,
  SIMULATOR_ORIGIN,
  SimulatorStore,
  createSimulatorFetch,
} from '../../../tools/pco-simulator/src/index.js';
import type { PcoConfig, PcoWriteBackMode } from '../config.js';
import { createPcoClient, type PcoClient } from '../pco/client.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { pushPendingStudents, pushStudent } from './pushStudents.js';

const NOW = new Date('2026-07-02T09:00:00Z');
const OLD = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));

function config(writeBack: PcoWriteBackMode): PcoConfig {
  return {
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    baseUrlOverridden: true,
    rosterSource: 'grade',
    studentListId: null,
    counselorListId: null,
    minGrade: 6,
    maxGrade: 12,
    writeBack,
    cacheTtlSeconds: 30,
    smallGroupField: null,
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

/** A student as the quick-add visitor modal would have written them. */
function tallyOnlyStudent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'Nia',
    lastName: 'Fontaine',
    grade: 9,
    gender: 'unspecified',
    smallGroupId: null,
    parentName: null,
    parentPhone: null,
    parentEmail: null,
    allergies: null,
    notes: null,
    status: 'active',
    isVisitor: true,
    profileComplete: false,
    searchName: 'nia fontaine',
    firstAttendedAt: OLD,
    lastAttendedAt: OLD,
    pcoPersonId: null,
    pcoUpdatedAt: null,
    pcoSyncedAt: null,
    pcoPushPending: true,
    createdAt: OLD,
    updatedAt: OLD,
    createdBy: 'counselor-1',
    ...overrides,
  };
}

describe('pushStudent against the simulator', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  const push = (studentId: string, writeBack: PcoWriteBackMode) =>
    pushStudent({ db: h.db, client: h.client, config: config(writeBack), studentId, now: NOW });

  describe('create mode', () => {
    it('creates the person and the API really has them afterwards', async () => {
      h.db.seed('students/s1', tallyOnlyStudent());
      const before = h.store.people.length;

      const result = await push('s1', 'create');

      expect(result.status).toBe('created');
      expect(result.pcoPersonId).toBeTruthy();
      expect(h.store.people).toHaveLength(before + 1);

      const created = h.store.personById(result.pcoPersonId!);
      expect(created).toMatchObject({ first_name: 'Nia', last_name: 'Fontaine', grade: 9, child: true });
    });

    it('records the link and clears the pending flag', async () => {
      h.db.seed('students/s1', tallyOnlyStudent());

      const result = await push('s1', 'create');

      const stored = h.db.get('students/s1')!;
      expect(stored.pcoPersonId).toBe(result.pcoPersonId);
      expect(stored.pcoPushPending).toBe(false);
    });

    it('sends allergies through as medical notes', async () => {
      h.db.seed('students/s1', tallyOnlyStudent({ allergies: 'Bee stings — carries an EpiPen' }));

      const result = await push('s1', 'create');

      expect(h.store.personById(result.pcoPersonId!)?.medical_notes).toMatch(/Bee stings/);
    });

    /**
     * The one that matters. Creating a second "Amara Okonkwo" in a church's real
     * People database is a mess a human has to clean up by hand, and Tally would
     * have caused it.
     */
    it('links to an existing person instead of creating a duplicate', async () => {
      const before = h.store.people.length;
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({ firstName: 'Amara', lastName: 'Okonkwo', grade: 8, searchName: 'amara okonkwo' }),
      );

      const result = await push('s1', 'create');

      expect(result.pcoPersonId).toBe(FIXTURE_IDS.amara);
      expect(h.store.people).toHaveLength(before);
    });

    it('creates when the name matches but the grade does not', async () => {
      const before = h.store.people.length;
      h.db.seed(
        'students/s1',
        // Same name, wrong grade: almost certainly a different child, and
        // guessing wrong here merges two people's records.
        tallyOnlyStudent({ firstName: 'Amara', lastName: 'Okonkwo', grade: 11, searchName: 'amara okonkwo' }),
      );

      const result = await push('s1', 'create');

      expect(result.status).toBe('created');
      expect(result.pcoPersonId).not.toBe(FIXTURE_IDS.amara);
      expect(h.store.people).toHaveLength(before + 1);
    });

    it('leaves an already-linked student alone', async () => {
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({ pcoPersonId: FIXTURE_IDS.amara, pcoPushPending: false }),
      );
      const before = h.store.people.length;

      const result = await push('s1', 'create');

      expect(result.status).toBe('skipped');
      expect(h.store.people).toHaveLength(before);
    });
  });

  describe('off mode', () => {
    it('writes nothing and keeps the student queued for later', async () => {
      h.db.seed('students/s1', tallyOnlyStudent());
      const before = h.store.people.length;

      const result = await push('s1', 'off');

      expect(result.status).toBe('skipped');
      expect(result.message).toMatch(/disabled/i);
      expect(h.store.people).toHaveLength(before);
      // Turning write-back on later must pick this student up without anybody
      // re-editing them.
      expect(h.db.get('students/s1')?.pcoPushPending).toBe(true);
    });
  });

  describe('full mode', () => {
    it('patches a linked student whose details drifted in Tally', async () => {
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({
          firstName: 'Amara',
          lastName: 'Okonkwo',
          grade: 9,
          pcoPersonId: FIXTURE_IDS.amara,
          pcoPushPending: false,
        }),
      );
      expect(h.store.personById(FIXTURE_IDS.amara)?.grade).toBe(8);

      const result = await push('s1', 'full');

      expect(result.status).toBe('updated');
      expect(h.store.personById(FIXTURE_IDS.amara)?.grade).toBe(9);
    });

    it('does nothing when Planning Center already agrees', async () => {
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({
          firstName: 'Amara',
          lastName: 'Okonkwo',
          grade: 8,
          pcoPersonId: FIXTURE_IDS.amara,
          pcoPushPending: false,
        }),
      );

      const result = await push('s1', 'full');

      expect(result.status).toBe('skipped');
      expect(h.store.requestLog.some((entry) => entry.method === 'PATCH')).toBe(false);
    });
  });

  describe('pushPendingStudents', () => {
    it('catches up everything the immediate push missed', async () => {
      h.db.seed('students/s1', tallyOnlyStudent({ firstName: 'Nia', searchName: 'nia fontaine' }));
      h.db.seed('students/s2', tallyOnlyStudent({ firstName: 'Theo', searchName: 'theo fontaine' }));
      h.db.seed('students/s3', tallyOnlyStudent({ pcoPersonId: 'X', pcoPushPending: false }));

      const result = await pushPendingStudents({
        db: h.db,
        client: h.client,
        config: config('create'),
        now: NOW,
      });

      expect(result.pushed).toBe(2);
      expect(h.db.get('students/s1')?.pcoPersonId).toBeTruthy();
      expect(h.db.get('students/s2')?.pcoPersonId).toBeTruthy();
    });

    it('is a no-op when write-back is off', async () => {
      h.db.seed('students/s1', tallyOnlyStudent());

      const result = await pushPendingStudents({
        db: h.db,
        client: h.client,
        config: config('off'),
        now: NOW,
      });

      expect(result).toEqual({ pushed: 0, skipped: 0, errors: 0 });
      expect(h.store.requestLog).toHaveLength(0);
    });

    it('counts a failure without abandoning the rest of the queue', async () => {
      h.db.seed('students/s1', tallyOnlyStudent({ firstName: 'Nia', searchName: 'nia fontaine' }));
      h.db.seed('students/s2', tallyOnlyStudent({ firstName: 'Theo', searchName: 'theo fontaine' }));
      h.store.scheduleFailure(422, 'Unprocessable Entity', 1);

      const result = await pushPendingStudents({
        db: h.db,
        client: h.client,
        config: config('create'),
        now: NOW,
      });

      expect(result.errors + result.pushed).toBe(2);
      expect(result.pushed).toBeGreaterThanOrEqual(1);
    });
  });
});
