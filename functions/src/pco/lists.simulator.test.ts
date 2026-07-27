/**
 * Reading Planning Center's Lists, against a realistic Planning Center.
 *
 * The picker these feed exists to stop a leader configuring the roster by
 * pasting a number out of a browser address bar, so what matters here is not
 * "did an array come back" but whether the answer carries enough for somebody
 * to recognise the right list and to notice the wrong one. The fixture
 * organisation deliberately contains a decoy: a 2019 camp list, similarly
 * named, with real members and broken rules.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  SIMULATOR_ORIGIN,
  SimulatorStore,
  createSimulatorFetch,
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  STALE_LIST_ID,
  STUDENT_LIST_ID,
  TEAM_LIST_ID,
  type SimulatorOptions,
} from '../../../tools/pco-simulator/src/index.js';
import { createPcoClient, PcoApiError, type PcoClient } from './client.js';
import { fetchList, fetchLists } from './lists.js';

function harness(options: SimulatorOptions = {}): { client: PcoClient; store: SimulatorStore } {
  const store = new SimulatorStore(options);
  const simulator = createSimulatorFetch(store);

  const client = createPcoClient({
    appId: DEFAULT_APP_ID,
    secret: DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    sleep: async () => {},
    fetchImpl: simulator,
  });

  return { client, store };
}

describe('fetchLists', () => {
  let world: ReturnType<typeof harness>;

  beforeEach(() => {
    world = harness();
  });

  it('returns every list the token can see', async () => {
    const lists = await fetchLists({ client: world.client });

    expect(lists.map((list) => list.id)).toEqual(
      expect.arrayContaining([STUDENT_LIST_ID, TEAM_LIST_ID, STALE_LIST_ID]),
    );
  });

  it('carries the member count, which is the whole reason to have a picker', async () => {
    const lists = await fetchLists({ client: world.client });
    const students = lists.find((list) => list.id === STUDENT_LIST_ID);

    // Choosing a roster source without seeing what it would select is the
    // failure mode this replaces — the count has to survive the round trip.
    expect(students?.totalPeople).toBeGreaterThan(0);
    expect(students?.name).toBe('Youth Students');
  });

  it('reports the health of a list somebody should not pick', async () => {
    const lists = await fetchLists({ client: world.client });
    const stale = lists.find((list) => list.id === STALE_LIST_ID);

    // Both signals matter, and for different reasons: `invalid` means Planning
    // Center itself has given up on the rules, and a years-old refresh with no
    // auto-refresh means the members are frozen in 2019 with no error anywhere.
    expect(stale?.invalid).toBe(true);
    expect(stale?.autoRefresh).toBe(false);
    expect(stale?.refreshedAt).toMatch(/^2019/);
  });

  it('filters by name upstream rather than downloading everything', async () => {
    const requests: string[] = [];
    const store = new SimulatorStore();
    const simulator = createSimulatorFetch(store);
    const client = createPcoClient({
      appId: DEFAULT_APP_ID,
      secret: DEFAULT_SECRET,
      baseUrl: SIMULATOR_ORIGIN,
      sleep: async () => {},
      fetchImpl: (input, init) => {
        requests.push(String(input));
        return simulator(input, init);
      },
    });

    const lists = await fetchLists({ client, search: 'camp' });

    expect(lists.map((list) => list.id)).toEqual([STALE_LIST_ID]);
    expect(requests.join(' ')).toContain('where[name]=camp');
  });

  it('sorts by name, so the same list is in the same place every time', async () => {
    const names = (await fetchLists({ client: world.client })).map((list) => list.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('stops at the requested limit', async () => {
    const lists = await fetchLists({ client: world.client, limit: 1 });
    expect(lists).toHaveLength(1);
  });

  it('walks pagination rather than trusting one page', async () => {
    // A church with more lists than fit in a page must not silently lose the
    // one the youth pastor is looking for.
    const paged = harness({ pageSize: 1 });
    const lists = await fetchLists({ client: paged.client });

    expect(lists.length).toBeGreaterThanOrEqual(3);
  });
});

describe('fetchList', () => {
  it('names the list behind a configured id', async () => {
    const { client } = harness();
    const list = await fetchList(client, STUDENT_LIST_ID);

    expect(list?.name).toBe('Youth Students');
  });

  it('reports a list that is no longer there as an error the caller decides about', async () => {
    // Deliberately a throw rather than a null: `fetchList` cannot tell "deleted"
    // from "the token lost permission", and the status handler treats both the
    // same way — as a name it could not read, not as a broken connection.
    const { client } = harness();
    await expect(fetchList(client, 'NO_SUCH_LIST')).rejects.toBeInstanceOf(PcoApiError);
  });
});
