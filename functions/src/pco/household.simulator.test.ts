/**
 * Building a family, against a realistic Planning Center.
 *
 * This is the widest write Tally makes and the one with the least reversible
 * consequences: a duplicate parent is a merge somebody does by hand, and a
 * child attached to the wrong household is one family's phone number shown to
 * another. So most of what follows is about the moments this code *stops* —
 * when a name already exists upstream, when an adult is already on file, when
 * the person somebody chose turns out to be a child.
 *
 * The happy paths are checked through the API rather than through the return
 * value wherever it is possible to: what matters is that the household really
 * is there afterwards and that the read path can find the parent in it.
 */
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
import { createPcoClient, type PcoClient } from './client.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { fetchPersonDetails } from './roster.js';
import { createTtlCache } from './cache.js';
import { addParent, type AddParentOptions } from './household.js';

function config(writeBack: PcoWriteBackMode): PcoConfig {
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

/** A roster student's document: an annotation, holding no name of its own. */
function annotation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { notes: null, status: 'active', pcoPushPending: false, ...overrides };
}

/** Marcus is in a household of his own with no adult in it — the dead end. */
const MARCUS = FIXTURE_IDS.marcusNoAdultAtHome;
const MARCUS_STUDENT = `pco_${MARCUS}`;

describe('addParent against the simulator', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
    h.db.seed(`students/${MARCUS_STUDENT}`, annotation());
  });

  const add = (patch: Partial<AddParentOptions>, writeBack: PcoWriteBackMode = 'full') =>
    addParent({
      db: h.db,
      client: h.client,
      config: config(writeBack),
      studentId: MARCUS_STUDENT,
      ...patch,
    });

  /** What the app itself would show for this student afterwards. */
  const detailsFor = (personId: string) =>
    fetchPersonDetails({
      client: h.client,
      config: config('full'),
      // No retention: these assertions are about what Planning Center now
      // holds, not about what a cache remembers of it.
      cache: createTtlCache({ ttlMs: 0 }),
      personId,
    });

  describe('creating a parent', () => {
    it('puts a new adult in the household and makes them reachable', async () => {
      const before = h.store.people.length;

      const result = await add({
        firstName: 'Dana',
        lastName: 'Whitfield',
        phone: '(510) 555-0142',
      });

      expect(result.status).toBe('added');
      expect(result.createdPerson).toBe(true);
      expect(result.wrote).toEqual(['phone']);
      expect(h.store.people).toHaveLength(before + 1);

      // The read path — the same one the student's page uses — now finds them.
      const details = await detailsFor(MARCUS);
      expect(details?.householdAdult).toBe(true);
      expect(details?.parentName).toBe('Dana Whitfield');
      expect(details?.parentPhone).toMatch(/0142/);
    });

    it('creates them as an adult, not another child on the roster', async () => {
      const result = await add({ firstName: 'Dana', lastName: 'Whitfield' });

      const created = h.store.personById(result.parentPersonId!);
      expect(created?.child).toBe(false);
      expect(created?.grade).toBeNull();
    });

    it('joins the household the student is already in rather than making a second', async () => {
      const before = h.store.householdsForPerson(MARCUS);
      expect(before).toHaveLength(1);

      await add({ firstName: 'Dana', lastName: 'Whitfield' });

      const after = h.store.householdsForPerson(MARCUS);
      expect(after.map((household) => household.id)).toEqual(before.map((household) => household.id));
      expect(h.store.membershipsForHousehold(after[0]!.id)).toHaveLength(2);
    });

    it("takes the student's surname when nobody typed one", async () => {
      const result = await add({ firstName: 'Dana' });

      expect(h.store.personById(result.parentPersonId!)?.last_name).toBe('Johnson');
    });

    it('records an email as well as a phone', async () => {
      const result = await add({
        firstName: 'Dana',
        lastName: 'Whitfield',
        phone: '(510) 555-0142',
        email: 'Dana.Whitfield@example.com',
      });

      expect(result.wrote).toEqual(['phone', 'email']);
      const details = await detailsFor(MARCUS);
      expect(details?.parentEmail).toBe('dana.whitfield@example.com');
    });

    it('is fine with a parent who has no contact details yet', async () => {
      const result = await add({ firstName: 'Dana', lastName: 'Whitfield' });

      expect(result.status).toBe('added');
      expect(result.wrote).toEqual([]);
      expect(result.message).toMatch(/no contact details yet/);
    });
  });

  describe('a student with no household at all', () => {
    /**
     * A visitor pushed upstream from the door has a Person and nothing else.
     * This is the case the old dead end was worst for: no household meant no
     * write path, so the number a leader had in their hand had nowhere to go.
     */
    it('creates the household, with the student and the parent in it', async () => {
      const student = h.store.createPerson({
        first_name: 'Nia',
        last_name: 'Fontaine',
        grade: 9,
        child: true,
      });
      h.db.seed(`students/pco_${student.id}`, annotation());
      expect(h.store.householdsForPerson(student.id)).toHaveLength(0);

      const result = await addParent({
        db: h.db,
        client: h.client,
        config: config('full'),
        studentId: `pco_${student.id}`,
        firstName: 'Ruth',
        phone: '(510) 555-0188',
      });

      expect(result.status).toBe('added');
      expect(result.createdHousehold).toBe(true);

      const household = h.store.householdsForPerson(student.id)[0];
      expect(household).toBeDefined();
      expect(household!.primary_contact_id).toBe(result.parentPersonId);
      expect(h.store.membershipsForHousehold(household!.id).map((m) => m.person_id)).toEqual(
        expect.arrayContaining([student.id, result.parentPersonId!]),
      );

      const details = await detailsFor(student.id);
      expect(details?.parentName).toBe('Ruth Fontaine');
      expect(details?.parentPhone).toMatch(/0188/);
    });
  });

  describe('when Planning Center already has somebody by that name', () => {
    /**
     * The duplicate this refuses to create is the whole reason there is a
     * confirmation step. A church's parents are already in People — they attend
     * — they are simply not linked to their child's household.
     */
    it('stops and offers them instead of creating a second record', async () => {
      const before = h.store.people.length;

      const result = await add({ firstName: 'Rosa', lastName: 'Delgado' });

      expect(result.status).toBe('existing-people');
      expect(result.candidates.map((candidate) => candidate.name)).toContain('Rosa Delgado');
      expect(h.store.people).toHaveLength(before);
      expect(h.store.membershipsForHousehold(h.store.householdsForPerson(MARCUS)[0]!.id)).toHaveLength(1);
    });

    it('uses the person somebody picked, without creating anybody', async () => {
      const rosa = h.store.people.find(
        (person) => person.first_name === 'Rosa' && person.last_name === 'Delgado',
      )!;
      const before = h.store.people.length;

      const result = await add({ personId: rosa.id, phone: '(510) 555-0142' });

      expect(result.status).toBe('added');
      expect(result.createdPerson).toBe(false);
      expect(result.parentPersonId).toBe(rosa.id);
      expect(h.store.people).toHaveLength(before);

      const details = await detailsFor(MARCUS);
      expect(details?.parentName).toBe('Rosa Delgado');
    });

    it('creates a new person anyway when told the match is somebody else', async () => {
      const before = h.store.people.length;

      const result = await add({ firstName: 'Rosa', lastName: 'Delgado', createNew: true });

      expect(result.status).toBe('added');
      expect(result.createdPerson).toBe(true);
      expect(h.store.people).toHaveLength(before + 1);
    });

    /** Never a second copy of a number the church already has for them. */
    it('leaves a contact detail the chosen adult already has alone', async () => {
      const rosa = h.store.people.find(
        (person) => person.first_name === 'Rosa' && person.last_name === 'Delgado',
      )!;
      const phonesBefore = h.store.phonesFor(rosa.id).length;

      const result = await add({ personId: rosa.id, phone: '(510) 555-9999' });

      expect(result.skipped).toEqual(['phone']);
      expect(h.store.phonesFor(rosa.id)).toHaveLength(phonesBefore);
    });
  });

  describe('refusals', () => {
    it('does nothing at all unless write-back is full', async () => {
      const before = h.store.people.length;

      const result = await add({ firstName: 'Dana', lastName: 'Whitfield' }, 'create');

      expect(result.status).toBe('disabled');
      expect(h.store.people).toHaveLength(before);
    });

    /**
     * The premise of the form is that nobody can be reached. If that stopped
     * being true while it was open, a second parent is the wrong repair.
     */
    it('refuses once Planning Center has an adult in the household', async () => {
      const tobias = FIXTURE_IDS.tobiasEmailOnlyParent;
      h.db.seed(`students/pco_${tobias}`, annotation());
      const before = h.store.people.length;

      const result = await addParent({
        db: h.db,
        client: h.client,
        config: config('full'),
        studentId: `pco_${tobias}`,
        firstName: 'Dana',
        lastName: 'Whitfield',
      });

      expect(result.status).toBe('already-has-adult');
      expect(result.parentName).toBeTruthy();
      expect(h.store.people).toHaveLength(before);
    });

    it('will not make a child into somebody else’s emergency contact', async () => {
      const result = await add({ personId: FIXTURE_IDS.amara });

      expect(result.status).toBe('not-an-adult');
      expect(h.store.householdsForPerson(FIXTURE_IDS.amara).map((household) => household.id)).not.toContain(
        h.store.householdsForPerson(MARCUS)[0]!.id,
      );
    });

    it('asks for a name rather than creating a nameless person', async () => {
      const before = h.store.people.length;

      const result = await add({ phone: '(510) 555-0142' });

      expect(result.status).toBe('nothing-to-write');
      expect(h.store.people).toHaveLength(before);
    });

    it('refuses a student who is not in Planning Center yet', async () => {
      h.db.seed('students/s1', annotation({ pcoPersonId: null, pcoPushPending: true }));

      const result = await addParent({
        db: h.db,
        client: h.client,
        config: config('full'),
        studentId: 's1',
        firstName: 'Dana',
      });

      expect(result.status).toBe('not-in-planning-center');
    });

    it('refuses a student taken off the roster', async () => {
      h.db.seed(`students/${MARCUS_STUDENT}`, annotation({ status: 'inactive' }));

      const result = await add({ firstName: 'Dana', lastName: 'Whitfield' });

      expect(result.status).toBe('no-student');
    });
  });
});
