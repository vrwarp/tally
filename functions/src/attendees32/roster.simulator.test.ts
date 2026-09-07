/**
 * Reading people on demand, against a realistic Attendees server.
 *
 * The same questions as the Planning Center roster suite: does a read return
 * the right people, does it leave the sensitive fields alone until somebody
 * asks, and does it stop asking twice for the same thing. Nothing here
 * touches Firestore.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  A32SimulatorStore,
  createSimulatorFetch,
  DEFAULT_TOKEN,
  FAMILY_CATEGORY,
  seedDefaultOrganization,
  SIMULATOR_ORIGIN,
} from '../../../tools/a32-simulator/src/index.js';
import type { A32Config } from '../config.js';
import { a32Config } from '../testing/a32Config.js';
import { createTtlCache, type TtlCache } from '../pco/cache.js';
import { createA32Client, type A32Client } from './client.js';
import {
  createAttendeeMemo,
  fetchAllergyNotes,
  fetchAdultContactStatus,
  fetchPersonDetails,
  fetchRoster,
  searchPeople,
} from './roster.js';

let store: A32SimulatorStore;
let client: A32Client;
let cache: TtlCache;
let config: A32Config;
/** Every URL the client asked for, so a test can count reads rather than infer. */
let requests: string[];

function idOf(firstName: string): string {
  const found = [...store.attendees.values()].find((attendee) => attendee.firstName === firstName);
  if (!found) throw new Error(`No seeded attendee called ${firstName}`);
  return found.id;
}

beforeEach(() => {
  store = new A32SimulatorStore();
  seedDefaultOrganization(store);
  requests = [];
  const simulator = createSimulatorFetch(store);
  client = createA32Client({
    token: DEFAULT_TOKEN,
    baseUrl: SIMULATOR_ORIGIN,
    fetchImpl: (input, init) => {
      requests.push(typeof input === 'string' ? input : String(input));
      return simulator(input, init);
    },
    sleep: async () => {},
  });
  cache = createTtlCache({ ttlMs: 30_000 });
  config = a32Config();
});

describe('fetchRoster', () => {
  it('answers for exactly the requested people, in roster order', async () => {
    const wanted = [idOf('Priya'), idOf('Wei'), idOf('Tomás')];
    const result = await fetchRoster({ client, config, cache, personIds: wanted });

    expect(result.people).toHaveLength(3);
    expect(result.people.map((person) => person.searchName)).toEqual(
      [...result.people.map((person) => person.searchName)].sort(),
    );
    expect(result.unresolved).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.relinks).toEqual([]);
  });

  it('maps the fields a roster row runs on', async () => {
    const result = await fetchRoster({ client, config, cache, personIds: [idOf('Priya')] });
    const [priya] = result.people;

    expect(priya).toMatchObject({
      backendId: 'a32',
      firstName: 'Priya',
      lastName: 'Raghunathan',
      grade: 9,
      hasAllergies: true,
      birthday: '03-14',
      status: 'active',
    });
    expect(priya!.id).toBe(`a32_${idOf('Priya')}`);
  });

  it('reads a day-known-year-unknown birthday through the 1800 sentinel', async () => {
    const result = await fetchRoster({ client, config, cache, personIds: [idOf('Wei')] });
    expect(result.people[0]!.birthday).toBe('09-02');
  });

  it('composes a CJK second name the way the rest of Tally expects', async () => {
    const result = await fetchRoster({ client, config, cache, personIds: [idOf('Wei')] });
    expect(result.people[0]!.firstName).toBe('Wei “鈴木偉”');
  });

  it('answers null for a missing grade rather than the band floor', () => {
    return fetchRoster({ client, config, cache, personIds: [idOf('Salote')] }).then((result) => {
      expect(result.people[0]!.grade).toBeNull();
    });
  });

  it('reports a removed person as missing rather than dropping them silently', async () => {
    const gone = idOf('Dmitri');
    store.attendees.get(gone)!.isRemoved = true;

    const result = await fetchRoster({ client, config, cache, personIds: [gone, idOf('Priya')] });
    expect(result.people).toHaveLength(1);
    expect(result.unresolved).toEqual([gone]);
    expect(result.missing).toEqual([gone]);
  });

  it('holds the answer for the TTL', async () => {
    const wanted = [idOf('Priya')];
    await fetchRoster({ client, config, cache, personIds: wanted });
    const requests = store.requests.length;

    const second = await fetchRoster({ client, config, cache, personIds: wanted });
    expect(second.cached).toBe(true);
    expect(store.requests.length).toBe(requests);
  });

  it('asks nothing at all for an empty roster', async () => {
    const result = await fetchRoster({ client, config, cache, personIds: [] });
    expect(result.people).toEqual([]);
    expect(store.requests.length).toBe(0);
  });
});

describe('searchPeople', () => {
  it('finds people by name and labels them with the backend', async () => {
    const results = await searchPeople({ client, config, query: 'Priya' });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      backendId: 'a32',
      firstName: 'Priya',
      lastName: 'Raghunathan',
      grade: 9,
      child: true,
    });
  });

  it('shows an adult with no grade as ungraded, never as 6th', async () => {
    const results = await searchPeople({ client, config, query: 'Meena' });
    expect(results).toHaveLength(1);
    expect(results[0]!.grade).toBeNull();
    expect(results[0]!.child).toBe(false);
  });

  it('answers an empty query with nobody and no request', async () => {
    expect(await searchPeople({ client, config, query: '  ' })).toEqual([]);
    expect(store.requests.length).toBe(0);
  });
});

describe('fetchPersonDetails', () => {
  it('names the parent and how to reach them', async () => {
    const details = await fetchPersonDetails({ client, config, cache, personId: idOf('Priya') });
    expect(details).toMatchObject({
      allergies: 'Tree nuts',
      contactName: 'Meena Raghunathan',
      contactPhone: '555-0311',
      contactEmail: 'meena.raghunathan@example.org',
      householdAdult: true,
    });
  });

  it('carries the whole birthdate, year included, on the one-person read', async () => {
    const details = await fetchPersonDetails({ client, config, cache, personId: idOf('Priya') });
    expect(details?.birthdate).toBe('2011-03-14');
  });

  it('answers a day-only birthdate through the 1800 sentinel, never the 1800', async () => {
    const details = await fetchPersonDetails({ client, config, cache, personId: idOf('Wei') });
    expect(details?.birthdate).toBe('09-02');
  });

  it('tells a family with nobody reachable apart from no family at all', async () => {
    const details = await fetchPersonDetails({ client, config, cache, personId: idOf('Nkechi') });
    expect(details).toMatchObject({
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      householdAdult: false,
    });
  });

  it('answers null for a person Attendees no longer has', async () => {
    const gone = idOf('Aroha');
    store.attendees.get(gone)!.isRemoved = true;
    expect(await fetchPersonDetails({ client, config, cache, personId: gone })).toBeNull();
  });

  /**
   * A family costs one read of the adult, not one per child in it.
   *
   * Naming the adult behind a student is a request for that adult, and siblings
   * share them — so twenty follow-up rows read one at a time, which is what the
   * dashboard did when every row was its own invocation, paid that read again
   * for every child of every family on the list. The Attendees counterpart of
   * the Planning Center household memo, and it is tested the same way.
   */
  describe('the attendee memo', () => {
    /** Two children of one adult, which the default seed deliberately has none of. */
    function siblings(): { elder: string; younger: string; parent: string } {
      const elder = store.seedStudent({
        firstName: 'Ada',
        lastName: 'Bello',
        gender: 'FEMALE',
        grade: 11,
        parents: [{ firstName: 'Femi', gender: 'MALE', contacts: { phone1: '555-0377' } }],
      });
      const younger = store.createAttendee({
        firstName: 'Chidi',
        lastName: 'Bello',
        gender: 'MALE',
        infos: { fixed: { grade: 8 }, contacts: {} },
      });
      /*
       * Into the family the elder already has, rather than one of their own:
       * that shared edge is the whole subject of these tests. Found through the
       * elder's own edges rather than by display name — `createAttendee` also
       * makes a hidden non-family folk, so the category is what tells them
       * apart.
       */
      const family = store.folkAttendees
        .filter((edge) => edge.attendeeId === elder.id && !edge.isRemoved)
        .map((edge) => store.folks.get(edge.folkId)!)
        .find((folk) => folk.category === FAMILY_CATEGORY)!;
      const childRole = store.relations.find((relation) => relation.title === 'child')!;
      store.addFolkAttendee(family.id, younger.id, childRole.id);

      const parent = [...store.attendees.values()].find(
        (attendee) => attendee.firstName === 'Femi',
      )!;
      return { elder: elder.id, younger: younger.id, parent: parent.id };
    }

    const adultReads = (personId: string): number =>
      requests.filter((url) => url.includes(personId)).length;

    it('reads a shared adult once for two siblings', async () => {
      const { elder, younger, parent } = siblings();
      const attendees = createAttendeeMemo();

      await fetchPersonDetails({ client, config, cache, attendees, personId: elder });
      await fetchPersonDetails({ client, config, cache, attendees, personId: younger });

      expect(adultReads(parent)).toBe(1);
    });

    it('reads them twice without one, which is what every caller but the batch does', async () => {
      // The write paths pass no memo on purpose: they must not act on a family
      // this request read a moment ago.
      const { elder, younger, parent } = siblings();

      await fetchPersonDetails({ client, config, cache, personId: elder });
      await fetchPersonDetails({ client, config, cache, personId: younger });

      expect(adultReads(parent)).toBe(2);
    });

    it('still answers each sibling with their own contact', async () => {
      // The saving is the request, never the answer.
      const { elder, younger } = siblings();
      const attendees = createAttendeeMemo();

      const first = await fetchPersonDetails({ client, config, cache, attendees, personId: elder });
      const second = await fetchPersonDetails({
        client,
        config,
        cache,
        attendees,
        personId: younger,
      });

      expect(first?.contactName).toBe('Femi Bello');
      expect(second?.contactName).toBe('Femi Bello');
      expect(second?.contactPhone).toBe('555-0377');
    });

    it('holds a deleted adult as an answer rather than re-asking per child', async () => {
      const { elder, younger, parent } = siblings();
      store.attendees.get(parent)!.isRemoved = true;
      const attendees = createAttendeeMemo();

      const first = await fetchPersonDetails({ client, config, cache, attendees, personId: elder });
      const second = await fetchPersonDetails({
        client,
        config,
        cache,
        attendees,
        personId: younger,
      });

      expect(first?.contactName).toBeNull();
      expect(second?.contactName).toBeNull();
      expect(adultReads(parent)).toBe(1);
    });
  });
});

describe('fetchAllergyNotes', () => {
  it('answers only for the flagged people asked about', async () => {
    const notes = await fetchAllergyNotes({
      client,
      config,
      cache,
      personIds: [idOf('Priya'), idOf('Tomás')],
    });
    expect(notes).toEqual({ [idOf('Priya')]: 'Tree nuts' });
  });
});

describe('fetchAdultContactStatus', () => {
  it('reports who has a reachable adult, keyed by Tally student id', async () => {
    const status = await fetchAdultContactStatus({
      client,
      config,
      cache,
      personIds: [idOf('Priya'), idOf('Nkechi')],
    });
    expect(status.reachable[`a32_${idOf('Priya')}`]).toBe(true);
    expect(status.reachable[`a32_${idOf('Nkechi')}`]).toBe(false);
    expect(status.unresolved).toEqual([]);
  });
});
