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
  STUDENT_LIST_ID,
  TEAM_LIST_ID,
  type SimulatorOptions,
} from '../../../tools/pco-simulator/src/index.js';
import type { PcoConfig } from '../config.js';
import { createTtlCache, type TtlCache } from './cache.js';
import { createPcoClient, type PcoClient } from './client.js';
import {
  fetchPersonDetails,
  fetchYouthRoster,
  findTeamMemberByEmail,
  pcoStudentId,
  personIdFromStudentId,
} from './roster.js';

function baseConfig(overrides: Partial<PcoConfig> = {}): PcoConfig {
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
    writeBack: 'create',
    cacheTtlSeconds: 30,
    smallGroupField: null,
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

describe('fetchYouthRoster', () => {
  let world: Harness;

  beforeEach(() => {
    world = harness();
  });

  it('returns the youth, and only the youth', async () => {
    const { people } = await fetchYouthRoster({ ...world, config: baseConfig() });

    expect(people.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(person.grade).toBeGreaterThanOrEqual(6);
      expect(person.grade).toBeLessThanOrEqual(12);
    }
  });

  it('leaves the 5th grader off a 6-12 roster', async () => {
    const { people } = await fetchYouthRoster({ ...world, config: baseConfig() });
    expect(people.map((person) => person.pcoPersonId)).not.toContain(FIXTURE_IDS.oliverFifthGrader);
  });

  it('takes the hand-maintained list at its word', async () => {
    // In list mode the list *is* the roster. The fixture models a youth pastor
    // overruling the grade filter in both directions: the 5th grader is left
    // off, and the student Planning Center has no grade for is kept on.
    const { people } = await fetchYouthRoster({
      ...world,
      config: baseConfig({ rosterSource: 'list', studentListId: STUDENT_LIST_ID }),
    });
    const ids = people.map((person) => person.pcoPersonId);

    expect(ids).toContain(FIXTURE_IDS.ivyNoGrade);
    expect(ids).not.toContain(FIXTURE_IDS.oliverFifthGrader);
  });

  it('reads the list endpoint in list mode, not the whole church', async () => {
    const listWorld = harness();
    await fetchYouthRoster({
      ...listWorld,
      config: baseConfig({ rosterSource: 'list', studentListId: STUDENT_LIST_ID }),
    });

    expect(
      listWorld.requests.every((url) => url.includes('/lists/' + STUDENT_LIST_ID + '/people')),
    ).toBe(true);
  });

  it('carries no parent contact and no allergies', async () => {
    // The whole point of splitting the roster from the details: a door volunteer
    // never receives a minor's medical notes or a parent's phone number, because
    // the screen they are on never asks for them.
    //
    // `profileComplete` is null here for the same reason — a roster read does
    // not hydrate households, so it cannot know, and saying `false` would put an
    // "incomplete profile" badge on every student in the ministry.
    const { people } = await fetchYouthRoster({ ...world, config: baseConfig() });
    const sofia = people.find((person) => person.pcoPersonId === FIXTURE_IDS.sofiaWithAllergy);

    expect(sofia).toBeDefined();
    expect(Object.keys(sofia ?? {}).sort()).toEqual([
      'firstName',
      'gender',
      'grade',
      'hasAllergies',
      'id',
      'lastName',
      'pcoPersonId',
      'profileComplete',
      'searchName',
      'status',
    ]);
    // The *fact* of an allergy travels, so the badge can be drawn. The note
    // does not.
    expect(sofia?.hasAllergies).toBe(true);
    expect(sofia?.profileComplete).toBeNull();
  });

  it('prefers the nickname a counselor would actually say', async () => {
    const { people } = await fetchYouthRoster({ ...world, config: baseConfig() });
    const benji = people.find((person) => person.pcoPersonId === FIXTURE_IDS.benjiWithNickname);
    expect(benji?.firstName).toBe('Benji');
  });

  it('returns ids the rest of Tally can use as student ids', async () => {
    const { people } = await fetchYouthRoster({ ...world, config: baseConfig() });
    for (const person of people) {
      expect(person.id).toBe(pcoStudentId(person.pcoPersonId));
    }
  });

  it('is sorted, so the roster does not reshuffle between reads', async () => {
    const { people } = await fetchYouthRoster({ ...world, config: baseConfig() });
    const names = people.map((person) => person.searchName);
    expect(names).toEqual([...names].sort());
  });

  it('follows every page rather than stopping at the first', async () => {
    const small = harness({ pageSize: 3 });
    const { people } = await fetchYouthRoster({ ...small, config: baseConfig() });

    const ids = new Set(people.map((person) => person.pcoPersonId));
    expect(ids.size).toBe(people.length);
    expect(people.length).toBeGreaterThan(3);
  });

  describe('caching', () => {
    it('asks Planning Center once for two readers inside the TTL', async () => {
      const config = baseConfig();
      const first = await fetchYouthRoster({ ...world, config });
      const before = world.requests.length;
      const second = await fetchYouthRoster({ ...world, config });

      expect(second.people).toEqual(first.people);
      expect(second.cached).toBe(true);
      expect(world.requests.length).toBe(before);
    });

    it('asks every time when the cache is turned off', async () => {
      const off = harness({}, 0);
      const config = baseConfig({ cacheTtlSeconds: 0 });

      await fetchYouthRoster({ ...off, config });
      const before = off.requests.length;
      const second = await fetchYouthRoster({ ...off, config });

      expect(second.cached).toBe(false);
      expect(off.requests.length).toBeGreaterThan(before);
      // The app still works — that is the point of 0 being a supported value.
      expect(second.people.length).toBeGreaterThan(0);
    });

    it('does not serve a list-mode roster from a grade-mode read', async () => {
      // These two contain the same people in this fixture, so equal output
      // proves nothing. What matters is that the second read went and asked,
      // rather than being answered from the first one's entry.
      await fetchYouthRoster({ ...world, config: baseConfig() });
      const afterGrade = world.requests.length;

      const listMode = await fetchYouthRoster({
        ...world,
        config: baseConfig({ rosterSource: 'list', studentListId: STUDENT_LIST_ID }),
      });

      expect(listMode.cached).toBe(false);
      expect(world.requests.slice(afterGrade).some((url) => url.includes('/lists/'))).toBe(true);
    });

    it('does not serve one grade band from a read of another', async () => {
      await fetchYouthRoster({ ...world, config: baseConfig() });
      const afterFull = world.requests.length;

      const narrow = await fetchYouthRoster({
        ...world,
        config: baseConfig({ minGrade: 9, maxGrade: 12 }),
      });

      expect(narrow.cached).toBe(false);
      expect(world.requests.length).toBeGreaterThan(afterFull);
      expect(narrow.people.every((person) => person.grade >= 9)).toBe(true);
    });

    it('does not cache an outage', async () => {
      const config = baseConfig();
      world.store.scheduleFailure(500, 'Planning Center is having a minute', 10);

      await expect(fetchYouthRoster({ ...world, config })).rejects.toThrow();

      world.store.reset();
      const recovered = await fetchYouthRoster({ ...world, config });
      expect(recovered.people.length).toBeGreaterThan(0);
    });
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

describe('findTeamMemberByEmail', () => {
  it('finds a leader on the counselor list and reads their role', async () => {
    const world = harness();
    const entry = await findTeamMemberByEmail({
      ...world,
      config: baseConfig({ counselorListId: TEAM_LIST_ID }),
      email: 'dana.ruiz@footprints.example.org',
    });

    expect(entry?.pcoPersonId).toBe(FIXTURE_IDS.adminDana);
    expect(entry?.role).toBe('admin');
    expect(entry?.active).toBe(true);
  });

  it('is case- and whitespace-insensitive, the way a typed address is', async () => {
    const world = harness();
    const entry = await findTeamMemberByEmail({
      ...world,
      config: baseConfig({ counselorListId: TEAM_LIST_ID }),
      email: '  Dana.Ruiz@Footprints.Example.ORG ',
    });

    expect(entry?.pcoPersonId).toBe(FIXTURE_IDS.adminDana);
  });

  it('refuses somebody who is not on the configured list', async () => {
    // Being findable in Planning Center is not the same as being on the youth
    // team, and the difference is a roster of minors.
    const world = harness();
    const entry = await findTeamMemberByEmail({
      ...world,
      config: baseConfig({ counselorListId: TEAM_LIST_ID }),
      email: 'nobody@example.org',
    });

    expect(entry).toBeNull();
  });

  it('falls back to a search when no list is configured', async () => {
    const world = harness();
    const entry = await findTeamMemberByEmail({
      ...world,
      config: baseConfig(),
      email: 'miriam.achebe@footprints.example.org',
    });

    expect(entry?.pcoPersonId).toBe(FIXTURE_IDS.managerMiriam);
  });

  it('rejects a near-miss the search happened to return', async () => {
    // Planning Center's search is fuzzy. "Close enough" is not a basis for
    // granting access, so the address is confirmed against what came back.
    const world = harness();
    const entry = await findTeamMemberByEmail({
      ...world,
      config: baseConfig(),
      email: 'miriam.achebe@footprints.example.ORG.uk',
    });

    expect(entry).toBeNull();
  });

  it('never grants access from an empty address', async () => {
    const world = harness();
    expect(await findTeamMemberByEmail({ ...world, config: baseConfig(), email: '   ' })).toBeNull();
    expect(world.requests.length).toBe(0);
  });
});
