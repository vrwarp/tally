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

/** What went out on the wire, with the credential taken back out of it. */
export interface PcoRequestTrace {
  method: string;
  url: string;
  /** As sent, except `Authorization`, which is replaced with `REDACTED`. */
  headers: Record<string, string>;
  /** Sends made for this request, including the first. */
  attempts: number;
}

/** What came back, far enough to explain a failure without keeping the body. */
export interface PcoResponseTrace {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** The raw body, truncated to `MAX_TRACE_BODY_CHARS`. */
  body: string;
  bodyTruncated: boolean;
  /** Wall-clock for the final attempt only, which is the one that failed. */
  durationMs: number;
}

/**
 * Stands in for the Personal Access Token wherever a trace would otherwise
 * carry it. Every path out of this module is a path towards somebody's screen.
 */
export const REDACTED = '[redacted]';

/** Enough of a 500 page to recognise it; short enough to travel in an error. */
const MAX_TRACE_BODY_CHARS = 4000;

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
    // Nothing here is a Tally credential, but a cookie is a credential of
    // somebody's and has no business explaining an outage.
    if (key.toLowerCase() === 'set-cookie') return;
    headers[key] = value;
  });
  return headers;
}

export class PcoApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly errors: PcoErrorDetail[];
  /** Populated from `Retry-After` on a 429, so a caller can report the wait. */
  readonly retryAfterMs: number | null;
  /**
   * The exchange that failed, for a screen that offers to show it.
   *
   * Optional because the class is also constructed in tests and by callers that
   * have a status and nothing else; a missing trace reads as "not recorded"
   * rather than as an empty request.
   */
  readonly request: PcoRequestTrace | null;
  readonly response: PcoResponseTrace | null;

  constructor(
    status: number,
    path: string,
    errors: PcoErrorDetail[],
    retryAfterMs: number | null = null,
    trace?: { request?: PcoRequestTrace; response?: PcoResponseTrace },
  ) {
    const detail = errors.map((error) => error.detail ?? error.title).filter(Boolean).join('; ');
    super(`Planning Center ${status} for ${path}${detail ? `: ${detail}` : ''}`);
    this.name = 'PcoApiError';
    this.status = status;
    this.path = path;
    this.errors = errors;
    this.retryAfterMs = retryAfterMs;
    this.request = trace?.request ?? null;
    this.response = trace?.response ?? null;
  }
}

/**
 * A request that never became a response: DNS, TLS, a socket reset, a timeout.
 *
 * Worth its own class because the two failures need different words in front of
 * a volunteer — "Planning Center said no" and "we could not get there" — and
 * because there is no status line to hang the second one on. The underlying
 * error is kept as `cause` so the reason still reaches a debug panel.
 */
export class PcoNetworkError extends Error {
  readonly request: PcoRequestTrace;
  override readonly cause: unknown;

  constructor(request: PcoRequestTrace, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Could not reach Planning Center at ${request.url}: ${reason}`);
    this.name = 'PcoNetworkError';
    this.request = request;
    this.cause = cause;
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

interface FailureBody {
  errors: PcoErrorDetail[];
  text: string;
  truncated: boolean;
}

/**
 * Reads a failed response once, as text, and parses what it can from it.
 *
 * Text rather than `json()` because the bodies that most need explaining are
 * exactly the ones that are not JSON — a gateway timeout, a WAF block, an HTML
 * error page from something in front of the API. An empty `errors` list beside
 * a body somebody can read is more honest than either alone.
 */
async function readFailureBody(response: Response): Promise<FailureBody> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { errors: [], text: '', truncated: false };
  }

  let errors: PcoErrorDetail[] = [];
  try {
    const body = JSON.parse(text) as PcoErrorBody;
    if (Array.isArray(body?.errors)) errors = body.errors;
  } catch {
    // Not JSON. The text is still the most useful thing we have.
  }

  return {
    errors,
    text: text.slice(0, MAX_TRACE_BODY_CHARS),
    truncated: text.length > MAX_TRACE_BODY_CHARS,
  };
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

    const headers: Record<string, string> = {
      Authorization: authorization,
      Accept: 'application/json',
      'User-Agent': options.userAgent ?? 'Tally/1.0 (Footprints attendance)',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    };
    const traceRequest = (attempt: number): PcoRequestTrace => ({
      method,
      url,
      headers: redactHeaders(headers),
      attempts: attempt + 1,
    });

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
        // DNS blips and socket resets look nothing like an HTTP status but are
        // exactly as transient, so they share the backoff.
        lastError = error;
        if (attempt === maxRetries) throw new PcoNetworkError(traceRequest(attempt), error);
        await sleep(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt));
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return { data: undefined as TData };
        return (await response.json()) as JsonApiBody<TData>;
      }

      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'), now());

      const apiError = async (): Promise<PcoApiError> => {
        const failure = await readFailureBody(response);
        return new PcoApiError(response.status, url, failure.errors, retryAfterMs, {
          request: traceRequest(attempt),
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: readResponseHeaders(response),
            body: failure.text,
            bodyTruncated: failure.truncated,
            durationMs: Math.max(0, now().getTime() - startedAt),
          },
        });
      };

      if (!isRetryableStatus(response.status)) throw await apiError();

      if (attempt === maxRetries) throw await apiError();

      // Planning Center's own advice wins over our guess; the exponential curve
      // is only the floor for a 5xx that arrives without a header.
      await sleep(retryAfterMs ?? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt));
    }

    /* c8 ignore next -- the loop always returns or throws. */
    throw lastError ?? new Error(`Planning Center request to ${url} failed.`);
  }

  /**
   * Turns whatever `links.next` says into something `fetch` will accept.
   *
   * Planning Center sends that link as a *path* — `/people/v2/people?offset=100`
   * — and Node's `fetch` rejects a relative URL outright, so handing it straight
   * back was a `TypeError: Invalid URL` on page two of every sweep. It only ever
   * bit a roster of more than one page, which is why it survived: page one is
   * built here and is absolute.
   *
   * Resolved against the URL the page came from rather than against `baseUrl`,
   * because that is the one form that handles all three shapes the spec allows
   * — an absolute URL, a path, and a bare `?offset=100` — and because a link is
   * relative to what served it. Returns null rather than throwing when the
   * server sends something unparseable: the caller has other ways to find page
   * two, and all of them beat failing the roster.
   */
  function resolveNextUrl(nextLink: string, currentUrl: string): URL | null {
    try {
      return new URL(nextLink, currentUrl);
    } catch {
      return null;
    }
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
      const resolvedNext: URL | null =
        typeof nextLink === 'string' && nextLink.length > 0 ? resolveNextUrl(nextLink, url) : null;

      if (resolvedNext) {
        // Kept in step with the cursor we are actually following, so that a
        // later page which advertises nothing falls back to stepping from where
        // this walk got to rather than from where it started.
        const linkOffset = Number(resolvedNext.searchParams.get('offset'));
        if (Number.isFinite(linkOffset) && linkOffset > offset) offset = linkOffset;
        url = resolvedNext.toString();
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
