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
    const world = harness();
    await expect(
      fetchPersonDetails({ ...world, config: baseConfig(), personId: '999999999' }),
    ).rejects.toThrow();
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
});
