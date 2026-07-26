import { describe, expect, it } from 'vitest';
import { createPcoClient, PcoApiError, PcoNetworkError, REDACTED } from './client.js';
import { describePcoFailure } from './debug.js';

const at = () => new Date('2026-02-13T19:30:00Z');

/** A real failure through the client, so the traces are the ones users get. */
async function failing(response: Response | (() => never)) {
  const client = createPcoClient({
    appId: 'app-id',
    secret: 'super-secret-token',
    maxRetries: 0,
    sleep: async () => {},
    now: at,
    fetchImpl: (async () => {
      if (typeof response === 'function') response();
      return response;
    }) as unknown as typeof fetch,
  });
  return client.get('/lists').catch((error: unknown) => error);
}

describe('describePcoFailure', () => {
  it('carries the request and response of an API failure', async () => {
    const error = await failing(
      new Response(JSON.stringify({ errors: [{ status: '500', title: 'Server error' }] }), {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const debug = describePcoFailure(error, 'load your Planning Center lists', at);

    expect(debug.kind).toBe('api');
    expect(debug.operation).toBe('load your Planning Center lists');
    expect(debug.occurredAt).toBe('2026-02-13T19:30:00.000Z');
    expect(debug.request?.method).toBe('GET');
    expect(debug.request?.url).toContain('/lists');
    expect(debug.response?.status).toBe(500);
    expect(debug.response?.body).toContain('Server error');
    expect(debug.errors).toEqual(['Server error']);
  });

  it('never carries the Personal Access Token', async () => {
    const error = await failing(new Response('nope', { status: 401 }));

    const debug = describePcoFailure(error, 'load the roster', at);

    expect(JSON.stringify(debug)).not.toContain('super-secret-token');
    expect(debug.request?.headers.Authorization).toBe(REDACTED);
  });

  it('reports the cause chain when the request never became a response', async () => {
    const error = await failing(() => {
      const cause = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), {
        code: 'ECONNREFUSED',
      });
      throw new Error('fetch failed', { cause });
    });

    const debug = describePcoFailure(error, 'load the roster', at);

    expect(error).toBeInstanceOf(PcoNetworkError);
    expect(debug.kind).toBe('network');
    expect(debug.response).toBeNull();
    expect(debug.request?.attempts).toBe(1);
    expect(debug.errors).toEqual([
      'Error: fetch failed',
      'Error: connect ECONNREFUSED 1.2.3.4:443 (ECONNREFUSED)',
    ]);
  });

  it('still reports something for an error it does not recognise', () => {
    const debug = describePcoFailure(new TypeError('config.baseUrl is not a string'), 'x', at);

    expect(debug.kind).toBe('unknown');
    expect(debug.message).toBe('config.baseUrl is not a string');
    expect(debug.errors).toEqual(['TypeError: config.baseUrl is not a string']);
    expect(debug.request).toBeNull();
  });

  it('survives something that is not an Error at all', () => {
    const debug = describePcoFailure('everything is fine', 'x', at);

    expect(debug.kind).toBe('unknown');
    expect(debug.message).toBe('everything is fine');
    expect(debug.errors).toEqual(['everything is fine']);
  });

  it('describes a Planning Center error with no title as best it can', () => {
    const error = new PcoApiError(422, '/people', [{ code: 'validation_error' }]);

    expect(describePcoFailure(error, 'x', at).errors).toEqual([
      'Planning Center reported an error with no detail. (validation_error)',
    ]);
  });

  it('is JSON, because it travels as the details of an HttpsError', async () => {
    const error = await failing(new Response('nope', { status: 503 }));

    const debug = describePcoFailure(error, 'load the roster', at);

    expect(JSON.parse(JSON.stringify(debug))).toEqual(debug);
  });
});
