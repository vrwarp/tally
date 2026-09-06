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
import {
  addParent,
  createFamily,
  findAdultCandidates,
  type AddParentOptions,
} from './household.js';

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
  return { notes: null, status: 'active', upstreamPushPending: false, ...overrides };
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
      expect(details?.contactName).toBe('Dana Whitfield');
      expect(details?.contactPhone).toMatch(/0142/);
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
      expect(details?.contactEmail).toBe('dana.whitfield@example.com');
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
      expect(details?.contactName).toBe('Ruth Fontaine');
      expect(details?.contactPhone).toMatch(/0188/);
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
      expect(details?.contactName).toBe('Rosa Delgado');
    });

    it('creates a new person anyway when told the match is somebody else', async () => {
      const before = h.store.people.length;

      const result = await add({ firstName: 'Rosa', lastName: 'Delgado', createNew: true });

      expect(result.status).toBe('added');
      expect(result.createdPerson).toBe(true);
      expect(h.store.people).toHaveLength(before + 1);
    });

    /**
     * The toast is read next to the screen it just changed. Saying "no contact
     * details yet" about an adult the church has always been able to ring — and
     * whose Call button is now right above the toast — reads as a failure.
     */
    it('says the parent is already reachable rather than that nobody is', async () => {
      const rosa = h.store.people.find(
        (person) => person.first_name === 'Rosa' && person.last_name === 'Delgado',
      )!;

      const result = await add({ personId: rosa.id });

      expect(result.status).toBe('added');
      expect(result.wrote).toEqual([]);
      expect(result.message).toMatch(/already has a way to reach/);
      expect(result.message).not.toMatch(/no contact details/);
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
      expect(result.contactName).toBeTruthy();
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
      h.db.seed('students/s1', annotation({ pcoPersonId: null, upstreamPushPending: true }));

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

/* -------------------------------------------------------------------------- */
/* createFamily — a household nobody has met, and one that already exists      */
/* -------------------------------------------------------------------------- */

describe('createFamily against the simulator', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  const build = (patch: {
    studentIds: string[];
    anchorStudentIds?: string[];
    firstName?: string;
    lastName?: string;
    parentPersonId?: string;
    createNewParent?: boolean;
    phone?: string;
  }) =>
    createFamily({
      db: h.db,
      client: h.client,
      config: config('full'),
      firstName: 'Dana',
      lastName: 'Whitfield',
      ...patch,
    });

  it('puts every sibling in one household, not one household each', async () => {
    // Two children Tally pushed a moment ago: linked upstream, in no household.
    const first = h.store.createPerson({ first_name: 'Robin', last_name: 'Fields', child: true });
    const second = h.store.createPerson({ first_name: 'Sam', last_name: 'Fields', child: true });
    h.db.seed('students/t-1', annotation({ pcoPersonId: first.id }));
    h.db.seed('students/t-2', annotation({ pcoPersonId: second.id }));

    const result = await build({ studentIds: ['t-1', 't-2'] });

    expect(result.status).toBe('created');
    const households = h.store.householdsForPerson(first.id);
    expect(households).toHaveLength(1);
    expect(h.store.householdsForPerson(second.id).map((household) => household.id)).toEqual(
      households.map((household) => household.id),
    );
    // Both children and the adult.
    expect(h.store.membershipsForHousehold(households[0]!.id)).toHaveLength(3);
  });

  /*
   * The bug this exists to keep fixed.
   *
   * A parent whose second child is finally old enough used to get a *second*
   * household: the household was derived from the children in the run, every
   * one of which had been created seconds earlier and had none — so the answer
   * was always "none", and the answer to that was always "create one". The
   * siblings stayed behind in the first household, invisible from the new one,
   * on a record with no undo.
   */
  it('joins the household a sibling is already in rather than founding a second', async () => {
    const anchorHousehold = h.store.householdsForPerson(FIXTURE_IDS.leilaPhoneOnlyParent)[0]!;
    const newChild = h.store.createPerson({ first_name: 'Ada', last_name: 'Fields', child: true });
    h.db.seed(`students/pco_${FIXTURE_IDS.leilaPhoneOnlyParent}`, annotation());
    h.db.seed('students/t-new', annotation({ pcoPersonId: newChild.id }));

    const before = h.store.householdCount;
    const result = await build({
      studentIds: ['t-new'],
      anchorStudentIds: [`pco_${FIXTURE_IDS.leilaPhoneOnlyParent}`],
    });

    // The sibling's household already has an adult, so nothing is created at
    // all — not a person, not a household. The child is simply filed into it.
    expect(result.status).toBe('already-has-family');
    expect(h.store.householdCount).toBe(before);
    expect(h.store.householdsForPerson(newChild.id).map((household) => household.id)).toEqual([
      anchorHousehold.id,
    ]);
  });

  it('uses the sibling’s household even when it has no adult in it yet', async () => {
    const anchorHousehold = h.store.householdsForPerson(MARCUS)[0]!;
    const newChild = h.store.createPerson({ first_name: 'Ada', last_name: 'Fields', child: true });
    h.db.seed(`students/${MARCUS_STUDENT}`, annotation());
    h.db.seed('students/t-new', annotation({ pcoPersonId: newChild.id }));

    const before = h.store.householdCount;
    const result = await build({
      studentIds: ['t-new'],
      anchorStudentIds: [MARCUS_STUDENT],
      phone: '(510) 555-0142',
    });

    // Marcus's household is the family's; the adult joins it and so does Ada.
    expect(result.status).toBe('created');
    expect(h.store.householdCount).toBe(before);
    expect(h.store.householdsForPerson(newChild.id).map((household) => household.id)).toEqual([
      anchorHousehold.id,
    ]);
  });

  it('ignores an anchor that names nobody Planning Center has', async () => {
    const newChild = h.store.createPerson({ first_name: 'Ada', last_name: 'Fields', child: true });
    h.db.seed('students/t-new', annotation({ pcoPersonId: newChild.id }));

    const result = await build({ studentIds: ['t-new'], anchorStudentIds: ['t-ghost'] });
    expect(result.status).toBe('created');
    expect(h.store.householdsForPerson(newChild.id)).toHaveLength(1);
  });

  /*
   * The bug a real church database showed, reproduced end to end.
   *
   * One family registered at the kiosk twice on the same night, same phone
   * number, one child each time. Approved one card at a time, the *parent* was
   * correctly deduplicated — name plus a matching number is the same human —
   * and then a second household was built around them anyway, because the only
   * households consulted belonged to children created seconds earlier. What
   * Planning Center held afterwards was one adult as `primary_contact` of two
   * households named `Person Household`, one sibling stranded in each, and no
   * merge for households to undo it with.
   */
  it('puts a second registration in the household the first one built', async () => {
    const first = h.store.createPerson({ first_name: 'Robin', last_name: 'Fields', child: true });
    h.db.seed('students/t-1', annotation({ pcoPersonId: first.id }));
    const one = await build({ studentIds: ['t-1'], phone: '(510) 555-0142' });
    expect(one.status).toBe('created');

    // The second visit: a new child, pushed a moment ago, in no household.
    const second = h.store.createPerson({ first_name: 'Sam', last_name: 'Fields', child: true });
    h.db.seed('students/t-2', annotation({ pcoPersonId: second.id }));
    const before = h.store.householdCount;

    const two = await build({ studentIds: ['t-2'], phone: '(510) 555-0142' });

    // The same adult, and — the part that was broken — the same household.
    expect(two.status).toBe('joined');
    expect(two.parentPersonId).toBe(one.parentPersonId);
    expect(two.createdHousehold).toBe(false);
    expect(h.store.householdCount).toBe(before);
    expect(h.store.householdsForPerson(one.parentPersonId!)).toHaveLength(1);
    expect(h.store.householdsForPerson(second.id).map((household) => household.id)).toEqual(
      h.store.householdsForPerson(first.id).map((household) => household.id),
    );
    // The parent, both children, and no second membership for the parent.
    const household = h.store.householdsForPerson(one.parentPersonId!)[0]!;
    expect(h.store.membershipsForHousehold(household.id)).toHaveLength(3);
  });

  /* ---- What a reviewer settles, rather than what the lobby guesses -------- */

  it('uses the adult a reviewer named, without corroborating anything', async () => {
    /*
     * The case no phone matching reaches: the mother is on file under the
     * number she had last year, so the family types one the church has never
     * seen. Left to itself this creates a second Dana Whitfield; a reviewer
     * looking at the candidates can say which one she is.
     */
    const dana = h.store.createPerson({
      first_name: 'Dana',
      last_name: 'Whitfield',
      child: false,
    });
    h.store.addPhone(dana.id, '(510) 555-0142');
    const child = h.store.createPerson({ first_name: 'Ada', last_name: 'Fields', child: true });
    h.db.seed('students/t-new', annotation({ pcoPersonId: child.id }));
    const before = h.store.people.length;
    const phonesBefore = h.store.phonesFor(dana.id).length;

    const result = await build({
      studentIds: ['t-new'],
      parentPersonId: dana.id,
      phone: '(510) 555-9999',
    });

    expect(result.status).toBe('joined');
    expect(result.parentPersonId).toBe(dana.id);
    expect(result.createdPerson).toBe(false);
    expect(h.store.people).toHaveLength(before);
    expect(h.store.householdsForPerson(child.id)).toHaveLength(1);
    // The chosen adult's own record is read with their contacts, so the new
    // number is reported as skipped rather than added beside the one on file.
    expect(result.skipped).toEqual(['phone']);
    expect(h.store.phonesFor(dana.id)).toHaveLength(phonesBefore);
  });

  it('reports a chosen adult Planning Center no longer has, rather than inventing one', async () => {
    const child = h.store.createPerson({ first_name: 'Ada', last_name: 'Fields', child: true });
    h.db.seed('students/t-new', annotation({ pcoPersonId: child.id }));
    const before = h.store.people.length;

    const result = await build({ studentIds: ['t-new'], parentPersonId: '99999999' });

    // Not a quiet fallback to creating somebody: the reviewer said *that*
    // person, and a different adult of the same name is not a smaller version
    // of doing what they asked.
    expect(result.status).toBe('parent-not-found');
    expect(h.store.people).toHaveLength(before);
    expect(h.store.householdsForPerson(child.id)).toHaveLength(0);
  });

  it('refuses a chosen "adult" who is a child', async () => {
    const child = h.store.createPerson({ first_name: 'Ada', last_name: 'Fields', child: true });
    h.db.seed('students/t-new', annotation({ pcoPersonId: child.id }));

    const result = await build({ studentIds: ['t-new'], parentPersonId: MARCUS });
    expect(result.status).toBe('parent-not-found');
  });

  it('creates a fresh adult when a reviewer says none of the candidates is them', async () => {
    // Corroboration would have joined this one — same name, same number — and
    // `createNewParent` is a person overruling exactly that.
    const twin = h.store.createPerson({ first_name: 'Dana', last_name: 'Whitfield', child: false });
    h.store.addPhone(twin.id, '(510) 555-0142');
    const child = h.store.createPerson({ first_name: 'Ada', last_name: 'Fields', child: true });
    h.db.seed('students/t-new', annotation({ pcoPersonId: child.id }));

    const result = await build({
      studentIds: ['t-new'],
      createNewParent: true,
      phone: '(510) 555-0142',
    });

    expect(result.status).toBe('created');
    expect(result.parentPersonId).not.toBe(twin.id);
  });
});

/* -------------------------------------------------------------------------- */
/* findAdultCandidates — the read a reviewer decides from                      */
/* -------------------------------------------------------------------------- */

describe('findAdultCandidates against the simulator', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  it('carries the phone evidence without acting on it', async () => {
    const matching = h.store.createPerson({ first_name: 'Dana', last_name: 'Whitfield', child: false });
    h.store.addPhone(matching.id, '(510) 555-0142');
    const namesake = h.store.createPerson({ first_name: 'Dana', last_name: 'Whitfield', child: false });

    const candidates = await findAdultCandidates({
      client: h.client,
      firstName: 'Dana',
      lastName: 'Whitfield',
      phone: '510-555-0142',
    });

    expect(candidates.map((candidate) => candidate.personId)).toEqual(
      expect.arrayContaining([matching.id, namesake.id]),
    );
    expect(candidates.find((c) => c.personId === matching.id)?.corroborated).toBe(true);
    expect(candidates.find((c) => c.personId === namesake.id)?.corroborated).toBe(false);
    expect(candidates.find((c) => c.personId === namesake.id)?.reachable).toBe(false);
  });

  it('never offers a child as somebody’s parent', async () => {
    // The screenshot's confusion: a child who shares the guardian's whole name.
    // Planning Center answers this with the flag; the search asks for it both
    // server-side and again locally.
    h.store.createPerson({ first_name: 'Test', last_name: 'Person', child: true });
    const parent = h.store.createPerson({ first_name: 'Test', last_name: 'Person', child: false });

    const candidates = await findAdultCandidates({
      client: h.client,
      firstName: 'Test',
      lastName: 'Person',
    });

    expect(candidates.map((candidate) => candidate.personId)).toEqual([parent.id]);
  });

  it('leaves out the family’s own children', async () => {
    const parent = h.store.createPerson({ first_name: 'Test', last_name: 'Person', child: false });
    const candidates = await findAdultCandidates({
      client: h.client,
      firstName: 'Test',
      lastName: 'Person',
      excludePersonIds: [parent.id],
    });
    expect(candidates).toEqual([]);
  });

  it('says nothing about households for an adult who heads one', async () => {
    const parent = h.store.createPerson({ first_name: 'Solo', last_name: 'Parent', child: false });
    const child = h.store.createPerson({ first_name: 'Kid', last_name: 'Parent', child: true });
    h.store.createHousehold({
      attributes: { name: 'Parent Household', primary_contact_id: parent.id },
      memberIds: [parent.id, child.id],
    });

    const [candidate] = await findAdultCandidates({
      client: h.client,
      firstName: 'Solo',
      lastName: 'Parent',
    });

    /*
     * Undefined rather than a one-entry list, and the distinction is the whole
     * cost model: below the threshold the members are never fetched, because a
     * picker with one option is not a question anybody needs asked.
     */
    expect(candidate?.households).toBeUndefined();
  });

  it('names both families, and their members, for an adult who heads two', async () => {
    const parent = h.store.createPerson({ first_name: 'Twice', last_name: 'Over', child: false });
    const first = h.store.createPerson({ first_name: 'Ada', last_name: 'Over', child: true });
    const second = h.store.createPerson({ first_name: 'Bo', last_name: 'Over', child: true });
    h.store.createHousehold({
      attributes: { name: 'Over Household', primary_contact_id: parent.id },
      memberIds: [parent.id, first.id],
    });
    h.store.createHousehold({
      attributes: { name: 'Over Household', primary_contact_id: parent.id },
      memberIds: [parent.id, second.id],
    });

    const [candidate] = await findAdultCandidates({
      client: h.client,
      firstName: 'Twice',
      lastName: 'Over',
    });

    expect(candidate?.households).toHaveLength(2);
    /*
     * Planning Center calls both of them `Over Household`, which is exactly why
     * the members are fetched: the name alone leaves a reviewer choosing at
     * random between two identical labels.
     */
    expect(candidate?.households?.map((household) => household.name)).toEqual([
      'Over Household',
      'Over Household',
    ]);
    expect(candidate?.households?.flatMap((household) => household.memberNames)).toEqual(
      expect.arrayContaining(['Ada Over', 'Bo Over']),
    );
  });
});
