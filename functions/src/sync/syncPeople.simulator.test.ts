/**
 * The whole sync, against a realistic Planning Center.
 *
 * `syncPeople.test.ts` drives the sync with canned pages to pin down individual
 * branches. This file runs it against the API simulator through the real
 * client, so what is being tested is the outcome a ministry would actually see:
 * who ends up on the roster, who does not, and what a second run costs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  FIXTURE_IDS,
  SIMULATOR_ORIGIN,
  STUDENT_LIST_ID,
  SimulatorStore,
  TEAM_LIST_ID,
  createSimulatorFetch,
} from '../../../tools/pco-simulator/src/index.js';
import type { PcoConfig } from '../config.js';
import { createPcoClient, type PcoClient } from '../pco/client.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { syncPeople } from './syncPeople.js';

const NOW = new Date('2026-07-02T09:00:00Z');

function config(overrides: Partial<PcoConfig> = {}): PcoConfig {
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
    writeBack: 'off',
    syncSchedule: 'every 6 hours',
    smallGroupField: null,
    configError: null,
    ...overrides,
  };
}

interface Harness {
  db: FakeFirestore;
  store: SimulatorStore;
  client: PcoClient;
}

function harness(): Harness {
  const store = new SimulatorStore({ pageSize: 7 });
  const client = createPcoClient({
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    fetchImpl: createSimulatorFetch(store),
    sleep: async () => {},
  });
  return { db: new FakeFirestore(), store, client };
}

/** Every student document currently in the fake Firestore. */
function students(db: FakeFirestore): Record<string, unknown>[] {
  return [...db.data.entries()]
    .filter(([path]) => path.startsWith('students/'))
    .map(([, value]) => value);
}

function studentByPcoId(db: FakeFirestore, pcoPersonId: string): Record<string, unknown> | undefined {
  return students(db).find((student) => student.pcoPersonId === pcoPersonId);
}

function accessRoster(db: FakeFirestore): Record<string, unknown>[] {
  return [...db.data.entries()]
    .filter(([path]) => path.startsWith('accessRoster/'))
    .map(([, value]) => value);
}

describe('syncPeople against the simulator', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  const run = (overrides: Partial<Parameters<typeof syncPeople>[0]> = {}) =>
    syncPeople({
      db: h.db,
      client: h.client,
      config: config(),
      now: NOW,
      triggeredBy: 'test',
      ...overrides,
    });

  describe('grade mode', () => {
    it('imports the 6-12 band and nothing outside it', async () => {
      const result = await run({ full: true });

      expect(result.status).toBe('ok');
      expect(result.counts.studentsCreated).toBeGreaterThan(0);

      // The 5th grader is a real person in Planning Center and must simply not
      // be a Footprints student.
      expect(studentByPcoId(h.db, FIXTURE_IDS.oliverFifthGrader)).toBeUndefined();
      expect(studentByPcoId(h.db, FIXTURE_IDS.amara)).toBeDefined();

      for (const student of students(h.db)) {
        expect(student.grade).toBeGreaterThanOrEqual(6);
        expect(student.grade).toBeLessThanOrEqual(12);
      }
    });

    it('prefers the nickname a student actually goes by', async () => {
      await run({ full: true });
      expect(studentByPcoId(h.db, FIXTURE_IDS.benjiWithNickname)?.firstName).toBe('Benji');
    });

    it('carries medical notes across as allergies', async () => {
      await run({ full: true });
      expect(studentByPcoId(h.db, FIXTURE_IDS.sofiaWithAllergy)?.allergies).toMatch(/peanut/i);
    });

    it('deactivates rather than drops someone who left the ministry', async () => {
      await run({ full: true });

      const ruth = studentByPcoId(h.db, FIXTURE_IDS.ruthInactive);
      // Deleting would orphan every attendance record that points at her.
      expect(ruth).toBeDefined();
      expect(ruth?.status).toBe('inactive');
    });
  });

  describe('list mode', () => {
    const listConfig = config({
      rosterSource: 'list',
      studentListId: STUDENT_LIST_ID,
      counselorListId: TEAM_LIST_ID,
    });

    it('takes the roster the youth pastor actually maintains', async () => {
      await run({ config: listConfig, full: true });

      // On the list despite having no grade in Planning Center — only a
      // graduation year, which the mapper has to turn into a grade.
      const ivy = studentByPcoId(h.db, FIXTURE_IDS.ivyNoGrade);
      expect(ivy).toBeDefined();
      expect(ivy?.grade).toBeGreaterThanOrEqual(6);
      expect(ivy?.grade).toBeLessThanOrEqual(12);

      // Kept off the list by hand, so absent even though the API would return them.
      expect(studentByPcoId(h.db, FIXTURE_IDS.oliverFifthGrader)).toBeUndefined();
    });
  });

  describe('parent contact', () => {
    it('resolves a guardian through the household-membership pass', async () => {
      await run({ full: true });

      const amara = studentByPcoId(h.db, FIXTURE_IDS.amara);
      expect(amara?.parentName).toBeTruthy();
      expect(amara?.parentPhone ?? amara?.parentEmail).toBeTruthy();
      expect(amara?.profileComplete).toBe(true);
    });

    /**
     * Two guardians in one household. Whichever is chosen, it has to be the
     * *same* one every run — otherwise every sync rewrites the record, wakes
     * every counselor's listener, and the "who do I call" answer changes
     * depending on when you looked.
     */
    it('picks the same guardian on a repeated run', async () => {
      await run({ full: true });
      const first = studentByPcoId(h.db, FIXTURE_IDS.amara);

      const second = harness();
      await syncPeople({
        db: second.db,
        client: second.client,
        config: config(),
        now: NOW,
        full: true,
      });
      const repeat = studentByPcoId(second.db, FIXTURE_IDS.amara);

      expect(repeat?.parentName).toBe(first?.parentName);
      expect(repeat?.parentPhone).toBe(first?.parentPhone);
      expect(repeat?.parentEmail).toBe(first?.parentEmail);
    });

    it('still finds a contact when the only adult is a grandparent', async () => {
      await run({ full: true });

      const dexter = studentByPcoId(h.db, FIXTURE_IDS.dexterGrandparent);
      expect(dexter).toBeDefined();
      expect(dexter?.parentName).toBeTruthy();
    });
  });

  describe('cost of a repeat run', () => {
    it('writes nothing at all when nothing changed', async () => {
      await run({ full: true });

      h.db.writes.length = 0;
      await run({ full: true });

      // Not "few writes" — none. Every student write is a snapshot delivered to
      // every counselor's phone.
      const studentWrites = h.db.writes.filter((write) => write.path.startsWith('students/'));
      expect(studentWrites).toEqual([]);
    });

    it('sends the cursor on an incremental run and processes only what moved', async () => {
      await run({ full: true });
      const fullScan = h.store.requestLog.length;

      h.store.requestLog.length = 0;
      const incremental = await run();

      const peopleRequests = h.store.requestLog.filter((entry) => entry.path === '/people');
      expect(peopleRequests.length).toBeGreaterThan(0);
      expect(peopleRequests.some((entry) => entry.query.includes('where[updated_at][gt]'))).toBe(true);
      expect(incremental.counts.peopleScanned).toBeLessThan(fullScan * 10);
    });
  });

  describe('the team', () => {
    it('grants access to everyone with an email and skips the one without', async () => {
      await run({
        config: config({ rosterSource: 'list', studentListId: STUDENT_LIST_ID, counselorListId: TEAM_LIST_ID }),
        full: true,
      });

      const entries = accessRoster(h.db);
      const byPcoId = new Map(entries.map((entry) => [entry.pcoPersonId, entry]));

      expect(byPcoId.get(FIXTURE_IDS.adminDana)?.role).toBe('admin');
      expect(byPcoId.get(FIXTURE_IDS.managerMiriam)?.role).toBe('core');
      expect(byPcoId.get(FIXTURE_IDS.editorPriya)?.role).toBe('core');
      expect(byPcoId.get(FIXTURE_IDS.viewerSam)?.role).toBe('counselor');

      // No email means no way to match a sign-in, so no access — and, crucially,
      // no crash.
      expect(byPcoId.has(FIXTURE_IDS.noEmailGerald)).toBe(false);
    });

    it('keys entries by a normalised email so a sign-in can find them', async () => {
      await run({
        config: config({ rosterSource: 'list', studentListId: STUDENT_LIST_ID, counselorListId: TEAM_LIST_ID }),
        full: true,
      });

      const paths = h.db.writtenPaths('accessRoster/');
      expect(paths).toContain('accessRoster/dana,ruiz@footprints,example,org');
      for (const entry of accessRoster(h.db)) {
        expect(entry.email).toBe(String(entry.email).toLowerCase());
      }
    });
  });

  describe('when Planning Center is unwell', () => {
    it('records a terminal error state instead of leaving the sync running forever', async () => {
      h.store.scheduleFailure(500, 'Internal Server Error', 999);

      const result = await run({ full: true });

      expect(result.status).toBe('error');
      const state = h.db.get('config/pcoSync');
      expect(state?.status).toBe('error');
      expect(String(state?.lastError)).toMatch(/500|Planning Center/i);
    });

    it('survives a rate limit by backing off rather than failing the run', async () => {
      h.store.scheduleRateLimit({ count: 1, retryAfterSeconds: 1 });

      const result = await run({ full: true });

      expect(result.status).toBe('ok');
      expect(result.counts.studentsCreated).toBeGreaterThan(0);
    });

    it('refuses to deactivate the whole roster when a full sweep returns nobody', async () => {
      await run({ full: true });
      const before = students(h.db).filter((student) => student.status === 'active').length;
      expect(before).toBeGreaterThan(0);

      // An emptied list looks identical to "the ministry lost every student",
      // and that write is not undoable in one click.
      const empty = new SimulatorStore({ empty: true });
      const emptyClient = createPcoClient({
        appId: DEFAULT_APP_ID,
        secret: DEFAULT_SECRET,
        baseUrl: SIMULATOR_ORIGIN,
        fetchImpl: createSimulatorFetch(empty),
        sleep: async () => {},
      });

      await syncPeople({ db: h.db, client: emptyClient, config: config(), now: NOW, full: true });

      const after = students(h.db).filter((student) => student.status === 'active').length;
      expect(after).toBe(before);
    });
  });
});
