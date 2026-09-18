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
  createHouseholdMemo,
  fetchAllergyNotes,
  fetchAdultContactStatus,
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
  /**
   * The most requests that were ever outstanding at the same moment.
   *
   * Counted by wrapping the promise rather than the URL, because the URLs
   * cannot tell the two apart: sixty reads made one after another and sixty
   * made four at a time send exactly the same list of requests, and the whole
   * difference between them is *when*. A pool that quietly went back to being
   * serial would pass every other assertion in this file.
   */
  flight: { inFlight: number; max: number };
  /**
   * Person ids whose individual read is answered `403` without ever reaching
   * the simulator.
   *
   * The store's own fault injection is "the next N requests, whichever they
   * turn out to be", and that cannot say what the escape-path test needs to
   * say: *this* person's read fails while its neighbours' reads succeed. With
   * four workers racing on one cursor, which request arrives next is the very
   * thing under test, so a fault that lands by arrival order would arm itself
   * against a different request every time the pool changed.
   *
   * `403` rather than `500` because the client replays a 5xx: a retry ladder
   * would add requests to the log these tests count, and the point being made
   * is about a refusal that is not a deleted person, which 403 makes as well
   * as 500 does.
   */
  forbidden: Set<string>;
}

function harness(options: SimulatorOptions = {}, ttlMs = 30_000): Harness {
  const store = new SimulatorStore(options);
  const requests: string[] = [];
  const flight = { inFlight: 0, max: 0 };
  const forbidden = new Set<string>();
  const simulator = createSimulatorFetch(store);

  const client = createPcoClient({
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    sleep: async () => {},
    fetchImpl: async (input, init) => {
      const url = typeof input === 'string' ? input : String(input);
      requests.push(url);
      flight.inFlight += 1;
      flight.max = Math.max(flight.max, flight.inFlight);
      try {
        if (forbidden.has(new URL(url).pathname.split('/').pop() ?? '')) {
          return new Response(JSON.stringify({ errors: [{ status: '403', title: 'Forbidden' }] }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return await simulator(input, init);
      } finally {
        flight.inFlight -= 1;
      }
    },
  });

  return { client, store, cache: createTtlCache({ ttlMs }), requests, flight, forbidden };
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

  it('reports the grade upstream holds, or none — never a number it invented', async () => {
    // A graduation year counts: the mapper derives a grade from it, and
    // deriving is not inventing. Genuinely gradeless is the thinned-create
    // shape — no grade *and* no graduation year — and that answers null rather
    // than the bottom of the band.
    const gradeless = world.store.createPerson({ first_name: 'Nia', last_name: 'Fontaine' });

    const { people } = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.oliverFifthGrader, FIXTURE_IDS.ivyNoGrade, gradeless.id],
    });

    const byId = new Map(people.map((person) => [person.pcoPersonId, person]));
    // A 5th grader is reported as a 5th grader, not rounded up into the band.
    expect(byId.get(FIXTURE_IDS.oliverFifthGrader)?.grade).toBe(5);
    expect(byId.get(FIXTURE_IDS.ivyNoGrade)?.grade).not.toBeNull();
    expect(byId.get(gradeless.id)?.grade).toBeNull();
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
      expect(Object.keys(person)).not.toContain('contactPhone');
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

  /**
   * The people the `where[child]=true` sweep does not answer for.
   *
   * A hand-picked roster carries them by design: the adults on it, the senior
   * who graduated in May, anybody upstream never flagged as a child. They cost
   * a request each, and doing sixty of those one after another put seven
   * seconds of nothing but waiting in front of a counselor at a door — and, in
   * a rate-limited minute, sixty retry ladders end to end.
   */
  describe('the straggler pool', () => {
    /** Somebody the child sweep will never return, because upstream calls them an adult. */
    const straggler = (lastName: string): string =>
      world.store.createPerson({ first_name: 'Straggler', last_name: lastName, child: false }).id;

    it('looks stragglers up four at a time rather than one after another', async () => {
      const ids = ['Ames', 'Bell', 'Cole', 'Dunn', 'Eames', 'Ford', 'Grey', 'Hume'].map(straggler);

      const { people } = await fetchRoster({ ...world, config: baseConfig(), personIds: ids });

      expect(people).toHaveLength(ids.length);
      // Four exactly. A serial loop never reaches two, and an unbounded
      // fan-out is the other way to get this wrong: against an API that
      // rate-limits it buys one fast roster read and then a minute of 429s.
      expect(world.flight.max).toBe(4);
    });

    it('reports unresolved stragglers in the roster’s order, not the order the answers landed', async () => {
      /*
       * The pool finishes out of order on purpose — that is what a shared
       * cursor is for — and the roster must not. The first id here is a merge
       * chain that ends in a deleted keeper, so it costs three more requests
       * before it knows, and a version that reported each straggler as its
       * answer arrived would put it last. A list that reshuffles between reads
       * is the same complaint as a roster that reshuffles: somebody is reading
       * it down a phone.
       */
      const chained = '4209100';
      world.store.buryPerson(chained, '4209201');
      world.store.buryPerson('4209201', '4209202');
      world.store.buryPerson('4209202', null);
      const plain = ['4209101', '4209102', '4209103', '4209104', '4209105', '4209106', '4209107'];

      const { unresolved, missing } = await fetchRoster({
        ...world,
        config: baseConfig(),
        personIds: [...plain].reverse().concat(chained),
      });

      expect(unresolved).toEqual([chained, ...plain]);
      // Known gone, all of them: the caller freezes check-ins on this list, so
      // the distinction from could-not-look survives the pool too.
      expect(missing).toEqual([chained, ...plain]);
    });

    it('still follows a merged straggler to the record the church kept', async () => {
      const dup = world.store.createPerson({
        first_name: 'Rowan', last_name: 'Vasquez-Old', child: false,
      });
      const kept = world.store.createPerson({
        first_name: 'Rowan', last_name: 'Vasquez', child: false,
      });
      world.store.buryPerson(dup.id, kept.id);
      const alongside = ['Ames', 'Bell', 'Cole'].map(straggler);

      const { people, relinks, unresolved } = await fetchRoster({
        ...world,
        config: baseConfig(),
        personIds: [dup.id, ...alongside],
      });

      // Two more requests than its neighbours cost, run inside a worker that
      // its neighbours are not waiting on, and the same answer as before.
      expect(relinks).toEqual([{ fromPersonId: dup.id, toPersonId: kept.id }]);
      expect(people.map((person) => person.pcoPersonId)).toContain(kept.id);
      expect(unresolved).toEqual([]);
    });

    it('keeps the Attendees alias a straggler carries', async () => {
      /*
       * The alias arrives side-loaded on the individual reply, not on the
       * sweep, so it only survives if each worker carries its `included` home
       * for the ordered replay to collect. Losing it would not fail a roster
       * read at all — it would quietly stop the cross-backend dedup from
       * recognising this person, and one human would become two rows.
       */
      const uuid = '8c1f02a7-6d54-4a0d-9d2e-2b5f3a1c7e90';
      const adult = world.store.createPerson({
        first_name: 'Rosa', last_name: 'Iyer', child: false,
      });
      world.store.linkToAttendees(adult.id, uuid);
      const alongside = ['Ames', 'Bell', 'Cole', 'Dunn'].map(straggler);

      const result = await fetchRoster({
        ...world,
        config: baseConfig(),
        personIds: [adult.id, ...alongside],
      });

      expect(result.a32Aliases).toEqual({ [adult.id]: uuid });
    });

    it('stops drawing new stragglers once a lookup fails outright', async () => {
      /*
       * A 403 on the mirror read of a merge target is not a person who is
       * gone, so it escapes and fails the whole roster read — deliberately,
       * and unchanged here. What the pool added was a bill: `Promise.all`
       * rejects on the first throw, but the other three workers were never
       * told, and they went on taking targets until the list was empty. The
       * serial loop this replaced stopped at the straggler that threw, so the
       * new version spent up to sixty requests on a read that was already lost
       * — aimed at the Planning Center that had just refused one.
       *
       * The request count is the only assertion that can tell those apart:
       * both versions reject, with the same error, in the same time, and every
       * other observable about this read is identical.
       */
      const dup = world.store.createPerson({
        first_name: 'Rowan', last_name: 'Vasquez-Old', child: false,
      });
      const kept = world.store.createPerson({
        first_name: 'Rowan', last_name: 'Vasquez', child: false,
      });
      world.store.buryPerson(dup.id, kept.id);
      // Not a deleted person: Planning Center refusing to answer for one.
      world.forbidden.add(kept.id);
      const rest = Array.from({ length: 29 }, (_, i) => straggler(`Ames-${i}`));
      const ids = [dup.id, ...rest];

      await expect(
        fetchRoster({ ...world, config: baseConfig(), personIds: ids }),
      ).rejects.toMatchObject({ status: 403 });

      // The workers that were mid-request when the read threw are nobody's
      // promise any more, so let the queue drain before counting: otherwise
      // this measures how fast the assertion ran, not what the pool did.
      await new Promise((resolve) => setImmediate(resolve));

      const read = ids.filter((id) =>
        world.requests.some((url) => new URL(url).pathname.endsWith(`/people/${id}`)),
      );
      // Ten of thirty here, against thirty of thirty before the pool learned to
      // stop. The exact number is timing and not worth pinning: the failing
      // straggler costs two round trips before anyone can know, and the
      // neighbours finish the reads they had already started. What must not
      // happen is the pool walking the rest of the list.
      expect(read.length).toBeLessThan(ids.length / 2);
    });
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
      // Deliberately no claim about the grades that came back. This used to
      // assert they all landed at or above 9, which was a fact about the clamp
      // rather than about the cache: the band no longer rewrites anybody's
      // grade, so the same people come back saying what they actually are.
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
describe('fetchAdultContactStatus', () => {
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
    const { reachable } = await fetchAdultContactStatus({
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
    const { reachable } = await fetchAdultContactStatus({
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
    const { reachable } = await fetchAdultContactStatus({
      ...world,
      config: baseConfig(),
      personIds: ROSTER,
    });

    for (const personId of ROSTER) {
      const details = await fetchPersonDetails({ ...world, config: baseConfig(), personId });
      const hasContact = Boolean(details?.contactPhone ?? details?.contactEmail);
      expect(reachable[pcoStudentId(personId)], `disagreed about ${personId}`).toBe(hasContact);
    }
  });

  it('says nothing at all about a student Planning Center could not resolve', async () => {
    // Absent from the map, not `false`. "We could not look" is not "nobody is
    // there", and putting a deleted-upstream student on a call list as
    // unreachable sends somebody to fix the wrong thing.
    const world = harness();
    const { reachable, unresolved } = await fetchAdultContactStatus({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.amara, '4209999'],
    });

    expect(unresolved).toEqual(['4209999']);
    expect(reachable).not.toHaveProperty(pcoStudentId('4209999'));
  });

  it('carries no contact details, only the fact that there are some', async () => {
    const world = harness();
    const status = await fetchAdultContactStatus({
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
    await fetchAdultContactStatus({ ...world, config, personIds: ROSTER });
    const afterStatus = world.requests.length;

    // The adult sweep is new work; asking who is on the roster again is not.
    expect(afterStatus).toBeGreaterThan(afterRoster);

    const second = await fetchAdultContactStatus({ ...world, config, personIds: ROSTER });
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
    expect(details?.contactPhone ?? details?.contactEmail).toBeTruthy();
    // The year among them. The roster row for this same student carries
    // `06-28` and nothing more; this read is the one a screen showing her
    // profile makes, and it is where an edit form gets the date it opens on.
    expect(details?.birthdate).toBe('2008-06-28');
  });

  it('finds the parent in a household rather than the other child', async () => {
    const world = harness();
    const details = await fetchPersonDetails({
      ...world,
      config: baseConfig(),
      personId: FIXTURE_IDS.amara,
    });

    expect(details?.contactName).toBeTruthy();
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

  /**
   * A family costs one household read, not one per child in it.
   *
   * `household_memberships` is not includable from `/people`, so naming the
   * adult in a family is a request of its own — and Amara and Benji are in the
   * same one. Read one student at a time, which is what a dashboard of
   * follow-up rows did when every row was its own invocation, that request was
   * paid again for every sibling on the list.
   */
  describe('the household memo', () => {
    const householdReads = (world: Harness): number =>
      world.requests.filter((url) => url.includes('household_memberships')).length;

    it('reads a shared household once for two siblings', async () => {
      const world = harness();
      const config = baseConfig();
      const households = createHouseholdMemo();

      await fetchPersonDetails({ ...world, config, households, personId: FIXTURE_IDS.amara });
      await fetchPersonDetails({
        ...world,
        config,
        households,
        personId: FIXTURE_IDS.benjiWithNickname,
      });

      expect(householdReads(world)).toBe(1);
    });

    it('reads it twice without one, which is what every caller but the batch does', async () => {
      // The write paths pass no memo on purpose: they must not act on a
      // household this request read a moment ago. See `loadPersonWithHousehold`.
      const world = harness();
      const config = baseConfig();

      await fetchPersonDetails({ ...world, config, personId: FIXTURE_IDS.amara });
      await fetchPersonDetails({ ...world, config, personId: FIXTURE_IDS.benjiWithNickname });

      expect(householdReads(world)).toBe(2);
    });

    it('still answers each sibling about their own family', async () => {
      // The saving is the request, never the answer: a shared index that let one
      // child's contact stand in for another's would be worse than the cost.
      const world = harness();
      const config = baseConfig();
      const households = createHouseholdMemo();

      const amara = await fetchPersonDetails({
        ...world,
        config,
        households,
        personId: FIXTURE_IDS.amara,
      });
      const sofia = await fetchPersonDetails({
        ...world,
        config,
        households,
        personId: FIXTURE_IDS.sofiaWithAllergy,
      });

      expect(amara?.contactName).toBeTruthy();
      expect(sofia?.contactName).toBeTruthy();
      expect(amara?.contactName).not.toBe(sofia?.contactName);
      // Two households, so two reads — the memo collapses a family, not a list.
      expect(householdReads(world)).toBe(2);
    });
  });
});

/**
 * The one detail a check-in screen is allowed to read.
 *
 * Everything worth asserting here is about *narrowness*: the right line, for
 * the people asked about and nobody else, without the parent contact the wide
 * read would have brought along with it.
 */
describe('fetchAllergyNotes', () => {
  const flagged = [FIXTURE_IDS.sofiaWithAllergy, FIXTURE_IDS.elijahWithAllergy];

  it('returns the line a badge can print', async () => {
    const world = harness();
    const notes = await fetchAllergyNotes({ ...world, config: baseConfig(), personIds: flagged });

    expect(notes[FIXTURE_IDS.sofiaWithAllergy]).toBe('Severe peanut allergy — EpiPen in her bag');
    expect(notes[FIXTURE_IDS.elijahWithAllergy]).toBe('Lactose intolerant');
  });

  it('says nothing about anybody who was not asked about', async () => {
    const world = harness();
    const notes = await fetchAllergyNotes({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.sofiaWithAllergy],
    });

    expect(Object.keys(notes)).toEqual([FIXTURE_IDS.sofiaWithAllergy]);
  });

  it('omits a student with no note rather than sending an empty one', async () => {
    // The caller sends who the roster flagged; a person whose note was cleared
    // upstream between the two reads must not come back as a badge saying
    // "Allergy:" with nothing after it.
    const world = harness();
    const notes = await fetchAllergyNotes({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.amara],
    });

    expect(notes).toEqual({});
  });

  it('carries no parent contact at all', async () => {
    /*
     * The reason this exists rather than the check-in screen calling
     * `fetchPersonDetails`. That read hands back a parent's name, phone and
     * email — to a door volunteer, for a question about a peanut.
     */
    const world = harness();
    const notes = await fetchAllergyNotes({ ...world, config: baseConfig(), personIds: flagged });

    for (const value of Object.values(notes)) expect(typeof value).toBe('string');
    expect(JSON.stringify(notes)).not.toContain('@');
  });

  it('leaves the rest of the answer standing when one person cannot be read', async () => {
    // A deleted or merged-away person is one row that keeps the plain badge,
    // not a screen with no notes on it.
    const world = harness();
    const notes = await fetchAllergyNotes({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.sofiaWithAllergy, '4209999'],
    });

    expect(notes[FIXTURE_IDS.sofiaWithAllergy]).toBeTruthy();
    expect(notes).not.toHaveProperty('4209999');
  });

  it('costs one request per person, then none', async () => {
    const world = harness();
    const config = baseConfig();

    await fetchAllergyNotes({ ...world, config, personIds: flagged });
    const asked = world.requests.length;
    expect(asked).toBe(flagged.length);

    // A roster rebuilt on every check-in must not re-read the church.
    await fetchAllergyNotes({ ...world, config, personIds: flagged });
    expect(world.requests.length).toBe(asked);
  });

  it('asks Planning Center nothing when nobody is flagged', async () => {
    const world = harness();
    const notes = await fetchAllergyNotes({ ...world, config: baseConfig(), personIds: [] });

    expect(notes).toEqual({});
    expect(world.requests).toHaveLength(0);
  });
});

describe('attendees_uuid aliases', () => {
  const UUID = '49874dab-4135-4949-b053-b6d1b263489f';

  it('carries no aliases for an org that keeps no such field', async () => {
    const world = harness();
    const result = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: [FIXTURE_IDS.sofiaWithAllergy],
    });

    expect(result.a32Aliases).toEqual({});
    // And having found no field definition, it never asks for field_data.
    expect(world.requests.some((url) => url.includes('field_data'))).toBe(false);
  });

  it('reads each roster member’s Attendees identity off the same request', async () => {
    const world = harness();
    world.store.seedStudent({
      id: '7770001',
      firstName: 'Priya',
      lastName: 'Raghunathan',
      grade: 9,
      attendeesUuid: UUID,
    });

    const result = await fetchRoster({
      ...world,
      config: baseConfig(),
      personIds: ['7770001', FIXTURE_IDS.sofiaWithAllergy],
    });

    expect(result.a32Aliases).toEqual({ '7770001': UUID });
    // The pointer is server-internal: no roster row carries it.
    for (const person of result.people) {
      expect(JSON.stringify(person)).not.toContain(UUID);
    }
  });

  it('labels a search hit with the alias, so one human is one row', async () => {
    const world = harness();
    world.store.seedStudent({
      id: '7770002',
      firstName: 'Wei',
      lastName: 'Suzuki',
      grade: 11,
      attendeesUuid: UUID,
    });

    const results = await searchPeople({
      ...world,
      config: baseConfig(),
      query: 'Suzuki',
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.a32PersonId).toBe(UUID);
  });

  it('searches without aliases when no cache rides along', async () => {
    const world = harness();
    world.store.seedStudent({
      id: '7770003',
      firstName: 'Wei',
      lastName: 'Suzuki',
      grade: 11,
      attendeesUuid: UUID,
    });

    const results = await searchPeople({
      client: world.client,
      config: baseConfig(),
      query: 'Suzuki',
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.a32PersonId).toBeUndefined();
  });
});
