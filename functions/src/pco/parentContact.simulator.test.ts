/**
 * Adding a parent contact, against a realistic Planning Center.
 *
 * Like `pushStudents.simulator.test.ts`, most of what is worth asserting here is
 * *restraint*. This writes onto an adult in a real church's people database from
 * a number somebody typed on a phone, and the failure that matters is not "the
 * write did not land" — it is a second phone number on a parent who already had
 * one, or a contact quietly attached to the wrong member of a household.
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
import { normalizeEmail, normalizePhone, setParentContact } from './parentContact.js';

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

/** A roster student, as `addRosterMember` would have written them. */
function rosterStudent(personId: string, overrides: Record<string, unknown> = {}) {
  return { pcoPersonId: personId, status: 'active', ...overrides };
}

describe('setParentContact against the simulator', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  const add = (
    studentId: string,
    fields: { phone?: string | null; email?: string | null },
    writeBack: PcoWriteBackMode = 'full',
  ) =>
    setParentContact({
      db: h.db,
      client: h.client,
      config: config(writeBack),
      studentId,
      ...fields,
    });

  /** The adult in a student's household, as the simulator holds them. */
  function parentOf(personId: string) {
    const householdId = h.store.membershipsForPerson(personId)[0]?.household_id;
    const adult = h.store
      .membershipsForHousehold(householdId ?? '')
      .find((membership) => membership.person_id !== personId);
    return adult?.person_id ?? null;
  }

  describe('what it refuses to do', () => {
    it('does nothing at all unless write-back is full', async () => {
      const id = `pco_${FIXTURE_IDS.tobiasEmailOnlyParent}`;
      h.db.seed(`students/${id}`, rosterStudent(FIXTURE_IDS.tobiasEmailOnlyParent));
      const before = h.store.phonesFor(parentOf(FIXTURE_IDS.tobiasEmailOnlyParent)!).length;

      for (const mode of ['off', 'create'] as const) {
        const result = await add(id, { phone: '(510) 555-0142' }, mode);
        expect(result.status).toBe('disabled');
        expect(result.wrote).toEqual([]);
      }

      // The point of the gate: nothing reached Planning Center.
      expect(h.store.phonesFor(parentOf(FIXTURE_IDS.tobiasEmailOnlyParent)!)).toHaveLength(before);
      expect(h.store.requestLog.filter((entry) => entry.method === 'POST')).toEqual([]);
    });

    it('will not invent a parent for a household that has none', async () => {
      const id = `pco_${FIXTURE_IDS.marcusNoAdultAtHome}`;
      h.db.seed(`students/${id}`, rosterStudent(FIXTURE_IDS.marcusNoAdultAtHome));
      const people = h.store.people.length;

      const result = await add(id, { phone: '(510) 555-0142' });

      expect(result.status).toBe('no-household-adult');
      // The whole restriction, asserted directly: no Person was created to hang
      // the number off, and nothing was written anywhere.
      expect(h.store.people).toHaveLength(people);
      expect(h.store.requestLog.filter((entry) => entry.method === 'POST')).toEqual([]);
    });

    it('refuses a student who is not in Planning Center yet', async () => {
      h.db.seed('students/tally-1', { pcoPersonId: null, status: 'active' });

      const result = await add('tally-1', { phone: '(510) 555-0142' });

      expect(result.status).toBe('not-in-planning-center');
    });

    it('refuses a student nobody put on the roster', async () => {
      const result = await add(`pco_${FIXTURE_IDS.tobiasEmailOnlyParent}`, { phone: '(510) 555-0142' });

      expect(result.status).toBe('no-student');
      expect(h.store.requestLog.filter((entry) => entry.method === 'POST')).toEqual([]);
    });

    it('refuses a student taken off the roster', async () => {
      const id = `pco_${FIXTURE_IDS.tobiasEmailOnlyParent}`;
      h.db.seed(`students/${id}`, rosterStudent(FIXTURE_IDS.tobiasEmailOnlyParent, { status: 'inactive' }));

      expect((await add(id, { phone: '(510) 555-0142' })).status).toBe('no-student');
    });

    it('does not overwrite or duplicate a contact already on file', async () => {
      /*
       * The race this exists for: the screen decided the student was
       * unreachable, and somebody fixed it in Planning Center while a leader was
       * typing. A second email on a real parent is not a correction.
       */
      const id = `pco_${FIXTURE_IDS.tobiasEmailOnlyParent}`;
      h.db.seed(`students/${id}`, rosterStudent(FIXTURE_IDS.tobiasEmailOnlyParent));
      const parent = parentOf(FIXTURE_IDS.tobiasEmailOnlyParent)!;
      const held = h.store.emailsFor(parent).map((email) => email.address);

      const result = await add(id, { email: 'someone.else@example.org' });

      expect(result.status).toBe('already-set');
      expect(result.skipped).toEqual(['email']);
      expect(h.store.emailsFor(parent).map((email) => email.address)).toEqual(held);
    });
  });

  describe('what it does', () => {
    it('adds the missing half and leaves the half on file alone', async () => {
      // Tobias's parent has an email and no phone: exactly one of the two
      // fields should reach Planning Center.
      const id = `pco_${FIXTURE_IDS.tobiasEmailOnlyParent}`;
      h.db.seed(`students/${id}`, rosterStudent(FIXTURE_IDS.tobiasEmailOnlyParent));
      const parent = parentOf(FIXTURE_IDS.tobiasEmailOnlyParent)!;
      const heldEmails = h.store.emailsFor(parent).length;

      const result = await add(id, { phone: '(510) 555-0142', email: 'new@example.org' });

      expect(result.status).toBe('updated');
      expect(result.wrote).toEqual(['phone']);
      expect(result.skipped).toEqual(['email']);
      expect(h.store.phonesFor(parent).map((phone) => phone.number)).toEqual(['(510) 555-0142']);
      expect(h.store.emailsFor(parent)).toHaveLength(heldEmails);
    });

    it('writes onto the parent, never onto the student', async () => {
      const id = `pco_${FIXTURE_IDS.tobiasEmailOnlyParent}`;
      h.db.seed(`students/${id}`, rosterStudent(FIXTURE_IDS.tobiasEmailOnlyParent));

      await add(id, { phone: '(510) 555-0142' });

      expect(h.store.phonesFor(FIXTURE_IDS.tobiasEmailOnlyParent)).toEqual([]);
      expect(h.store.phonesFor(parentOf(FIXTURE_IDS.tobiasEmailOnlyParent)!)).toHaveLength(1);
    });

    it('adds both when the parent has neither, and names them back', async () => {
      const student = h.store.seedStudent({
        firstName: 'Della',
        lastName: 'Okafor',
        grade: 9,
        contactName: 'Ada Okafor',
      });
      const id = `pco_${student.id}`;
      h.db.seed(`students/${id}`, rosterStudent(student.id));

      const result = await add(id, { phone: '510-555-0199', email: 'Ada@Example.ORG' });

      expect(result.status).toBe('updated');
      expect(result.wrote).toEqual(['phone', 'email']);
      expect(result.contactName).toBe('Ada Okafor');

      const parent = parentOf(student.id)!;
      expect(h.store.phonesFor(parent).map((phone) => phone.number)).toEqual(['510-555-0199']);
      // Lower-cased on the way in: a parent's address is matched against
      // elsewhere, and two casings of it are two records nobody wanted.
      expect(h.store.emailsFor(parent).map((email) => email.address)).toEqual(['ada@example.org']);
    });

    it('reads the person id from Tally rather than from the caller', async () => {
      /*
       * `students/pco_123` *is* the claim that this row is person 123. A student
       * id that says one thing while the document says another must follow the
       * document — the same rule `scanRoster` enforces on every read.
       */
      const id = `pco_${FIXTURE_IDS.tobiasEmailOnlyParent}`;
      h.db.seed(`students/${id}`, rosterStudent(FIXTURE_IDS.leilaPhoneOnlyParent));

      await add(id, { phone: '(510) 555-0142' });

      // The prefix won, and Leila's household was never touched.
      expect(h.store.phonesFor(parentOf(FIXTURE_IDS.tobiasEmailOnlyParent)!)).toHaveLength(1);
      expect(h.store.phonesFor(parentOf(FIXTURE_IDS.leilaPhoneOnlyParent)!)).toHaveLength(1);
    });
  });

  describe('validation', () => {
    it('refuses to write something nobody could ring or email', async () => {
      const id = `pco_${FIXTURE_IDS.tobiasEmailOnlyParent}`;
      h.db.seed(`students/${id}`, rosterStudent(FIXTURE_IDS.tobiasEmailOnlyParent));

      const result = await add(id, { phone: '  ', email: 'not-an-address' });

      expect(result.status).toBe('nothing-to-write');
      expect(h.store.requestLog.filter((entry) => entry.method === 'POST')).toEqual([]);
    });
  });
});

describe('normalizePhone', () => {
  it('keeps whatever shape the church types, so long as it is dialable', () => {
    expect(normalizePhone('(510) 555-0142')).toBe('(510) 555-0142');
    expect(normalizePhone(' +44 20 7946 0958 ')).toBe('+44 20 7946 0958');
    expect(normalizePhone('5105550142')).toBe('5105550142');
  });

  it('rejects what is not a number anybody could ring', () => {
    // An extension typed into the wrong box, which would make the student look
    // reachable when nobody can reach them.
    expect(normalizePhone('4102')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('ask her mum')).toBeNull();
    expect(normalizePhone('1234567890123456')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lower-cases and accepts an ordinary address', () => {
    expect(normalizeEmail(' Ada@Example.ORG ')).toBe('ada@example.org');
    expect(normalizeEmail('a.b+tag@mail.example.co.uk')).toBe('a.b+tag@mail.example.co.uk');
  });

  it('rejects a typo before it reaches a permanent record', () => {
    expect(normalizeEmail('ada@example')).toBeNull();
    expect(normalizeEmail('ada.example.org')).toBeNull();
    expect(normalizeEmail('ada@@example.org')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});
