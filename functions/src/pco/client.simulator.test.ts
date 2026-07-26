/**
 * The Planning Center client, exercised against the API simulator.
 *
 * `client.test.ts` drives the client with hand-written `fetch` stubs to pin
 * down individual behaviours. This file does the opposite: it hands the *real*
 * client a *realistic* API and checks that the whole thing — query encoding,
 * cursor following, retry, error mapping — carries a full collection across
 * without losing or duplicating a single person.
 *
 * No network, no timers: `fetchImpl` is the simulator and `sleep` is recorded.
 */
import { describe, expect, it } from 'vitest';
import {
  SIMULATOR_ORIGIN,
  SimulatorStore,
  createSimulatorFetch,
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  FIXTURE_IDS,
  STUDENT_LIST_ID,
  type SimulatorOptions,
} from '../../../tools/pco-simulator/src/index.js';
import { PcoApiError, createPcoClient, type PcoClient, type PcoQuery } from './client.js';
import type { PcoPerson } from './types.js';

interface Harness {
  client: PcoClient;
  store: SimulatorStore;
  /** Every `sleep` the retry logic asked for, in milliseconds. */
  naps: number[];
}

function harness(options: SimulatorOptions = {}, credentials?: { appId: string; secret: string }): Harness {
  const store = new SimulatorStore(options);
  const naps: number[] = [];

  const client = createPcoClient({
    appId: credentials?.appId ?? DEFAULT_APP_ID,
    secret: credentials?.secret ?? DEFAULT_SECRET,
    baseUrl: SIMULATOR_ORIGIN,
    fetchImpl: createSimulatorFetch(store),
    sleep: async (ms) => {
      naps.push(ms);
    },
  });

  return { client, store, naps };
}

async function collectIds(
  client: PcoClient,
  path: string,
  query?: PcoQuery,
  options?: { perPage?: number },
) {
  const ids: string[] = [];
  for await (const page of client.paginate<PcoPerson>(path, query, options)) {
    for (const person of page.data) ids.push(person.id);
  }
  return ids;
}

describe('PcoClient against the simulator', () => {
  describe('pagination', () => {
    /**
     * Asserted on the id *set*, not the count. A broken cursor usually repeats a
     * page rather than truncating it, so a length check would pass while the
     * sync quietly processed the same students twice.
     */
    it.each(['links', 'absolute-links', 'meta', 'no-cursor'] as const)(
      'walks the whole collection when the API advertises the next page via %s',
      async (pagination) => {
        const { client, store } = harness({ pagination, pageSize: 4 });
        const expected = store.people.map((person) => person.id).sort();

        // `perPage` matches the server's page size so a full page stays full:
        // that is what forces the client to decide whether to keep going when
        // no cursor is offered.
        const ids = await collectIds(client, '/people', undefined, { perPage: 4 });

        expect(ids).toHaveLength(expected.length);
        expect(new Set(ids).size).toBe(expected.length);
        expect([...ids].sort()).toEqual(expected);
      },
    );

    it('makes more than one request when the page size forces it', async () => {
      const { client, store } = harness({ pageSize: 4 });
      await collectIds(client, '/people');
      expect(store.requestLog.length).toBeGreaterThan(1);
    });

    /**
     * The regression this guards: a full page with no cursor used to end the
     * walk, which would have imported the first 4 students and silently dropped
     * the other 31.
     */
    it('keeps walking a full page that advertises no cursor at all', async () => {
      const { client, store } = harness({ pagination: 'no-cursor', pageSize: 4 });
      const ids = await collectIds(client, '/people', undefined, { perPage: 4 });
      expect(ids).toHaveLength(store.people.length);
    });

    it('returns a single page when everything fits', async () => {
      const { client, store } = harness({ pageSize: 100 });
      await collectIds(client, '/people');
      expect(store.requestLog).toHaveLength(1);
    });
  });

  describe('query encoding', () => {
    it('sends where[updated_at][gt] in the form the API expects', async () => {
      const { client, store } = harness({ pageSize: 100 });
      const since = '2026-06-26T12:00:00.000Z';

      await collectIds(client, '/people', { where: { child: true, updated_at: { gt: since } } });

      const [request] = store.requestLog;
      expect(request?.query).toContain('where[child]=true');
      expect(request?.query).toContain(`where[updated_at][gt]=${encodeURIComponent(since)}`);
    });

    it('narrows the result set with that cursor rather than only decorating the URL', async () => {
      const { client, store } = harness({ pageSize: 100 });
      const all = await collectIds(client, '/people', { where: { child: true } });
      store.requestLog.length = 0;

      const recent = await collectIds(client, '/people', {
        where: { child: true, updated_at: { gt: '2026-06-26T12:00:00.000Z' } },
      });

      expect(recent.length).toBeGreaterThan(0);
      expect(recent.length).toBeLessThan(all.length);
    });

    it('joins include and order the way JSON:API spells them', async () => {
      const { client, store } = harness({ pageSize: 100 });

      await collectIds(client, '/people', {
        include: ['emails', 'households'],
        order: 'updated_at',
      });

      expect(store.requestLog[0]?.query).toContain('include=emails,households');
      expect(store.requestLog[0]?.query).toContain('order=updated_at');
    });

    it('side-loads the requested relationships into included', async () => {
      const { client } = harness({ pageSize: 100 });

      const body = await client.get<PcoPerson[]>('/people', {
        where: { id: FIXTURE_IDS.amara },
        include: ['households', 'households.people'],
      });

      const types = new Set((body.included ?? []).map((resource) => resource.type));
      expect(types).toContain('Household');
      expect(types).toContain('Person');
    });

    it('reads a Planning Center list as its own collection', async () => {
      const { client } = harness({ pageSize: 100 });
      const ids = await collectIds(client, `/lists/${STUDENT_LIST_ID}/people`);

      expect(ids).toContain(FIXTURE_IDS.ivyNoGrade);
      // The youth pastor keeps the 5th grader off the list by hand.
      expect(ids).not.toContain(FIXTURE_IDS.oliverFifthGrader);
    });
  });

  describe('errors', () => {
    it('raises a PcoApiError carrying the status and the API detail on a bad token', async () => {
      const { client } = harness({}, { appId: 'wrong', secret: 'wrong' });

      const failure = await client.get('/people').catch((cause: unknown) => cause);

      expect(failure).toBeInstanceOf(PcoApiError);
      const error = failure as PcoApiError;
      expect(error.status).toBe(401);
      expect(error.path).toContain('/people');
      expect(error.errors[0]?.detail).toMatch(/Personal Access Token/i);
    });

    it('does not retry a 4xx that is not a rate limit', async () => {
      const { client, store } = harness();
      store.scheduleFailure(422, 'Unprocessable Entity', 5);

      await expect(client.get('/people')).rejects.toBeInstanceOf(PcoApiError);
      // One attempt only: retrying a validation error just burns the quota.
      expect(store.requestLog).toHaveLength(1);
    });

    it('retries a 5xx and succeeds once the API recovers', async () => {
      const { client, store } = harness({ pageSize: 100 });
      store.scheduleFailure(500, 'Internal Server Error', 2);

      const body = await client.get<PcoPerson[]>('/people');

      expect(body.data.length).toBeGreaterThan(0);
      expect(store.requestLog.map((entry) => entry.status)).toEqual([500, 500, 200]);
    });

    it('gives up after the retry budget rather than hammering the API', async () => {
      const { client, store } = harness();
      store.scheduleFailure(500, 'Internal Server Error', 99);

      await expect(client.get('/people')).rejects.toBeInstanceOf(PcoApiError);
      expect(store.requestLog.length).toBeLessThanOrEqual(6);
    });
  });

  describe('rate limiting', () => {
    it('waits for the advertised Retry-After and then succeeds', async () => {
      const { client, store, naps } = harness({ pageSize: 100 });
      store.scheduleRateLimit({ count: 1, retryAfterSeconds: 3 });

      const body = await client.get<PcoPerson[]>('/people');

      expect(body.data.length).toBeGreaterThan(0);
      expect(store.requestLog.map((entry) => entry.status)).toEqual([429, 200]);
      // Honouring the server's own number is the difference between backing off
      // and being throttled harder.
      expect(naps[0]).toBeGreaterThanOrEqual(3000);
    });

    it('surfaces the wait on the error when it never recovers', async () => {
      const { client, store } = harness();
      store.scheduleRateLimit({ count: 99, retryAfterSeconds: 2 });

      const failure = (await client.get('/people').catch((cause: unknown) => cause)) as PcoApiError;

      expect(failure.status).toBe(429);
      expect(failure.retryAfterMs).toBe(2000);
    });
  });

  describe('writes', () => {
    it('creates a person and the API serves them back afterwards', async () => {
      const { client, store } = harness({ pageSize: 100 });
      const before = store.people.length;

      const created = await client.post<PcoPerson>('/people', {
        data: {
          type: 'Person',
          attributes: { first_name: 'Nia', last_name: 'Fontaine', grade: 9, child: true },
        },
      });

      expect(created.data.id).toBeTruthy();
      expect(store.people).toHaveLength(before + 1);

      const fetched = await client.get<PcoPerson>(`/people/${created.data.id}`);
      expect(fetched.data.attributes?.first_name).toBe('Nia');
      expect(fetched.data.attributes?.grade).toBe(9);
    });

    it('rejects a person with no name rather than storing a blank record', async () => {
      const { client } = harness();

      const failure = (await client
        .post('/people', { data: { type: 'Person', attributes: { grade: 9 } } })
        .catch((cause: unknown) => cause)) as PcoApiError;

      expect(failure).toBeInstanceOf(PcoApiError);
      expect(failure.status).toBe(422);
    });

    it('patches an existing person', async () => {
      const { client, store } = harness();

      await client.patch(`/people/${FIXTURE_IDS.amara}`, {
        data: { type: 'Person', attributes: { grade: 9 } },
      });

      expect(store.personById(FIXTURE_IDS.amara)?.grade).toBe(9);
    });
  });
});
