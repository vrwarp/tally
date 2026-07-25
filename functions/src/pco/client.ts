/**
 * A very small typed JSON:API client for Planning Center People.
 *
 * Deliberately hand-rolled on Node's global `fetch` rather than an HTTP library:
 * the surface Tally needs is four verbs, and a Cloud Function's cold start is
 * charged to a counselor waiting at a door.
 *
 * Everything external is injectable (`fetchImpl`, `sleep`, `now`) so the whole
 * retry and pagination machinery can be exercised in-process, with no network
 * and no real timers.
 */
import {
  PCO_BASE_URL,
  PCO_MAX_PER_PAGE,
  type JsonApiBody,
  type JsonApiResource,
  type JsonApiMeta,
  type PcoErrorBody,
  type PcoErrorDetail,
} from './types.js';

/* -------------------------------------------------------------------------- */
/* Query strings                                                               */
/* -------------------------------------------------------------------------- */

export type PcoQueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number)[]
  | PcoQuery;

export interface PcoQuery {
  [key: string]: PcoQueryValue;
}

function isPlainObject(value: unknown): value is PcoQuery {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Encodes Planning Center's nested filter syntax:
 *
 *   { where: { grade: 8, updated_at: { gt: iso } }, include: ['emails'] }
 *   -> where[grade]=8&where[updated_at][gt]=<iso>&include=emails
 *
 * Bracket characters are left literal (Planning Center accepts either form, and
 * an unescaped URL is enormously easier to read in a log). Array values join
 * with commas, which is how JSON:API spells `include` and `order`.
 */
export function buildQueryString(query: PcoQuery | undefined): string {
  const parts: string[] = [];

  const walk = (prefix: string, value: PcoQueryValue): void => {
    if (value === undefined || value === null) return;

    if (Array.isArray(value)) {
      if (value.length === 0) return;
      parts.push(`${prefix}=${value.map((item) => encodeURIComponent(String(item))).join(',')}`);
      return;
    }

    if (isPlainObject(value)) {
      for (const [key, nested] of Object.entries(value)) {
        walk(`${prefix}[${encodeURIComponent(key)}]`, nested);
      }
      return;
    }

    parts.push(`${prefix}=${encodeURIComponent(String(value))}`);
  };

  for (const [key, value] of Object.entries(query ?? {})) {
    walk(encodeURIComponent(key), value);
  }

  return parts.join('&');
}

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export class PcoApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly errors: PcoErrorDetail[];
  /** Populated from `Retry-After` on a 429, so a caller can report the wait. */
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    path: string,
    errors: PcoErrorDetail[],
    retryAfterMs: number | null = null,
  ) {
    const detail = errors.map((error) => error.detail ?? error.title).filter(Boolean).join('; ');
    super(`Planning Center ${status} for ${path}${detail ? `: ${detail}` : ''}`);
    this.name = 'PcoApiError';
    this.status = status;
    this.path = path;
    this.errors = errors;
    this.retryAfterMs = retryAfterMs;
  }
}

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

export interface PcoClientOptions {
  /** Personal Access Token application id (HTTP Basic username). */
  appId: string;
  /** Personal Access Token secret (HTTP Basic password). */
  secret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Injected so retry tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Attempts *after* the first, per request. */
  maxRetries?: number;
  /** Hard stop for `paginate`, so a stuck cursor cannot spin forever. */
  maxPages?: number;
  userAgent?: string;
}

export interface PcoPage<T> {
  data: T[];
  included: JsonApiResource[];
  meta: JsonApiMeta;
  /** 0-based index of this page within the iteration, for logging. */
  pageIndex: number;
}

export interface PaginateOptions {
  perPage?: number;
  maxPages?: number;
}

export interface PcoClient {
  get<TData>(path: string, query?: PcoQuery): Promise<JsonApiBody<TData>>;
  post<TData>(path: string, body: unknown): Promise<JsonApiBody<TData>>;
  patch<TData>(path: string, body: unknown): Promise<JsonApiBody<TData>>;
  paginate<T>(path: string, query?: PcoQuery, options?: PaginateOptions): AsyncGenerator<PcoPage<T>>;
}

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_MAX_PAGES = 500;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 20_000;

/** 429 is a *scheduling* problem; 5xx is Planning Center having a bad minute. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfter(header: string | null, now: Date): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now.getTime()) : null;
}

async function readErrors(response: Response): Promise<PcoErrorDetail[]> {
  try {
    const body = (await response.json()) as PcoErrorBody;
    return Array.isArray(body?.errors) ? body.errors : [];
  } catch {
    // A gateway timeout or a WAF block is not JSON. An empty list is honest.
    return [];
  }
}

export function createPcoClient(options: PcoClientOptions): PcoClient {
  const baseUrl = (options.baseUrl ?? PCO_BASE_URL).replace(/\/$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const defaultMaxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const authorization = `Basic ${Buffer.from(`${options.appId}:${options.secret}`).toString('base64')}`;

  function toUrl(path: string, query?: PcoQuery): string {
    const absolute = /^https?:\/\//i.test(path) ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const queryString = buildQueryString(query);
    if (!queryString) return absolute;
    return `${absolute}${absolute.includes('?') ? '&' : '?'}${queryString}`;
  }

  async function requestUrl<TData>(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    body?: unknown,
  ): Promise<JsonApiBody<TData>> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(url, {
          method,
          headers: {
            Authorization: authorization,
            Accept: 'application/json',
            'User-Agent': options.userAgent ?? 'Tally/1.0 (Footprints attendance)',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        // DNS blips and socket resets look nothing like an HTTP status but are
        // exactly as transient, so they share the backoff.
        lastError = error;
        if (attempt === maxRetries) throw error;
        await sleep(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt));
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return { data: undefined as TData };
        return (await response.json()) as JsonApiBody<TData>;
      }

      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'), now());

      if (!isRetryableStatus(response.status)) {
        throw new PcoApiError(response.status, url, await readErrors(response), retryAfterMs);
      }

      if (attempt === maxRetries) {
        throw new PcoApiError(response.status, url, await readErrors(response), retryAfterMs);
      }

      // Planning Center's own advice wins over our guess; the exponential curve
      // is only the floor for a 5xx that arrives without a header.
      await sleep(retryAfterMs ?? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt));
    }

    /* c8 ignore next -- the loop always returns or throws. */
    throw lastError ?? new Error(`Planning Center request to ${url} failed.`);
  }

  async function* paginate<T>(
    path: string,
    query?: PcoQuery,
    paginateOptions?: PaginateOptions,
  ): AsyncGenerator<PcoPage<T>> {
    const perPage = Math.min(PCO_MAX_PER_PAGE, Math.max(1, paginateOptions?.perPage ?? PCO_MAX_PER_PAGE));
    const maxPages = paginateOptions?.maxPages ?? defaultMaxPages;

    let url: string | null = toUrl(path, { ...query, per_page: perPage, offset: 0 });
    let offset = 0;
    const seenUrls = new Set<string>();

    for (let pageIndex = 0; url !== null; pageIndex += 1) {
      if (pageIndex >= maxPages) {
        throw new Error(
          `Planning Center pagination for ${path} exceeded ${maxPages} pages; refusing to continue.`,
        );
      }
      if (seenUrls.has(url)) {
        // A repeated cursor means the server is handing back the same page.
        // Stopping is safer than looping until the function times out.
        return;
      }
      seenUrls.add(url);

      const body: JsonApiBody<T[]> = await requestUrl<T[]>('GET', url);
      const data = Array.isArray(body.data) ? body.data : [];
      yield { data, included: body.included ?? [], meta: body.meta ?? {}, pageIndex };

      if (data.length === 0) return;

      const nextLink = body.links?.next;
      const nextOffset = body.meta?.next?.offset;

      if (typeof nextLink === 'string' && nextLink.length > 0) {
        url = nextLink;
      } else if (typeof nextOffset === 'number' && nextOffset > offset) {
        offset = nextOffset;
        url = toUrl(path, { ...query, per_page: perPage, offset });
      } else if (data.length >= perPage) {
        // A *full* page with no cursor is ambiguous, and the two readings have
        // very different costs: guessing "that was the end" silently truncates
        // the roster — students simply vanish from Tally with no error anywhere
        // — while guessing "there is more" costs one extra request that returns
        // nothing. So we step the offset ourselves. `maxPages` and the
        // already-seen-cursor check above still bound the loop.
        offset += perPage;
        url = toUrl(path, { ...query, per_page: perPage, offset });
      } else {
        // A short page is unambiguous: there was nothing more to send.
        url = null;
      }
    }
  }

  return {
    get<TData>(path: string, query?: PcoQuery): Promise<JsonApiBody<TData>> {
      return requestUrl<TData>('GET', toUrl(path, query));
    },
    post<TData>(path: string, body: unknown): Promise<JsonApiBody<TData>> {
      return requestUrl<TData>('POST', toUrl(path), body);
    },
    patch<TData>(path: string, body: unknown): Promise<JsonApiBody<TData>> {
      return requestUrl<TData>('PATCH', toUrl(path), body);
    },
    paginate,
  };
}
