/**
 * The HTTP client for an Attendees (attendees32) server.
 *
 * The same discipline as ../pco/client.ts, adapted to a different dialect:
 * DRF token auth instead of HTTP Basic, `take`/`skip` pagination over a
 * `{"totalCount", "data"}` envelope instead of JSON:API cursors, and DRF's
 * router paths — where the trailing slash is load-bearing and a missing one
 * on a write is a 404 from a server that never saw the body.
 *
 * The retry rules carry over unchanged, because they were never about
 * Planning Center: POST is the verb that creates people and the one whose
 * lost reply must not be replayed; GET changes nothing; PATCH and PUT here
 * send fixed states rather than deltas. Traces redact the token the same way
 * and for the same reason.
 */
import type { PcoRequestTrace, PcoResponseTrace } from '../pco/client.js';
import { REDACTED } from '../pco/client.js';

export interface A32Query {
  [key: string]: string | number | boolean | null | undefined | ReadonlyArray<string | number>;
}

export function buildA32QueryString(query: A32Query | undefined): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

/** `{"totalCount": N, "data": [...]}` — the list envelope every endpoint uses. */
export interface A32Envelope<T> {
  totalCount: number;
  data: T[];
}

export class A32ApiError extends Error {
  readonly status: number;
  readonly path: string;
  /** DRF's `detail` (or the raw body), flattened to lines for a debug panel. */
  readonly errors: string[];
  readonly retryAfterMs: number | null;
  readonly request: PcoRequestTrace | null;
  readonly response: PcoResponseTrace | null;

  constructor(
    status: number,
    path: string,
    errors: string[],
    retryAfterMs: number | null = null,
    trace?: { request?: PcoRequestTrace; response?: PcoResponseTrace },
  ) {
    super(`Attendees ${status} for ${path}${errors.length > 0 ? `: ${errors.join('; ')}` : ''}`);
    this.name = 'A32ApiError';
    this.status = status;
    this.path = path;
    this.errors = errors;
    this.retryAfterMs = retryAfterMs;
    this.request = trace?.request ?? null;
    this.response = trace?.response ?? null;
  }
}

export class A32NetworkError extends Error {
  readonly request: PcoRequestTrace;
  override readonly cause: unknown;

  constructor(request: PcoRequestTrace, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Could not reach Attendees at ${request.url}: ${reason}`);
    this.name = 'A32NetworkError';
    this.request = request;
    this.cause = cause;
  }
}

/** `404`: the record is not there — Attendees has no merges, so that is the whole story. */
export function isA32GoneError(error: unknown): error is A32ApiError {
  return error instanceof A32ApiError && error.status === 404;
}

export interface A32ClientOptions {
  /** The integration user's DRF token. */
  token: string;
  /** Host root, e.g. `https://attendees.example.org` — paths carry `/persons/api/…`. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
  maxPages?: number;
  userAgent?: string;
}

export interface A32Page<T> {
  data: T[];
  totalCount: number;
  pageIndex: number;
}

export interface A32Client {
  get<T>(path: string, query?: A32Query, headers?: Record<string, string>): Promise<T>;
  post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T>;
  patch<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T>;
  put<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T>;
  /** Walks `take`/`skip` pages of a list endpoint. */
  paginate<T>(
    path: string,
    query?: A32Query,
    options?: { pageSize?: number; maxPages?: number; headers?: Record<string, string> },
  ): AsyncGenerator<A32Page<T>>;
}

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_MAX_PAGES = 200;
const DEFAULT_PAGE_SIZE = 100;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 20_000;
const MAX_TRACE_BODY_CHARS = 4000;

function isReplayable(method: string): boolean {
  // Same reasoning, same scar tissue as the Planning Center client: a POST
  // creates people, and a lost reply is indistinguishable from a lost request.
  return method !== 'POST';
}

function isRetryableStatus(status: number, replayable: boolean): boolean {
  if (status === 429) return true;
  return replayable && status >= 500;
}

function parseRetryAfter(header: string | null, now: Date): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now.getTime()) : null;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    safe[key] = key.toLowerCase() === 'authorization' ? REDACTED : value;
  }
  return safe;
}

function readResponseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    headers[key] = value;
  });
  return headers;
}

function errorLines(text: string): string[] {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    if (typeof body?.detail === 'string') return [body.detail];
    if (body && typeof body === 'object') {
      // DRF validation errors: {"field": ["problem", …], …}
      return Object.entries(body).map(([field, problems]) =>
        `${field}: ${Array.isArray(problems) ? problems.join('; ') : String(problems)}`,
      );
    }
  } catch {
    // Not JSON; the raw text travels in the trace instead.
  }
  return [];
}

export function createA32Client(options: A32ClientOptions): A32Client {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const defaultMaxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const authorization = `Token ${options.token}`;

  function toUrl(path: string, query?: A32Query): string {
    const absolute = /^https?:\/\//i.test(path)
      ? path
      : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const queryString = buildA32QueryString(query);
    if (!queryString) return absolute;
    return `${absolute}${absolute.includes('?') ? '&' : '?'}${queryString}`;
  }

  async function requestUrl<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    let lastError: unknown;

    const headers: Record<string, string> = {
      Authorization: authorization,
      Accept: 'application/json',
      'User-Agent': options.userAgent ?? 'Tally/1.0 (attendance)',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(extraHeaders ?? {}),
    };
    const traceRequest = (attempt: number): PcoRequestTrace => ({
      method,
      url,
      headers: redactHeaders(headers),
      attempts: attempt + 1,
    });

    const replayable = isReplayable(method);

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response: Response;
      const startedAt = now().getTime();
      try {
        response = await doFetch(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        lastError = error;
        if (!replayable || attempt === maxRetries) {
          throw new A32NetworkError(traceRequest(attempt), error);
        }
        await sleep(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt));
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      }

      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'), now());

      const apiError = async (): Promise<A32ApiError> => {
        let text = '';
        try {
          text = await response.text();
        } catch {
          text = '';
        }
        return new A32ApiError(response.status, url, errorLines(text), retryAfterMs, {
          request: traceRequest(attempt),
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: readResponseHeaders(response),
            body: text.slice(0, MAX_TRACE_BODY_CHARS),
            bodyTruncated: text.length > MAX_TRACE_BODY_CHARS,
            durationMs: Math.max(0, now().getTime() - startedAt),
          },
        });
      };

      if (!isRetryableStatus(response.status, replayable)) throw await apiError();
      if (attempt === maxRetries) throw await apiError();

      await sleep(retryAfterMs ?? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt));
    }

    /* c8 ignore next -- the loop always returns or throws. */
    throw lastError ?? new Error(`Attendees request to ${url} failed.`);
  }

  async function* paginate<T>(
    path: string,
    query?: A32Query,
    paginateOptions?: { pageSize?: number; maxPages?: number; headers?: Record<string, string> },
  ): AsyncGenerator<A32Page<T>> {
    const pageSize = Math.max(1, paginateOptions?.pageSize ?? DEFAULT_PAGE_SIZE);
    const maxPages = paginateOptions?.maxPages ?? defaultMaxPages;

    for (let pageIndex = 0; ; pageIndex += 1) {
      if (pageIndex >= maxPages) {
        throw new Error(`Attendees pagination for ${path} exceeded ${maxPages} pages; refusing to continue.`);
      }
      const skip = pageIndex * pageSize;
      const body = await requestUrl<A32Envelope<T>>(
        'GET',
        toUrl(path, { ...query, take: pageSize, skip }),
        undefined,
        paginateOptions?.headers,
      );
      const data = Array.isArray(body?.data) ? body.data : [];
      const totalCount = typeof body?.totalCount === 'number' ? body.totalCount : data.length;
      yield { data, totalCount, pageIndex };

      // `totalCount` is authoritative and a short page is unambiguous; either
      // way there is a definite end, unlike the cursor dialect next door.
      if (skip + data.length >= totalCount || data.length === 0) return;
    }
  }

  return {
    get: <T>(path: string, query?: A32Query, headers?: Record<string, string>) =>
      requestUrl<T>('GET', toUrl(path, query), undefined, headers),
    post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
      requestUrl<T>('POST', toUrl(path), body, headers),
    patch: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
      requestUrl<T>('PATCH', toUrl(path), body, headers),
    put: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
      requestUrl<T>('PUT', toUrl(path), body, headers),
    paginate,
  };
}
