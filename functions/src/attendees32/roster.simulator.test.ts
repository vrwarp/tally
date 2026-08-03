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
  seedDefaultOrganization,
  SIMULATOR_ORIGIN,
} from '../../../tools/a32-simulator/src/index.js';
import type { A32Config } from '../config.js';
import { a32Config } from '../testing/a32Config.js';
import { createTtlCache, type TtlCache } from '../pco/cache.js';
import { createA32Client, type A32Client } from './client.js';
import {
  fetchAllergyNotes,
  fetchParentContactStatus,
  fetchPersonDetails,
  fetchRoster,
  searchPeople,
} from './roster.js';

let store: A32SimulatorStore;
let client: A32Client;
let cache: TtlCache;
let config: A32Config;

function idOf(firstName: string): string {
  const found = [...store.attendees.values()].find((attendee) => attendee.firstName === firstName);
  if (!found) throw new Error(`No seeded attendee called ${firstName}`);
  return found.id;
}

beforeEach(() => {
  store = new A32SimulatorStore();
  seedDefaultOrganization(store);
  client = createA32Client({
    token: DEFAULT_TOKEN,
    baseUrl: SIMULATOR_ORIGIN,
    fetchImpl: createSimulatorFetch(store),
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
      gradeOnFile: true,
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

  it('lands a missing grade on the band floor and says the floor is not a fact', async () => {
    const result = await fetchRoster({ client, config, cache, personIds: [idOf('Salote')] });
    expect(result.people[0]!.grade).toBe(6);
    expect(result.people[0]!.gradeOnFile).toBe(false);
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
      parentName: 'Meena Raghunathan',
      parentPhone: '555-0311',
      parentEmail: 'meena.raghunathan@example.org',
      householdAdult: true,
    });
  });

  it('tells a family with nobody reachable apart from no family at all', async () => {
    const details = await fetchPersonDetails({ client, config, cache, personId: idOf('Nkechi') });
    expect(details).toMatchObject({
      parentName: null,
      parentPhone: null,
      parentEmail: null,
      householdAdult: false,
    });
  });

  it('answers null for a person Attendees no longer has', async () => {
    const gone = idOf('Aroha');
    store.attendees.get(gone)!.isRemoved = true;
    expect(await fetchPersonDetails({ client, config, cache, personId: gone })).toBeNull();
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

describe('fetchParentContactStatus', () => {
  it('reports who has a reachable adult, keyed by Tally student id', async () => {
    const status = await fetchParentContactStatus({
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
