/**
 * The `/check-ins/v2` surface — the slice of the Check-Ins product Tally's
 * history import reads.
 *
 * Check-Ins lives on the same host as People, one path segment over, and it
 * shares the same person store: a check-in's `person` relationship names an id
 * the People API also serves. That shared identity is the fact the import
 * leans its whole design on, so the simulator reproduces it exactly — the
 * people side-loaded here *are* `store.people`.
 *
 * The surface is read-only because the real one is: Planning Center publishes
 * no write endpoint for Check-Ins data, and a simulator that accepted a POST
 * here would be rehearsing a request the real API can only refuse.
 *
 * Routing lives in `handler.ts`, which delegates any path under
 * `/check-ins/v2` to this module *after* the shared auth check and fault
 * injection have run — a 429 scheduled by a test lands on whichever product
 * the next request hits, exactly like the real host's shared rate limiter.
 */
import type { SimulatorStore } from './store.js';
import type {
  SimCheckIn,
  SimCheckInsEvent,
  SimCheckInsPeriod,
  SimRequest,
  SimResponse,
} from './types.js';

export const CHECKINS_BASE_PATH = '/check-ins/v2';

/* -------------------------------------------------------------------------- */
/* Small local plumbing (mirrors handler.ts; kept local so this module reads   */
/* on its own)                                                                 */
/* -------------------------------------------------------------------------- */

type QueryNode = string | { [key: string]: QueryNode };

function scalar(node: QueryNode | undefined): string | undefined {
  return typeof node === 'string' ? node : undefined;
}

function nested(node: QueryNode | undefined): Record<string, QueryNode> {
  return node && typeof node === 'object' ? node : {};
}

function csv(node: QueryNode | undefined): string[] {
  const value = scalar(node);
  return value ? value.split(',').map((part) => part.trim()).filter(Boolean) : [];
}

function json(status: number, body: unknown): SimResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function error(status: number, title: string, detail: string): SimResponse {
  return json(status, {
    errors: [
      { status: String(status), title, detail, code: title.toLowerCase().replace(/\s+/g, '_') },
    ],
  });
}

interface Resource {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

/**
 * The API root this product answers on, derived from the configured People
 * root the same way Tally derives it — so `links.self` and `links.next` point
 * back into `/check-ins/v2` rather than at a path nested inside People's.
 */
function productUrl(store: SimulatorStore): string {
  return `${store.publicUrl.replace(/\/people\/v2$/, '')}${CHECKINS_BASE_PATH}`;
}

/**
 * One page of a collection, with the same three pagination dialects the
 * People half speaks — `links` (relative, what the real API sends),
 * `absolute-links`, and `meta` — driven by the same store option, so a client
 * proven against one dialect on People is proven here too.
 */
function servePage(
  resources: readonly Resource[],
  included: readonly Resource[],
  store: SimulatorStore,
  subPath: string,
  rawQuery: string,
  query: Record<string, QueryNode>,
): SimResponse {
  const requestedPerPage = Number(scalar(query.per_page) ?? store.pageSize);
  const perPage = Math.max(
    1,
    Math.min(store.pageSize, Number.isFinite(requestedPerPage) ? requestedPerPage : store.pageSize),
  );
  const offset = Math.max(0, Number(scalar(query.offset) ?? 0) || 0);

  const page = resources.slice(offset, offset + perPage);
  const nextOffset = offset + perPage;
  const hasMore = nextOffset < resources.length;

  const pageUrl = (at: number): string => {
    const params = new URLSearchParams();
    for (const pair of rawQuery.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      if (key === 'offset') continue;
      params.append(key, eq === -1 ? '' : pair.slice(eq + 1));
    }
    params.append('offset', String(at));
    return `${productUrl(store)}${subPath}?${params
      .toString()
      .replace(/%5B/g, '[')
      .replace(/%5D/g, ']')}`;
  };

  const body: Record<string, unknown> = {
    links: { self: pageUrl(offset) },
    data: page,
    included: [...included],
    meta: { total_count: resources.length, count: page.length },
  };

  if (hasMore) {
    if (store.pagination === 'links' || store.pagination === 'absolute-links') {
      const absolute = pageUrl(nextOffset);
      (body.links as Record<string, string>).next =
        store.pagination === 'absolute-links'
          ? absolute
          : (() => {
              const parsed = new URL(absolute);
              return `${parsed.pathname}${parsed.search}`;
            })();
    } else if (store.pagination === 'meta') {
      (body.meta as Record<string, unknown>).next = { offset: nextOffset };
    }
  }

  return json(200, body);
}

/* -------------------------------------------------------------------------- */
/* JSON:API projection                                                         */
/* -------------------------------------------------------------------------- */

function eventResource(event: SimCheckInsEvent): Resource {
  return {
    type: 'Event',
    id: event.id,
    attributes: {
      name: event.name,
      frequency: event.frequency,
      archived_at: event.archived_at,
      created_at: event.created_at,
      updated_at: event.updated_at,
    },
  };
}

function periodResource(period: SimCheckInsPeriod, store: SimulatorStore): Resource {
  const rows = store
    .checkInsFor(period.event_id)
    .filter((checkIn) => checkIn.event_period_id === period.id);
  return {
    type: 'EventPeriod',
    id: period.id,
    attributes: {
      starts_at: period.starts_at,
      ends_at: period.ends_at,
      note: period.note,
      regular_count: rows.filter((row) => row.kind === 'Regular').length,
      guest_count: rows.filter((row) => row.kind === 'Guest').length,
      volunteer_count: rows.filter((row) => row.kind === 'Volunteer').length,
    },
    relationships: { event: { data: { type: 'Event', id: period.event_id } } },
  };
}

function checkInResource(checkIn: SimCheckIn): Resource {
  return {
    type: 'CheckIn',
    id: checkIn.id,
    attributes: {
      kind: checkIn.kind,
      created_at: checkIn.created_at,
      first_name: checkIn.first_name,
      last_name: checkIn.last_name,
      one_time_guest: checkIn.one_time_guest,
    },
    relationships: {
      event: { data: { type: 'Event', id: checkIn.event_id } },
      event_period: { data: { type: 'EventPeriod', id: checkIn.event_period_id } },
      person: {
        data: checkIn.person_id === null ? null : { type: 'Person', id: checkIn.person_id },
      },
    },
  };
}

/**
 * A person as *Check-Ins* serves them — the same record People serves, in the
 * narrower shape this product uses. Same id, which is the point.
 */
function checkInsPersonResource(personId: string, store: SimulatorStore): Resource | null {
  const person = store.personById(personId);
  if (!person) return null;
  return {
    type: 'Person',
    id: person.id,
    attributes: {
      first_name: person.first_name,
      last_name: person.last_name,
      name: `${person.first_name} ${person.last_name}`.trim(),
      child: person.child,
      grade: person.grade,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

const EVENT_PATH = /^\/events\/([^/]+)$/;
const EVENT_PERIODS_PATH = /^\/events\/([^/]+)\/event_periods$/;
const EVENT_CHECK_INS_PATH = /^\/events\/([^/]+)\/check_ins$/;

/**
 * Serves one request whose path begins with `/check-ins/v2`. Auth and fault
 * injection have already run in `handler.ts`.
 */
export function routeCheckIns(
  request: SimRequest,
  query: Record<string, QueryNode>,
  store: SimulatorStore,
): SimResponse {
  const subPath = request.path.slice(CHECKINS_BASE_PATH.length) || '/';
  const method = request.method.toUpperCase();

  if (method !== 'GET') {
    return error(405, 'Method Not Allowed', 'The Check-Ins API is read-only.');
  }

  if (subPath === '/events') {
    const filters = csv(query.filter);
    let events = [...store.checkInsEvents];
    if (filters.includes('not_archived')) {
      events = events.filter((event) => event.archived_at === null);
    }
    if (filters.includes('archived')) {
      events = events.filter((event) => event.archived_at !== null);
    }

    const order = scalar(query.order) ?? 'name';
    const descending = order.startsWith('-');
    const key = order.replace(/^-/, '');
    events.sort((a, b) => {
      const compared =
        key === 'created_at'
          ? Date.parse(a.created_at) - Date.parse(b.created_at)
          : a.name.localeCompare(b.name);
      return compared || a.id.localeCompare(b.id);
    });
    if (descending) events.reverse();

    return servePage(events.map(eventResource), [], store, subPath, request.query, query);
  }

  const eventMatch = EVENT_PATH.exec(subPath);
  if (eventMatch) {
    const event = store.checkInsEventById(decodeURIComponent(eventMatch[1]!));
    if (!event) return error(404, 'Not Found', `No Check-Ins event with id "${eventMatch[1]}".`);
    return json(200, { data: eventResource(event) });
  }

  const periodsMatch = EVENT_PERIODS_PATH.exec(subPath);
  if (periodsMatch) {
    const event = store.checkInsEventById(decodeURIComponent(periodsMatch[1]!));
    if (!event) return error(404, 'Not Found', `No Check-Ins event with id "${periodsMatch[1]}".`);

    let periods = store.checkInsPeriodsFor(event.id);

    // The one range filter the import sends. Its job upstream is exactly its
    // job here: excluding the dateless period the API genuinely serves.
    const startsAt = nested(nested(query.where).starts_at);
    const gte = scalar(startsAt.gte);
    if (gte !== undefined) {
      const bound = Date.parse(gte);
      periods = periods.filter(
        (period) => period.starts_at !== null && Date.parse(period.starts_at) >= bound,
      );
    }

    // `order=starts_at`, with the dateless ones first — observed real-API
    // behaviour, and the reason the import cannot just take the first row as
    // the earliest gathering.
    periods.sort((a, b) => {
      if (a.starts_at === null && b.starts_at === null) return a.id.localeCompare(b.id);
      if (a.starts_at === null) return -1;
      if (b.starts_at === null) return 1;
      return Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id);
    });

    const includes = new Set(csv(query.include));
    const resources = periods.map((period) => periodResource(period, store));

    const included: Resource[] = [];
    if (includes.has('event_times')) {
      // Scoped to the page below by rebuilding per page — cheaper to scope
      // here: only the page's periods contribute times.
      const requestedPerPage = Number(scalar(query.per_page) ?? store.pageSize);
      const perPage = Math.max(
        1,
        Math.min(
          store.pageSize,
          Number.isFinite(requestedPerPage) ? requestedPerPage : store.pageSize,
        ),
      );
      const offset = Math.max(0, Number(scalar(query.offset) ?? 0) || 0);
      for (const period of periods.slice(offset, offset + perPage)) {
        for (const time of store.checkInsEventTimesFor(period.id)) {
          included.push({
            type: 'EventTime',
            id: time.id,
            attributes: {
              starts_at: time.starts_at,
              shows_at: time.shows_at,
              hides_at: time.hides_at,
              day_of_week: time.day_of_week,
              hour: time.hour,
              minute: time.minute,
            },
            relationships: {
              event_period: { data: { type: 'EventPeriod', id: time.event_period_id } },
            },
          });
        }
      }
    }

    return servePage(resources, included, store, subPath, request.query, query);
  }

  const checkInsMatch = EVENT_CHECK_INS_PATH.exec(subPath);
  if (checkInsMatch) {
    const event = store.checkInsEventById(decodeURIComponent(checkInsMatch[1]!));
    if (!event) {
      return error(404, 'Not Found', `No Check-Ins event with id "${checkInsMatch[1]}".`);
    }

    const filters = csv(query.filter);
    let rows = store.checkInsFor(event.id);
    if (filters.includes('attendee')) rows = rows.filter((row) => row.kind !== 'Volunteer');
    if (filters.includes('regular')) rows = rows.filter((row) => row.kind === 'Regular');
    if (filters.includes('guest')) rows = rows.filter((row) => row.kind === 'Guest');
    if (filters.includes('volunteer')) rows = rows.filter((row) => row.kind === 'Volunteer');

    // `order=created_at` is what the import sends; id is the tiebreak for the
    // same reason as everywhere else — a page boundary must not drop a row.
    rows = [...rows].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id),
    );

    const includes = new Set(csv(query.include));
    const included: Resource[] = [];
    if (includes.has('person')) {
      const requestedPerPage = Number(scalar(query.per_page) ?? store.pageSize);
      const perPage = Math.max(
        1,
        Math.min(
          store.pageSize,
          Number.isFinite(requestedPerPage) ? requestedPerPage : store.pageSize,
        ),
      );
      const offset = Math.max(0, Number(scalar(query.offset) ?? 0) || 0);
      const seen = new Set<string>();
      for (const row of rows.slice(offset, offset + perPage)) {
        if (row.person_id === null || seen.has(row.person_id)) continue;
        seen.add(row.person_id);
        const person = checkInsPersonResource(row.person_id, store);
        if (person) included.push(person);
      }
    }

    return servePage(rows.map(checkInResource), included, store, subPath, request.query, query);
  }

  return error(404, 'Not Found', `GET ${request.path} is not implemented by the simulator.`);
}
