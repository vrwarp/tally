import { describe, expect, it, vi } from 'vitest';
import { buildQueryString, createPcoClient, PcoApiError, PcoNetworkError, REDACTED } from './client.js';
import { PCO_BASE_URL, type PcoPerson } from './types.js';

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/** Replays canned responses in order and records every URL it was asked for. */
function stubFetch(responses: Response[]) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    urls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected request to ${String(input)}`);
    return next;
  });
  return { urls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

function makeClient(responses: Response[]) {
  const { urls, fetchImpl } = stubFetch(responses);
  const slept: number[] = [];
  const client = createPcoClient({
    appId: 'app-id',
    secret: 'secret',
    fetchImpl,
    sleep: async (ms) => {
      slept.push(ms);
    },
    now: () => new Date('2026-02-13T19:30:00Z'),
  });
  return { client, urls, slept };
}

const personPage = (ids: string[]) =>
  ids.map((id) => ({ id, type: 'Person', attributes: { first_name: `P${id}` } }));

/* -------------------------------------------------------------------------- */
/* Query strings                                                               */
/* -------------------------------------------------------------------------- */

describe('buildQueryString', () => {
  it('encodes nested where filters the way Planning Center expects', () => {
    expect(
      buildQueryString({
        where: { child: true, grade: 8, updated_at: { gt: '2026-01-01T00:00:00Z' } },
        include: ['emails', 'phone_numbers'],
        per_page: 100,
      }),
    ).toBe(
      'where[child]=true&where[grade]=8&where[updated_at][gt]=2026-01-01T00%3A00%3A00Z' +
        '&include=emails,phone_numbers&per_page=100',
    );
  });

  it('drops empty values instead of sending blank filters', () => {
    expect(buildQueryString({ where: { search_name: undefined, grade: null }, include: [] })).toBe('');
    expect(buildQueryString(undefined)).toBe('');
  });

  it('percent-encodes values that would otherwise break the query', () => {
    expect(buildQueryString({ where: { search_name: 'Ada Lin & Co' } })).toBe(
      'where[search_name]=Ada%20Lin%20%26%20Co',
    );
  });
});

describe('get', () => {
  it('sends HTTP Basic credentials and hangs the query off the base URL', async () => {
    const { client, urls } = makeClient([json({ data: [] })]);

    await client.get<PcoPerson[]>('/people', { where: { grade: 8 } });

    expect(urls[0]).toBe(`${PCO_BASE_URL}/people?where[grade]=8`);
  });
});

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

describe('paginate', () => {
  it('follows links.next until it runs out', async () => {
    const { client, urls } = makeClient([
      json({
        data: personPage(['1', '2']),
        included: [{ id: 'e1', type: 'Email' }],
        links: { next: `${PCO_BASE_URL}/people?offset=2&per_page=2` },
      }),
      json({ data: personPage(['3', '4']), links: { next: `${PCO_BASE_URL}/people?offset=4&per_page=2` } }),
      json({ data: personPage(['5']) }),
    ]);

    const seen: string[] = [];
    for await (const page of client.paginate<PcoPerson>('/people', {}, { perPage: 2 })) {
      seen.push(...page.data.map((p) => p.id));
    }

    expect(seen).toEqual(['1', '2', '3', '4', '5']);
    expect(urls).toEqual([
      `${PCO_BASE_URL}/people?per_page=2&offset=0`,
      `${PCO_BASE_URL}/people?offset=2&per_page=2`,
      `${PCO_BASE_URL}/people?offset=4&per_page=2`,
    ]);
  });

  it('falls back to meta.next.offset when no link is given', async () => {
    const { client, urls } = makeClient([
      json({ data: personPage(['1', '2']), meta: { next: { offset: 2 } } }),
      json({ data: personPage(['3']), meta: {} }),
    ]);

    const seen: string[] = [];
    for await (const page of client.paginate<PcoPerson>('/people', { where: { child: true } }, { perPage: 2 })) {
      seen.push(...page.data.map((p) => p.id));
    }

    expect(seen).toEqual(['1', '2', '3']);
    expect(urls[1]).toBe(`${PCO_BASE_URL}/people?where[child]=true&per_page=2&offset=2`);
  });

  it('stops on a short page that carries no cursor', async () => {
    const { client, urls } = makeClient([json({ data: personPage(['1']), meta: { count: 1 } })]);

    const pages = [];
    for await (const page of client.paginate<PcoPerson>('/people', {}, { perPage: 25 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
    expect(urls).toHaveLength(1);
  });

  it('stops when the server hands back a cursor it has already served', async () => {
    const { client } = makeClient([
      json({ data: personPage(['1']), links: { next: `${PCO_BASE_URL}/people?per_page=1&offset=0` } }),
    ]);

    const pages = [];
    for await (const page of client.paginate<PcoPerson>('/people', {}, { perPage: 1 })) {
      pages.push(page);
    }

    expect(pages).toHaveLength(1);
  });

  it('refuses to iterate past the page cap', async () => {
    const responses = Array.from({ length: 4 }, (_, i) =>
      json({ data: personPage([String(i)]), meta: { next: { offset: i + 1 } } }),
    );
    const { client } = makeClient(responses);

    await expect(async () => {
      for await (const _page of client.paginate<PcoPerson>('/people', {}, { perPage: 1, maxPages: 3 })) {
        void _page;
      }
    }).rejects.toThrow(/exceeded 3 pages/);
  });
});

/* -------------------------------------------------------------------------- */
/* Retries and errors                                                          */
/* -------------------------------------------------------------------------- */

describe('retries', () => {
  it('honours Retry-After on a 429 and then succeeds', async () => {
    const { client, slept, urls } = makeClient([
      json({ errors: [{ status: '429', title: 'Rate limit' }] }, {
        status: 429,
        headers: { 'Retry-After': '2' },
      }),
      json({ data: [] }),
    ]);

    const body = await client.get<PcoPerson[]>('/people');

    expect(body.data).toEqual([]);
    expect(slept).toEqual([2000]);
    expect(urls).toHaveLength(2);
  });

  it('backs off exponentially on a 5xx with no Retry-After header', async () => {
    const { client, slept } = makeClient([
      json({}, { status: 500 }),
      json({}, { status: 503 }),
      json({ data: [] }),
    ]);

    await client.get<PcoPerson[]>('/people');

    expect(slept).toEqual([500, 1000]);
  });

  it('gives up with a PcoApiError once the retries are spent', async () => {
    let attempts = 0;
    const client = createPcoClient({
      appId: 'a',
      secret: 'b',
      maxRetries: 2,
      sleep: async () => {},
      fetchImpl: (async () => {
        attempts += 1;
        return json({ errors: [{ detail: 'Server error' }] }, { status: 500 });
      }) as unknown as typeof fetch,
    });

    await expect(client.get('/people')).rejects.toBeInstanceOf(PcoApiError);
    expect(attempts).toBe(3);
  });

  it('never retries a 4xx and reports the parsed errors array', async () => {
    const { client, urls, slept } = makeClient([
      json(
        { errors: [{ status: '422', code: 'validation_error', detail: 'Grade must be a number' }] },
        { status: 422 },
      ),
    ]);

    const error = await client.get('/people').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PcoApiError);
    const apiError = error as PcoApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.path).toContain('/people');
    expect(apiError.errors[0]?.detail).toBe('Grade must be a number');
    expect(apiError.message).toContain('Grade must be a number');
    expect(urls).toHaveLength(1);
    expect(slept).toEqual([]);
  });

  it('records the exchange on the error, with the credential taken out', async () => {
    const badGateway = () =>
      new Response('<html>Bad gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'session=secret' },
      });
    // Five, because the trace that matters is the attempt that gave up.
    const { client } = makeClient([badGateway(), badGateway(), badGateway(), badGateway(), badGateway()]);

    const error = (await client.get('/people').catch((caught: unknown) => caught)) as PcoApiError;

    expect(error).toBeInstanceOf(PcoApiError);
    expect(error.request?.method).toBe('GET');
    expect(error.request?.url).toContain('/people');
    // The whole reason a trace may be shown to somebody: no token in it.
    expect(error.request?.headers.Authorization).toBe(REDACTED);
    expect(JSON.stringify(error.request)).not.toContain('secret');
    // Five sends: the first plus the four retries.
    expect(error.request?.attempts).toBe(5);

    expect(error.response?.status).toBe(502);
    expect(error.response?.statusText).toBe('Bad Gateway');
    expect(error.response?.headers['content-type']).toBe('text/html');
    expect(error.response?.headers['set-cookie']).toBeUndefined();
    // Not JSON, so there are no parsed errors — but the body still explains it.
    expect(error.errors).toEqual([]);
    expect(error.response?.body).toBe('<html>Bad gateway</html>');
    expect(error.response?.bodyTruncated).toBe(false);
  });

  it('truncates a body too big to carry back to a browser', async () => {
    const { client } = makeClient([
      new Response('x'.repeat(9000), { status: 400, statusText: 'Bad Request' }),
    ]);

    const error = (await client.get('/people').catch((caught: unknown) => caught)) as PcoApiError;

    expect(error.response?.body).toHaveLength(4000);
    expect(error.response?.bodyTruncated).toBe(true);
  });

  it('wraps a request that never became a response, keeping the cause', async () => {
    const client = createPcoClient({
      appId: 'a',
      secret: 'b',
      maxRetries: 1,
      sleep: async () => {},
      fetchImpl: (async () => {
        throw new Error('getaddrinfo ENOTFOUND api.planningcenteronline.com');
      }) as unknown as typeof fetch,
    });

    const error = (await client.get('/people').catch((caught: unknown) => caught)) as PcoNetworkError;

    expect(error).toBeInstanceOf(PcoNetworkError);
    expect(error.request.attempts).toBe(2);
    expect(error.request.headers.Authorization).toBe(REDACTED);
    expect((error.cause as Error).message).toContain('ENOTFOUND');
    expect(error.message).toContain('Could not reach Planning Center');
  });
});

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

describe('writes', () => {
  it('posts a JSON:API document and returns the created resource', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = createPcoClient({
      appId: 'a',
      secret: 'b',
      sleep: async () => {},
      fetchImpl: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return json({ data: { id: '900', type: 'Person' } });
      }) as unknown as typeof fetch,
    });

    const body = await client.post<PcoPerson>('/people', {
      data: { type: 'Person', attributes: { first_name: 'Ada' } },
    });

    expect(body.data.id).toBe('900');
    expect(calls[0]?.url).toBe(`${PCO_BASE_URL}/people`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      data: { type: 'Person', attributes: { first_name: 'Ada' } },
    });
  });
});
