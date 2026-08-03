/**
 * A `fetch` implementation backed by the simulator.
 *
 * What lets the Cloud Functions unit tests exercise the *real* Attendees
 * client — its auth header, pagination, retry and error mapping — without a
 * network. The client cannot tell the difference: it is handed a
 * `typeof fetch` and calls it the way it always does.
 */
import { handleRequest } from './handler.js';
import { DEFAULT_PUBLIC_URL, type A32SimulatorStore } from './store.js';
import type { SimRequest } from './types.js';

export const SIMULATOR_ORIGIN = DEFAULT_PUBLIC_URL;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function parseQuery(url: URL): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else query[key] = [existing, value];
  }
  return query;
}

function headersOf(input: FetchInput, init?: FetchInit): Record<string, string> {
  const collected: Record<string, string> = {};
  const absorb = (headers: unknown): void => {
    if (!headers) return;
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        collected[key.toLowerCase()] = value;
      });
    } else if (Array.isArray(headers)) {
      for (const [key, value] of headers) collected[String(key).toLowerCase()] = String(value);
    } else if (typeof headers === 'object') {
      for (const [key, value] of Object.entries(headers as Record<string, string>)) {
        collected[key.toLowerCase()] = value;
      }
    }
  };
  if (typeof input === 'object' && 'headers' in input) absorb((input as Request).headers);
  absorb(init?.headers);
  return collected;
}

export function createSimulatorFetch(store: A32SimulatorStore): typeof fetch {
  return async function simulatorFetch(input: FetchInput, init?: FetchInit): Promise<Response> {
    const href =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const method = (
      init?.method ??
      (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')
    ).toUpperCase();

    const url = new URL(href);
    let body: unknown = null;
    if (init?.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = null;
      }
    }

    const request: SimRequest = {
      method,
      path: url.pathname,
      query: parseQuery(url),
      headers: headersOf(input, init),
      body,
    };

    const result = handleRequest(store, request);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}
