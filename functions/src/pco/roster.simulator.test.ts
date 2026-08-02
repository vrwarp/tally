/**
 * Reading people on demand, against a realistic Planning Center.
 *
 * These are the tests that replaced the sync suite. What used to matter was
 * "does the mirror converge"; what matters now is narrower and, honestly,
 * easier to be confident about: does a read return the right people, does it
 * leave the sensitive fields alone until somebody asks, and does it stop asking
 * twice for the same thing.
 *
 * The one property worth stating outright: nothing in this module touches
 * Firestore. There is no database double here because there is nothing to
 * double.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SIMULATOR_ORIGIN,
  SimulatorStore,
  createSimulatorFetch,
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  FIXTURE_IDS,
  type SimulatorOptions,
} from '../../../tools/pco-simulator/src/index.js';
import type { PcoConfig } from '../config.js';
import { createTtlCache, type TtlCache } from './cache.js';
import { createPcoClient, type PcoClient } from './client.js';
import {
  fetchParentContactStatus,
  fetchPersonDetails,
  fetchRoster,
  pcoStudentId,
  personIdFromStudentId,
  searchPeople,
} from './roster.js';

function baseConfig(overrides: Partial<PcoConfig> = {}): PcoConfig {
  return {
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    baseUrlOverridden: true,
    minGrade: 6,
    maxGrade: 12,
    writeBack: 'create',
    cacheTtlSeconds: 30,
    managedInApp: false,
    configError: null,
    ...overrides,
  };
}

interface Harness {
  client: PcoClient;
  store: SimulatorStore;
  cache: TtlCache;
  requests: string[];
}

function harness(options: SimulatorOptions = {}, ttlMs = 30_000): Harness {
  const store = new SimulatorStore(options);
  const requests: string[] = [];
  const simulator = createSimulatorFetch(store);

  const client = createPcoClient({
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    sleep: async () => {},
    fetchImpl: (input, init) => {
      requests.push(typeof input === 'string' ? input : String(input));
      return simulator(input, init);
    },
  });

  return { client, store, cache: createTtlCache({ ttlMs }), requests };
}

describe('student ids', () => {
  it('round-trips a Planning Center person id', () => {
    expect(pcoStudentId('4200001')).toBe('pco_4200001');
    expect(personIdFromStudentId('pco_4200001')).toBe('4200001');
  });

  it('reports a Tally-owned id as having no person behind it', () => {
    // A quick-added visitor exists only in Tally until the push lands. Treating
    // their id as a Planning Center id would send a lookup for a person who is
    // not there.
    expect(personIdFromStudentId('tally-abc123')).toBeNull();
  });
});

describe('fetchRoster', () => {
  let world: Harness;

  /** Everyone the fixture's youth pastor would have put on the roster. */
  const YOUTH_IDS = [
    FIXTURE_IDS.amara,
    FIXTURE_IDS.benjiWithNickname,
    FIXTURE_IDS.sofiaWithAllergy,
    FIXTURE_IDS.ivyNoGrade,
  ];

  beforeEach(() => {
    world = harness();
  });

  it('returns exactly the people Tally has on its roster', async () => {
    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: YOUTH_IDS,
    });

    expect(people.map((person) => person.pcoPersonId).sort()).toEqual([...YOUTH_IDS].sort());
  });

  it('does not second-guess the roster on grade', async () => {
    /*
     * The entire reason membership moved into Tally. A Planning Center List is
     * generated from filter rules, so the two cases a real youth pastor cares
     * about — the 5th grader who comes with an older sibling, the student
     * nobody ever gave a grade — could only be expressed by inventing a custom
     * field on every person in the church. Here they are just on the roster.
     */
    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.oliverFifthGrader, FIXTURE_IDS.ivyNoGrade],
    });

    expect(people.map((person) => person.pcoPersonId).sort()).toEqual(
      [FIXTURE_IDS.oliverFifthGrader, FIXTURE_IDS.ivyNoGrade].sort(),
    );
  });

  it('says whether the grade is real or the clamp talking', async () => {
    // The client shows a clamped 6 for a student upstream holds no grade for —
    // unless the document has one a human typed, which needs this flag to win.
    // A graduation year counts as a grade on file: the mapper derives it, and
    // deriving is not inventing. Genuinely gradeless is the thinned-create
    // shape — no grade *and* no graduation year.
    const gradeless = world.store.createPerson({ first_name: 'Nia', last_name: 'Fontaine' });

    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.oliverFifthGrader, FIXTURE_IDS.ivyNoGrade, gradeless.id],
    });

    const byId = new Map(people.map((person) => [person.pcoPersonId, person]));
    expect(byId.get(FIXTURE_IDS.oliverFifthGrader)?.gradeOnFile).toBe(true);
    expect(byId.get(FIXTURE_IDS.ivyNoGrade)?.gradeOnFile).toBe(true);
    expect(byId.get(gradeless.id)?.gradeOnFile).toBe(false);
  });

  it('reports somebody who is on the roster and no longer in Planning Center', async () => {
    // Deleted or merged upstream. Dropping them silently would mean a roster
    // that is quietly short by one, which is the failure nobody notices.
    const { people, unresolved } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.amara, '4209999'],
    });

    expect(people.map((person) => person.pcoPersonId)).toEqual([FIXTURE_IDS.amara]);
    expect(unresolved).toEqual(['4209999']);
  });

  it('answers an empty roster without asking Planning Center anything', async () => {
    const { people } = await fetchRoster({ ...world, config: baseConfig(), personIds: [] });

    expect(people).toEqual([]);
    expect(world.requests).toHaveLength(0);
  });

  it('carries no parent contact and no allergies', async () => {
    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: YOUTH_IDS,
    });

    for (const person of people) {
      expect(Object.keys(person)).not.toContain('parentPhone');
      expect(Object.keys(person)).not.toContain('allergies');
    }
  });

  it('reports *that* there is an allergy, so the badge can render', async () => {
    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.sofiaWithAllergy],
    });

    expect(people[0]?.hasAllergies).toBe(true);
  });

  it('carries a birthday as a day of the year, never as a date of birth', async () => {
    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: YOUTH_IDS,
    });

    for (const person of people) {
      // Either `MM-DD` or nothing. A four-digit year reaching a browser that
      // holds the whole roster is the thing this shape exists to prevent.
      if (person.birthday !== null) expect(person.birthday).toMatch(/^\d{2}-\d{2}$/);
    }
    expect(people.some((person) => person.birthday !== null)).toBe(true);
  });

  it('shows the name the way the Planning Center profile shows it', async () => {
    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.benjiWithNickname],
    });

    expect(people[0]?.firstName).toBe('Benjamin “Benji”');
  });

  it('keeps both halves of a name whose nickname is in another script', async () => {
    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.bensonWithScriptNickname],
    });

    expect(people[0]?.firstName).toBe('Benson “蔡秉洲”');
    // The search key carries both, so a counselor typing either one finds him.
    expect(people[0]?.searchName).toContain('benson');
    expect(people[0]?.searchName).toContain('蔡秉洲');
  });

  it('returns ids the rest of Tally can use as student ids', async () => {
    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.amara],
    });

    expect(people[0]?.id).toBe(pcoStudentId(FIXTURE_IDS.amara));
  });

  it('is sorted, so the roster does not reshuffle between reads', async () => {
    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: YOUTH_IDS,
    });

    const names = people.map((person) => person.searchName);
    expect(names).toEqual([...names].sort());
  });

  it('follows every page rather than stopping at the first', async () => {
    const small = harness({ pageSize: 3 });
    const { people } = await fetchRoster({
      ...small,
      config: baseConfig(),
      personIds: YOUTH_IDS,
    });

    expect(people).toHaveLength(YOUTH_IDS.length);
  });

  describe('caching', () => {
    it('asks Planning Center once for two readers inside the TTL', async () => {
      const config = baseConfig();
      const first = await fetchRoster({ ...world, config, personIds: YOUTH_IDS });
      const before = world.requests.length;
      const second = await fetchRoster({ ...world, config, personIds: YOUTH_IDS });

      expect(second.people).toEqual(first.people);
      expect(second.cached).toBe(true);
      expect(world.requests.length).toBe(before);
    });

    it('asks every time when the cache is turned off', async () => {
      const off = harness({}, 0);
      const config = baseConfig({ cacheTtlSeconds: 0 });

      await fetchRoster({ ...off, config, personIds: YOUTH_IDS });
      const before = off.requests.length;
      const second = await fetchRoster({ ...off, config, personIds: YOUTH_IDS });

      expect(second.cached).toBe(false);
      expect(off.requests.length).toBeGreaterThan(before);
      // The app still works — that is the point of 0 being a supported value.
      expect(second.people.length).toBeGreaterThan(0);
    });

    it('shows a student added a moment ago without waiting out the TTL', async () => {
      /*
       * Membership is Tally's, and it changes when somebody presses a button.
       * The cache key is the roster itself, so adding a student is a different
       * question rather than the same question with a stale answer.
       */
      const config = baseConfig();
      await fetchRoster({ ...world, config, personIds: [FIXTURE_IDS.amara] });

      const grown = await fetchRoster({
        ...world,
        config,
        personIds: [FIXTURE_IDS.amara, FIXTURE_IDS.sofiaWithAllergy],
      });

      expect(grown.cached).toBe(false);
      expect(grown.people).toHaveLength(2);
    });

    it('does not care what order the roster arrived in', async () => {
      const config = baseConfig();
      await fetchRoster({ ...world, config, personIds: YOUTH_IDS });
      const reordered = await fetchRoster({
        ...world,
        config,
        personIds: [...YOUTH_IDS].reverse(),
      });

      expect(reordered.cached).toBe(true);
    });

    it('does not serve one grade band from a read of another', async () => {
      await fetchRoster({ ...world, config: baseConfig(), personIds: YOUTH_IDS });
      const afterFull = world.requests.length;

      const narrow = await fetchRoster({
        ...world,
        config: baseConfig({ minGrade: 9, maxGrade: 12 }),
        personIds: YOUTH_IDS,
      });

      expect(narrow.cached).toBe(false);
      expect(world.requests.length).toBeGreaterThan(afterFull);
      expect(narrow.people.every((person) => person.grade >= 9)).toBe(true);
    });

    it('does not cache an outage', async () => {
      const config = baseConfig();
      world.store.scheduleFailure(500, 'Planning Center is having a minute', 10);

      await expect(fetchRoster({ ...world, config, personIds: YOUTH_IDS })).rejects.toThrow();

      world.store.reset();
      const recovered = await fetchRoster({ ...world, config, personIds: YOUTH_IDS });
      expect(recovered.people.length).toBeGreaterThan(0);
    });
  });
});

describe('searchPeople', () => {
  it('finds somebody to put on the roster by name', async () => {
    const world = harness();
    const results = await searchPeople({
      ...world,
      config: baseConfig(),
      query: 'Amara',
    });

    expect(results.map((person) => person.pcoPersonId)).toContain(FIXTURE_IDS.amara);
  });

  it('offers people the grade band would have excluded', async () => {
    // A search that pre-filtered on grade would hide exactly the students a
    // hand-picked roster exists to include.
    const world = harness();
    const results = await searchPeople({
      ...world,
      config: baseConfig(),
      query: 'Oliver',
    });

    expect(results.map((person) => person.pcoPersonId)).toContain(FIXTURE_IDS.oliverFifthGrader);
  });

  it('says whether Planning Center thinks somebody is a child', async () => {
    const world = harness();
    const results = await searchPeople({ ...world, config: baseConfig(), query: 'Amara' });

    expect(results.find((person) => person.pcoPersonId === FIXTURE_IDS.amara)?.child).toBe(true);
  });

  it('reports the grade Planning Center holds, not the bottom of the band', async () => {
    // Every adult in the church has a blank grade. Flooring that to `minGrade`
    // put "6th" under a parent's name and read as something Planning Center had
    // said.
    const world = harness();
    const results = await searchPeople({ ...world, config: baseConfig(), query: 'Chidi' });

    expect(results.find((person) => person.pcoPersonId === '5200001')?.grade).toBeNull();
  });

  it('reports a grade below the band as the grade it is', async () => {
    const world = harness();
    const results = await searchPeople({ ...world, config: baseConfig(), query: 'Oliver' });

    expect(results.find((person) => person.pcoPersonId === FIXTURE_IDS.oliverFifthGrader)?.grade).toBe(5);
  });

  it('finds a student by the first name Planning Center hides behind a nickname', async () => {
    const world = harness();
    const results = await searchPeople({ ...world, config: baseConfig(), query: 'Benson Tsai' });

    const found = results.find(
      (person) => person.pcoPersonId === FIXTURE_IDS.bensonWithScriptNickname,
    );
    // The row has to name him the way the profile does, or the search that found
    // him and the result that came back look like two different people.
    expect(found?.firstName).toBe('Benson “蔡秉洲”');
  });

  it('answers an empty query without asking', async () => {
    const world = harness();
    const results = await searchPeople({ ...world, config: baseConfig(), query: '   ' });

    expect(results).toEqual([]);
    expect(world.requests).toHaveLength(0);
  });
});

/*
 * The dashboard's "incomplete profiles" list, which for a ministry whose roster
 * comes from Planning Center was empty for as long as it took anybody to notice
 * — the roster reports `profileComplete: null` for everyone, and a list that
 * only accepts `false` finds nothing in a page full of nulls. Meanwhile the
 * follow-up rows above it, which read one student at a time, were saying
 * "Planning Center has no parent contact for this student" out loud.
 */
describe('fetchParentContactStatus', () => {
  const ROSTER = [
    FIXTURE_IDS.amara,
    FIXTURE_IDS.marcusNoAdultAtHome,
    FIXTURE_IDS.ivyNoGrade,
    FIXTURE_IDS.tobiasEmailOnlyParent,
    FIXTURE_IDS.leilaPhoneOnlyParent,
    FIXTURE_IDS.dexterGrandparent,
  ];

  it('names the students nobody can be reached about', async () => {
    const world = harness();
    const { reachable } = await fetchParentContactStatus({
      ...world,
      config: baseConfig(),
      personIds: ROSTER,
    });

    // A household with no adult in it, and a student in no household at all.
    expect(reachable[pcoStudentId(FIXTURE_IDS.marcusNoAdultAtHome)]).toBe(false);
    expect(reachable[pcoStudentId(FIXTURE_IDS.ivyNoGrade)]).toBe(false);
  });

  it('counts a parent with only an email, and one with only a phone', async () => {
    // Either is enough to follow up on, which is what `computeProfileComplete`
    // has always said and what this must not quietly disagree with.
    const world = harness();
    const { reachable } = await fetchParentContactStatus({
      ...world,
      config: baseConfig(),
      personIds: ROSTER,
    });

    expect(reachable[pcoStudentId(FIXTURE_IDS.tobiasEmailOnlyParent)]).toBe(true);
    expect(reachable[pcoStudentId(FIXTURE_IDS.leilaPhoneOnlyParent)]).toBe(true);
    // The grandparent Dexter lives with counts too: an adult in the household
    // with a phone number is somebody to call.
    expect(reachable[pcoStudentId(FIXTURE_IDS.dexterGrandparent)]).toBe(true);
  });

  it('agrees with the detail read, one student at a time', async () => {
    /*
     * The two answers are produced completely differently — a sweep of the
     * church's adults here, a household-by-household read there — and a leader
     * sees them side by side on the same screen. If they can disagree, one of
     * them is lying to somebody working a call list.
     */
    const world = harness();
    const { reachable } = await fetchParentContactStatus({
      ...world,
      config: baseConfig(),
      personIds: ROSTER,
    });

    for (const personId of ROSTER) {
      const details = await fetchPersonDetails({ ...world, config: baseConfig(), personId });
      const hasContact = Boolean(details?.parentPhone ?? details?.parentEmail);
      expect(reachable[pcoStudentId(personId)], `disagreed about ${personId}`).toBe(hasContact);
    }
  });

  it('says nothing at all about a student Planning Center could not resolve', async () => {
    // Absent from the map, not `false`. "We could not look" is not "nobody is
    // there", and putting a deleted-upstream student on a call list as
    // unreachable sends somebody to fix the wrong thing.
    const world = harness();
    const { reachable, unresolved } = await fetchParentContactStatus({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.amara, '4209999'],
    });

    expect(unresolved).toEqual(['4209999']);
    expect(reachable).not.toHaveProperty(pcoStudentId('4209999'));
  });

  it('carries no contact details, only the fact that there are some', async () => {
    const world = harness();
    const status = await fetchParentContactStatus({
      ...world,
      config: baseConfig(),
      personIds: ROSTER,
    });

    // The whole list is students with nobody to ring, so there is nothing to
    // send — and the students who *do* have a parent must not have that
    // parent's phone number shipped to a browser to prove it.
    expect(JSON.stringify(status)).not.toMatch(/555|@example\.org/);
  });

  it('reuses the roster read it shares with the check-in screen', async () => {
    const world = harness();
    const config = baseConfig();

    await fetchRoster({ ...world, config, personIds: ROSTER });
    const afterRoster = world.requests.length;
    await fetchParentContactStatus({ ...world, config, personIds: ROSTER });
    const afterStatus = world.requests.length;

    // The adult sweep is new work; asking who is on the roster again is not.
    expect(afterStatus).toBeGreaterThan(afterRoster);

    const second = await fetchParentContactStatus({ ...world, config, personIds: ROSTER });
    expect(second.cached).toBe(true);
    expect(world.requests.length).toBe(afterStatus);
  });
});

describe('fetchPersonDetails', () => {
  it('returns the fields the roster deliberately withheld', async () => {
    const world = harness();
    const details = await fetchPersonDetails({
      ...world,
      config: baseConfig(),
      personId: FIXTURE_IDS.sofiaWithAllergy,
    });

    expect(details?.allergies).toBeTruthy();
    expect(details?.parentPhone ?? details?.parentEmail).toBeTruthy();
  });

  it('finds the parent in a household rather than the other child', async () => {
    const world = harness();
    const details = await fetchPersonDetails({
      ...world,
      config: baseConfig(),
      personId: FIXTURE_IDS.amara,
    });

    expect(details?.parentName).toBeTruthy();
  });

  it('returns null for somebody who is not there', async () => {
    // What the name always promised. It used to reject instead — the 404
    // escaped — and the detail screen for a deleted student wore a generic
    // failure rather than saying the student is gone.
    const world = harness();
    const details = await fetchPersonDetails({
      ...world,
      config: baseConfig(),
      personId: '999999999',
    });
    expect(details).toBeNull();
  });

  it('is cached per person, not per roster', async () => {
    const world = harness();
    const config = baseConfig();

    await fetchPersonDetails({ ...world, config, personId: FIXTURE_IDS.amara });
    const before = world.requests.length;
    await fetchPersonDetails({ ...world, config, personId: FIXTURE_IDS.amara });
    expect(world.requests.length).toBe(before);

    await fetchPersonDetails({ ...world, config, personId: FIXTURE_IDS.sofiaWithAllergy });
    expect(world.requests.length).toBeGreaterThan(before);
  });

  /**
   * The read a screen makes immediately after writing.
   *
   * This is the difference between "we added the parent" and a screen that goes
   * on saying nobody can be reached: the write happens, the page re-reads inside
   * the retention window, and a held answer describes the family as it was
   * before. `force` is the only thing that reaches a cache on whichever
   * instance the re-read lands on.
   */
  it('goes back to Planning Center when a write asks it to', async () => {
    const world = harness();
    const config = baseConfig();

    await fetchPersonDetails({ ...world, config, personId: FIXTURE_IDS.amara });
    const cached = world.requests.length;

    await fetchPersonDetails({ ...world, config, personId: FIXTURE_IDS.amara, force: true });
    expect(world.requests.length).toBeGreaterThan(cached);
  });
});
