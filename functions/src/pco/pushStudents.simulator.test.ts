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

function harness(options: { createDiscards?: readonly string[] } = {}): Harness {
  const store = new SimulatorStore({ pageSize: 50, ...options });
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
    upstreamPushPending: true,
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
      expect(stored.upstreamPushPending).toBe(false);
    });

    it('sends allergies through as medical notes', async () => {
      h.db.seed('students/s1', tallyOnlyStudent({ allergies: 'Bee stings — carries an EpiPen' }));

      const result = await push('s1', 'create');

      expect(h.store.personById(result.pcoPersonId!)?.medical_notes).toMatch(/Bee stings/);
    });

    /**
     * Planning Center was measured answering a create with `201` and a person
     * missing the `child` flag and the grade it was sent — a student filed as
     * a grade-less adult in the church's permanent database. The `201` body is
     * a report, not a receipt: whatever it dropped goes straight back as a
     * patch, which the same API demonstrably honours.
     */
    it('re-sends whatever the create silently kept back', async () => {
      h = harness({ createDiscards: ['child', 'grade'] });
      h.db.seed('students/s1', tallyOnlyStudent());

      const result = await push('s1', 'create');

      expect(result.status).toBe('created');
      expect(h.store.personById(result.pcoPersonId!)).toMatchObject({ child: true, grade: 9 });
      const repair = h.store.requestLog.filter(
        (entry) => entry.method === 'PATCH' && entry.path === `/people/${result.pcoPersonId}`,
      );
      expect(repair).toHaveLength(1);
    });

    it('does not patch after a create that kept everything', async () => {
      h.db.seed('students/s1', tallyOnlyStudent());

      const result = await push('s1', 'create');

      expect(result.status).toBe('created');
      expect(h.store.requestLog.some((entry) => entry.method === 'PATCH')).toBe(false);
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

    /**
     * Tally holds Planning Center's display name. Sending it back whole would
     * make the church's copy read `Benson “蔡秉洲” “蔡秉洲” Tsai`, and the next
     * match attempt would fail against a name Tally itself wrote.
     */
    it('splits a display name back into first_name and nickname', async () => {
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({
          firstName: 'Benson “蔡秉洲”',
          lastName: 'Wu',
          grade: 7,
          searchName: 'benson “蔡秉洲” wu',
        }),
      );

      const result = await push('s1', 'create');

      expect(h.store.personById(result.pcoPersonId!)).toMatchObject({
        first_name: 'Benson',
        nickname: '蔡秉洲',
        last_name: 'Wu',
      });
    });

    it('links a display name to the person Planning Center already holds', async () => {
      const before = h.store.people.length;
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({
          firstName: 'Benson “蔡秉洲”',
          lastName: 'Tsai',
          grade: 6,
          searchName: 'benson “蔡秉洲” tsai',
        }),
      );

      const result = await push('s1', 'create');

      expect(result.pcoPersonId).toBe(FIXTURE_IDS.bensonWithScriptNickname);
      expect(h.store.people).toHaveLength(before);
    });

    it('leaves an already-linked student alone', async () => {
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({ pcoPersonId: FIXTURE_IDS.amara, upstreamPushPending: false }),
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
      expect(h.db.get('students/s1')?.upstreamPushPending).toBe(true);
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
          upstreamPushPending: false,
        }),
      );
      expect(h.store.personById(FIXTURE_IDS.amara)?.grade).toBe(8);

      const result = await push('s1', 'full');

      expect(result.status).toBe('updated');
      expect(h.store.personById(FIXTURE_IDS.amara)?.grade).toBe(9);
    });

    it('restores the grade and child flag a thinned create left behind', async () => {
      // The shape an unrepaired create leaves in the church's database: a
      // grade-less adult. The reconcile push heals both fields together.
      const person = h.store.createPerson({ first_name: 'Nia', last_name: 'Fontaine' });
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({ pcoPersonId: person.id, upstreamPushPending: false, grade: 9 }),
      );

      const result = await push('s1', 'full');

      expect(result.status).toBe('updated');
      expect(h.store.personById(person.id)).toMatchObject({ grade: 9, child: true });
    });

    it('leaves a promoted adult alone when a grade is on file', async () => {
      // `child: false` next to a real grade may be Planning Center's own
      // child-to-adult promotion of a graduated senior. Not Tally's to undo.
      const person = h.store.createPerson({
        first_name: 'Nia',
        last_name: 'Fontaine',
        grade: 12,
        child: false,
      });
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({ pcoPersonId: person.id, upstreamPushPending: false, grade: 12 }),
      );

      const result = await push('s1', 'full');

      expect(result.status).toBe('skipped');
      expect(h.store.personById(person.id)?.child).toBe(false);
    });

    it('does not rewrite a name that only looks different because of the nickname', async () => {
      // Tally holds `Benjamin “Benji”`, Planning Center holds the two halves.
      // They agree; a patch here would be Tally fighting itself every sync.
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({
          firstName: 'Benjamin “Benji”',
          lastName: 'Okonkwo',
          grade: 6,
          pcoPersonId: FIXTURE_IDS.benjiWithNickname,
          upstreamPushPending: false,
        }),
      );

      const result = await push('s1', 'full');

      expect(result.status).toBe('skipped');
      expect(h.store.personById(FIXTURE_IDS.benjiWithNickname)).toMatchObject({
        first_name: 'Benjamin',
        nickname: 'Benji',
      });
    });

    it('patches both halves when the name really did change', async () => {
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({
          firstName: 'Benjamin “Ben”',
          lastName: 'Okonkwo',
          grade: 6,
          pcoPersonId: FIXTURE_IDS.benjiWithNickname,
          upstreamPushPending: false,
        }),
      );

      const result = await push('s1', 'full');

      expect(result.status).toBe('updated');
      expect(h.store.personById(FIXTURE_IDS.benjiWithNickname)).toMatchObject({
        first_name: 'Benjamin',
        nickname: 'Ben',
      });
    });

    /**
     * The one that would have been a phone call from a parent.
     *
     * A linked student's document carries no allergy note — Tally has kept no
     * copy of one since the mirror was removed — and reading that absence as
     * "there are none" sent `medical_notes: ''` and deleted a real allergy from
     * the church's database on the first reconcile.
     */
    it('never clears a medical note Tally does not hold a copy of', async () => {
      const { allergies: _dropped, ...withoutAllergies } = tallyOnlyStudent({
        firstName: 'Sofia',
        lastName: 'Delgado',
        grade: 11,
        pcoPersonId: FIXTURE_IDS.sofiaWithAllergy,
        upstreamPushPending: false,
      });
      h.db.seed('students/s1', withoutAllergies);

      const result = await push('s1', 'full');

      expect(result.status).toBe('skipped');
      expect(h.store.personById(FIXTURE_IDS.sofiaWithAllergy)?.medical_notes).toMatch(/peanut/);
    });

    it('still sends an allergy a counselor typed at the door', async () => {
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({
          firstName: 'Amara',
          lastName: 'Okonkwo',
          grade: 8,
          allergies: 'Bee stings — carries an EpiPen',
          pcoPersonId: FIXTURE_IDS.amara,
          upstreamPushPending: false,
        }),
      );

      const result = await push('s1', 'full');

      expect(result.status).toBe('updated');
      expect(h.store.personById(FIXTURE_IDS.amara)?.medical_notes).toMatch(/Bee stings/);
    });

    it('does nothing when Planning Center already agrees', async () => {
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({
          firstName: 'Amara',
          lastName: 'Okonkwo',
          grade: 8,
          pcoPersonId: FIXTURE_IDS.amara,
          upstreamPushPending: false,
        }),
      );

      const result = await push('s1', 'full');

      expect(result.status).toBe('skipped');
      expect(h.store.requestLog.some((entry) => entry.method === 'PATCH')).toBe(false);
    });
  });

  /**
   * A membership document holding no grade at all.
   *
   * That is what Tally writes for somebody Planning Center holds no grade for —
   * the adults a hand-picked roster carries. The number on their roster row is
   * where the sync's clamp landed, so nothing writes it down, and this side has
   * to read the absence as an absence. It used to read `data.grade ?? 0`.
   */
  describe('a student document with no grade', () => {
    it('patches nothing about the grade of a linked person', async () => {
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({
          firstName: 'Amara',
          lastName: 'Okonkwo',
          grade: undefined,
          pcoPersonId: FIXTURE_IDS.amara,
          upstreamPushPending: false,
        }),
      );
      const held = h.store.personById(FIXTURE_IDS.amara)?.grade;

      const result = await push('s1', 'full');

      expect(result.status).toBe('skipped');
      expect(h.store.personById(FIXTURE_IDS.amara)?.grade).toBe(held);
    });

    it('creates a grade-less child rather than sending a grade nobody supplied', async () => {
      // A nursery child has no grade to type at quick-add. This used to be
      // refused outright, which left them queued on `upstreamPushPending` for ever.
      h.db.seed('students/s1', tallyOnlyStudent({ grade: undefined }));

      const result = await push('s1', 'create');

      expect(result.status).toBe('created');
      const created = h.store.personById(result.pcoPersonId!);
      // Absent, not zero: a grade nobody supplied is a claim about a real child
      // and it is the church's database that keeps it. `child` still goes, so
      // they land in the children's views rather than the adult directory.
      expect(created?.grade ?? null).toBeNull();
      expect(created?.child).toBe(true);
    });

    /**
     * The one thing name-only matching must not do.
     *
     * The grade-less population upstream is two groups at once: children too
     * young for a grade, and every adult volunteer. Collapsing a three-year-old
     * onto the volunteer who shares their name would file the child as that
     * adult, silently, in the church's permanent database.
     */
    it('will not match a grade-less child onto a same-named adult', async () => {
      const adult = h.store.createPerson({
        first_name: 'Nia',
        last_name: 'Fontaine',
        child: false,
      });
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({ firstName: 'Nia', lastName: 'Fontaine', grade: undefined }),
      );

      const result = await push('s1', 'create');

      expect(result.status).toBe('created');
      expect(result.pcoPersonId).not.toBe(adult.id);
    });

    it('does match a grade-less child onto a same-named grade-less child', async () => {
      // The other half of the pair above: without this, the adult test would
      // pass simply because nothing ever matches when the grade is absent.
      const child = h.store.createPerson({
        first_name: 'Nia',
        last_name: 'Fontaine',
        child: true,
      });
      h.db.seed(
        'students/s1',
        tallyOnlyStudent({ firstName: 'Nia', lastName: 'Fontaine', grade: undefined }),
      );

      const result = await push('s1', 'create');

      expect(result.status).toBe('updated');
      expect(result.pcoPersonId).toBe(child.id);
    });
  });

  describe('pushPendingStudents', () => {
    it('catches up everything the immediate push missed', async () => {
      h.db.seed('students/s1', tallyOnlyStudent({ firstName: 'Nia', searchName: 'nia fontaine' }));
      h.db.seed('students/s2', tallyOnlyStudent({ firstName: 'Theo', searchName: 'theo fontaine' }));
      h.db.seed('students/s3', tallyOnlyStudent({ pcoPersonId: 'X', upstreamPushPending: false }));

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
