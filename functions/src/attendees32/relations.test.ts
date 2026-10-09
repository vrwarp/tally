/**
 * The relation vocabulary, against the simulator's model of all_relations.
 *
 * The server answers a non-counselor with `driver` alone unless the query
 * names the family category; the loader must always name it, or every
 * child/parent decision downstream silently has nothing to work with.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  A32SimulatorStore,
  createSimulatorFetch,
  DEFAULT_TOKEN,
  seedDefaultOrganization,
  SIMULATOR_ORIGIN,
} from '../../../tools/a32-simulator/src/index.js';
import { createTtlCache, type TtlCache } from '../pco/cache.js';
import { a32Config } from '../testing/a32Config.js';
import { createA32Client, type A32Client } from './client.js';
import { loadRelations, relationIdsOf } from './relations.js';
import { API, type A32Relation } from './types.js';

let store: A32SimulatorStore;
let client: A32Client;
let cache: TtlCache;
let requests: string[];

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
});

describe('loadRelations', () => {
  it('asks for the family vocabulary and gets child and parent back', async () => {
    const relations = await loadRelations({ client, cache, config: a32Config() });
    const titles = [...relations.values()].map((relation) => relation.title);
    expect(titles).toContain('child');
    expect(titles).toContain('parent');
    expect(requests.some((url) => url.includes('category_id=0'))).toBe(true);
  });

  it('reads once and answers from the cache after that', async () => {
    const options = { client, cache, config: a32Config() };
    await loadRelations(options);
    await loadRelations(options);
    expect(requests.filter((url) => url.includes('all_relations')).length).toBe(1);
  });

  it('would get driver alone without naming the family category', async () => {
    // The server's rule, modelled by the simulator: this is what the loader
    // protects against, so a loader that drops the query fails the test above.
    const titles: string[] = [];
    for await (const page of client.paginate<A32Relation>(API.relations)) {
      titles.push(...page.data.map((relation) => relation.title));
    }
    expect(titles).toEqual(['driver']);
  });
});

describe('relationIdsOf', () => {
  it('finds the ids by title and reports what is missing as null', async () => {
    const relations = await loadRelations({ client, cache, config: a32Config() });
    const ids = relationIdsOf(relations);
    expect(ids.child).toBe(27);
    expect(ids.parent).toBe(30);
    expect(relationIdsOf(new Map())).toEqual({ child: null, parent: null });
  });
});
