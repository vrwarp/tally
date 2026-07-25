/**
 * A `fetch` implementation backed by the simulator.
 *
 * This is what lets the Cloud Functions unit tests exercise the *real* client —
 * its query encoding, pagination, retry and error mapping — without a network.
 * The client cannot tell the difference: it is handed a `typeof fetch` and calls
 * it the way it always does.
 */
import { handleRequest } from './handler.js';
import { DEFAULT_PUBLIC_URL, type SimulatorStore } from './store.js';
import type { SimRequest } from './types.js';

/** Base URL the injected fetch answers on. Any host works; nothing resolves it. */
export const SIMULATOR_ORIGIN = DEFAULT_PUBLIC_URL;

export interface SimulatorFetchOptions {
  /** Origin prefix stripped before routing. Defaults to `SIMULATOR_ORIGIN`. */
  baseUrl?: string;
  /** Latency to simulate, in milliseconds. Omit for instantaneous responses. */
  latencyMs?: number;
}

/**
 * Derived from the global `fetch` rather than named directly: `RequestInfo` and
 * `HeadersInit` are DOM names, and this package compiles against Node's lib
 * only.
 */
type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchHeaders = NonNullable<FetchInit>['headers'];

export function createSimulatorFetch(
  store: SimulatorStore,
  options: SimulatorFetchOptions = {},
): typeof fetch {
  const baseUrl = (options.baseUrl ?? SIMULATOR_ORIGIN).replace(/\/+$/, '');

  return async function simulatorFetch(
    input: FetchInput,
    init?: FetchInit,
  ): Promise<Response> {
    const href =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')).toUpperCase();

    const url = new URL(href);
    const prefix = new URL(baseUrl);
    // Routes are matched on the path *after* the API root, so the same handler
    // works whether it is mounted at /people/v2 or at the root of a container.
    const path = url.pathname.startsWith(prefix.pathname)
      ? url.pathname.slice(prefix.pathname.length) || '/'
      : url.pathname;

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
      path,
      query: url.search.replace(/^\?/, ''),
      body,
      authorization: readHeader(init?.headers, 'authorization'),
    };

    if (options.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
    }

    const response = handleRequest(request, store);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}

function readHeader(headers: FetchHeaders, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name);
    return found ? (found[1] ?? null) : null;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return String(value);
  }
  return null;
}
