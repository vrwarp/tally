/**
 * Editing a linked person, against a realistic Planning Center.
 *
 * This is the write a leader reaches for most — Edit profile, fix a misspelt
 * name, Save — and the one with the least ceremony around it, so the tests are
 * about what it *will not* do: not while write-back is turned down, not on a
 * student who is not upstream, not a blank name, and never a field the form did
 * not speak to.
 *
 * The allergy cases are the ones worth reading twice. `medical_notes` is a
 * child's medical record, and the difference between "the leader cleared this
 * box" and "Tally never saw the value" is the difference between an intended
 * deletion and a silent one.
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
import { updateStudentProfile, type StudentProfilePatch } from './profile.js';

function config(writeBack: PcoWriteBackMode, band?: { minGrade: number; maxGrade: number }): PcoConfig {
  return {
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    baseUrlOverridden: true,
    minGrade: band?.minGrade ?? 6,
    maxGrade: band?.maxGrade ?? 12,
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

/**
 * A roster student's document, which is an annotation and nothing more.
 *
 * No name, no grade, no allergies — that is the shape a linked student really
 * has since the mirror was removed, and it is why this write path reads the
 * person from Planning Center rather than from here.
 */
function annotation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { notes: null, status: 'active', pcoPushPending: false, ...overrides };
}

describe('updateStudentProfile against the simulator', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  const save = (studentId: string, patch: StudentProfilePatch, writeBack: PcoWriteBackMode = 'full', band?: { minGrade: number; maxGrade: number }) =>
    updateStudentProfile({ db: h.db, client: h.client, config: config(writeBack, band), studentId, ...patch });

  describe('when write-back is not full', () => {
    it('refuses and changes nothing upstream', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation());

      const result = await save(`pco_${FIXTURE_IDS.amara}`, { firstName: 'Amarachi' }, 'create');

      expect(result.status).toBe('disabled');
      expect(h.store.personById(FIXTURE_IDS.amara)?.first_name).toBe('Amara');
    });

    it('says where the setting is, so the refusal is actionable', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation());

      const result = await save(`pco_${FIXTURE_IDS.amara}`, { firstName: 'Amarachi' }, 'off');

      expect(result.message).toMatch(/Settings/);
    });
  });

  describe('full mode', () => {
    it('renames the person in Planning Center', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation());

      const result = await save(`pco_${FIXTURE_IDS.amara}`, {
        firstName: 'Amarachi',
        lastName: 'Okonkwo-Hale',
      });

      expect(result.status).toBe('updated');
      expect(result.wrote).toEqual(['first_name', 'last_name']);
      expect(h.store.personById(FIXTURE_IDS.amara)).toMatchObject({
        first_name: 'Amarachi',
        last_name: 'Okonkwo-Hale',
      });
    });

    it('moves a student up a grade', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation());

      await save(`pco_${FIXTURE_IDS.amara}`, { grade: 9 });

      expect(h.store.personById(FIXTURE_IDS.amara)?.grade).toBe(9);
    });

    /**
     * The two halves of a name are separate boxes on the form and separate
     * attributes upstream, so neither has to be guessed at from the composite
     * the rest of Tally passes around.
     */
    it('sets and clears a nickname without touching the first name', async () => {
      const id = FIXTURE_IDS.benjiWithNickname;
      h.db.seed(`students/pco_${id}`, annotation());

      await save(`pco_${id}`, { nickname: null });
      expect(h.store.personById(id)).toMatchObject({ first_name: 'Benjamin', nickname: null });

      await save(`pco_${id}`, { nickname: 'Ben' });
      expect(h.store.personById(id)).toMatchObject({ first_name: 'Benjamin', nickname: 'Ben' });
    });

    it('sends nothing when the form matches what Planning Center holds', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation());
      const before = h.store.personById(FIXTURE_IDS.amara)?.updated_at;

      const result = await save(`pco_${FIXTURE_IDS.amara}`, {
        firstName: 'Amara',
        lastName: 'Okonkwo',
        grade: 8,
      });

      expect(result.status).toBe('unchanged');
      expect(result.wrote).toEqual([]);
      expect(h.store.personById(FIXTURE_IDS.amara)?.updated_at).toBe(before);
    });

    it('leaves every attribute the form did not speak to alone', async () => {
      const id = FIXTURE_IDS.sofiaWithAllergy;
      h.db.seed(`students/pco_${id}`, annotation());

      await save(`pco_${id}`, { lastName: 'Delgado-Ruiz' });

      expect(h.store.personById(id)).toMatchObject({
        last_name: 'Delgado-Ruiz',
        medical_notes: 'Severe peanut allergy — EpiPen in her bag',
        grade: 11,
      });
    });

    it('warns when the new grade drops them out of the band Tally reads', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation());

      const result = await save(`pco_${FIXTURE_IDS.amara}`, { grade: 6 }, 'full', {
        minGrade: 9,
        maxGrade: 12,
      });

      expect(result.status).toBe('updated');
      expect(result.message).toMatch(/drop off the roster/);
    });
  });

  describe('allergies', () => {
    it('writes them as medical notes', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation());

      const result = await save(`pco_${FIXTURE_IDS.amara}`, { allergies: 'Bee stings — carries an EpiPen' });

      expect(result.wrote).toEqual(['medical_notes']);
      expect(h.store.personById(FIXTURE_IDS.amara)?.medical_notes).toMatch(/Bee stings/);
    });

    /** A leader looking at the note they are deleting is allowed to delete it. */
    it('clears them when the box is emptied on purpose', async () => {
      const id = FIXTURE_IDS.sofiaWithAllergy;
      h.db.seed(`students/pco_${id}`, annotation());

      await save(`pco_${id}`, { allergies: null });

      expect(h.store.personById(id)?.medical_notes).toBeNull();
    });

    /**
     * The case that is not a deletion: a form that could not read the current
     * value omits the field entirely, and an omitted field is never a clear.
     */
    it('leaves a medical note alone when the edit omits it', async () => {
      const id = FIXTURE_IDS.sofiaWithAllergy;
      h.db.seed(`students/pco_${id}`, annotation());

      await save(`pco_${id}`, { firstName: 'Sofía' });

      expect(h.store.personById(id)?.medical_notes).toMatch(/peanut/);
    });
  });

  describe('refusals', () => {
    it('will not blank a name', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation());

      const result = await save(`pco_${FIXTURE_IDS.amara}`, { firstName: '   ' });

      expect(result.status).toBe('invalid');
      expect(h.store.personById(FIXTURE_IDS.amara)?.first_name).toBe('Amara');
    });

    it('will not write a grade Tally cannot represent', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation());

      const result = await save(`pco_${FIXTURE_IDS.amara}`, { grade: 13 });

      expect(result.status).toBe('invalid');
      expect(h.store.personById(FIXTURE_IDS.amara)?.grade).toBe(8);
    });

    it('refuses a student who is not upstream yet rather than creating one', async () => {
      const before = h.store.people.length;
      h.db.seed('students/s1', annotation({ pcoPersonId: null, pcoPushPending: true }));

      const result = await save('s1', { firstName: 'Nia', lastName: 'Fontaine' });

      expect(result.status).toBe('not-in-planning-center');
      expect(h.store.people).toHaveLength(before);
    });

    it('refuses an id nobody put on the roster', async () => {
      const result = await save(`pco_${FIXTURE_IDS.amara}`, { firstName: 'Amarachi' });

      expect(result.status).toBe('no-student');
      expect(h.store.personById(FIXTURE_IDS.amara)?.first_name).toBe('Amara');
    });

    it('refuses a student taken off the roster', async () => {
      h.db.seed(`students/pco_${FIXTURE_IDS.amara}`, annotation({ status: 'inactive' }));

      const result = await save(`pco_${FIXTURE_IDS.amara}`, { firstName: 'Amarachi' });

      expect(result.status).toBe('no-student');
      expect(h.store.personById(FIXTURE_IDS.amara)?.first_name).toBe('Amara');
    });
  });
});
