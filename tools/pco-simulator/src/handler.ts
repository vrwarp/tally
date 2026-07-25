/**
 * The HTTP surface: routing, JSON:API projection, pagination and errors.
 *
 * This implements the slice of Planning Center People that Tally actually
 * calls. It is deliberately faithful about the awkward parts — the `included`
 * side-loading rules, the fact that a household's people arrive without their
 * emails, the 429 with `Retry-After` — because those are the parts the client
 * has code to handle, and a simulator that smooths them over would test nothing.
 */
import type { SimPerson, SimRequest, SimResponse } from './types.js';
import type { SimulatorStore } from './store.js';

/* -------------------------------------------------------------------------- */
/* Query parsing                                                               */
/* -------------------------------------------------------------------------- */

export type QueryNode = string | { [key: string]: QueryNode };

/**
 * Parses `where[updated_at][gt]=2026-01-01&include=emails,households` into a
 * nested object. The inverse of the client's `buildQueryString`, including its
 * habit of leaving bracket characters unescaped.
 */
export function parseQuery(raw: string): Record<string, QueryNode> {
  const result: Record<string, QueryNode> = {};
  if (!raw) return result;

  for (const pair of raw.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));

    const segments = splitKey(decodeURIComponent(rawKey));
    let cursor: Record<string, QueryNode> = result;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i]!;
      const next = cursor[segment];
      if (typeof next !== 'object') cursor[segment] = {};
      cursor = cursor[segment] as Record<string, QueryNode>;
    }
    cursor[segments[segments.length - 1]!] = value;
  }

  return result;
}

function splitKey(key: string): string[] {
  const match = /^([^[]+)((\[[^\]]*\])*)$/.exec(key);
  if (!match) return [key];
  const head = match[1]!;
  const rest = match[2] ?? '';
  const brackets = [...rest.matchAll(/\[([^\]]*)\]/g)].map((m) => decodeURIComponent(m[1] ?? ''));
  return [head, ...brackets];
}

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

/* -------------------------------------------------------------------------- */
/* Filtering                                                                   */
/* -------------------------------------------------------------------------- */

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Applies the `where[...]` clauses Tally uses. Unknown clauses are ignored, in
 * line with the real API, which quietly drops filters it does not recognise.
 */
export function applyWhere(
  people: readonly SimPerson[],
  where: Record<string, QueryNode>,
): SimPerson[] {
  let result = [...people];

  const child = scalar(where.child);
  if (child !== undefined) {
    const wanted = child === 'true';
    result = result.filter((person) => person.child === wanted);
  }

  const grade = scalar(where.grade);
  if (grade !== undefined) {
    const wanted = Number(grade);
    result = result.filter((person) => person.grade === wanted);
  }

  const status = scalar(where.status);
  if (status !== undefined) {
    result = result.filter((person) => person.status === status);
  }

  const id = scalar(where.id);
  if (id !== undefined) {
    result = result.filter((person) => person.id === id);
  }

  const searchName = scalar(where.search_name);
  if (searchName !== undefined) {
    const needle = normalizeName(searchName);
    result = result.filter((person) => {
      const full = normalizeName(`${person.first_name} ${person.last_name}`);
      const nick = person.nickname
        ? normalizeName(`${person.nickname} ${person.last_name}`)
        : '';
      return full.includes(needle) || (nick !== '' && nick.includes(needle));
    });
  }

  const updatedAt = nested(where.updated_at);
  const after = scalar(updatedAt.gt);
  if (after) {
    const bound = Date.parse(after);
    result = result.filter((person) => Date.parse(person.updated_at) > bound);
  }
  const atOrAfter = scalar(updatedAt.gte);
  if (atOrAfter) {
    const bound = Date.parse(atOrAfter);
    result = result.filter((person) => Date.parse(person.updated_at) >= bound);
  }

  return result;
}

function applyOrder(people: SimPerson[], order: string | undefined): SimPerson[] {
  if (!order) return [...people].sort((a, b) => a.id.localeCompare(b.id));

  const descending = order.startsWith('-');
  const field = descending ? order.slice(1) : order;

  const compare = (a: SimPerson, b: SimPerson): number => {
    switch (field) {
      case 'updated_at':
        return Date.parse(a.updated_at) - Date.parse(b.updated_at);
      case 'created_at':
        return Date.parse(a.created_at) - Date.parse(b.created_at);
      case 'last_name':
        return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
      case 'first_name':
        return a.first_name.localeCompare(b.first_name);
      case 'grade':
        return (a.grade ?? -1) - (b.grade ?? -1);
      default:
        return a.id.localeCompare(b.id);
    }
  };

  // Ties break on id so pagination cannot drop or repeat a record — the failure
  // an unstable sort produces here looks exactly like a sync bug.
  const sorted = [...people].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id));
  return descending ? sorted.reverse() : sorted;
}

/* -------------------------------------------------------------------------- */
/* JSON:API projection                                                         */
/* -------------------------------------------------------------------------- */

interface Resource {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

function personResource(person: SimPerson, store: SimulatorStore): Resource {
  const households = store.householdsForPerson(person.id);
  return {
    type: 'Person',
    id: person.id,
    attributes: {
      first_name: person.first_name,
      last_name: person.last_name,
      nickname: person.nickname,
      given_name: person.given_name,
      name: `${person.first_name} ${person.last_name}`,
      grade: person.grade,
      graduation_year: person.graduation_year,
      gender: person.gender,
      birthdate: person.birthdate,
      child: person.child,
      medical_notes: person.medical_notes,
      status: person.status,
      inactivated_at: person.inactivated_at,
      people_permissions: person.people_permissions,
      site_administrator: person.site_administrator,
      created_at: person.created_at,
      updated_at: person.updated_at,
    },
    relationships: {
      households: {
        data: households.map((household) => ({ type: 'Household', id: household.id })),
      },
    },
  };
}

function emailResource(email: ReturnType<SimulatorStore['emailsFor']>[number]): Resource {
  return {
    type: 'Email',
    id: email.id,
    attributes: {
      address: email.address,
      location: email.location,
      primary: email.primary,
      blocked: email.blocked,
    },
    relationships: { person: { data: { type: 'Person', id: email.person_id } } },
  };
}

function phoneResource(phone: ReturnType<SimulatorStore['phonesFor']>[number]): Resource {
  return {
    type: 'PhoneNumber',
    id: phone.id,
    attributes: {
      number: phone.number,
      e164: phone.e164,
      location: phone.location,
      primary: phone.primary,
    },
    relationships: { person: { data: { type: 'Person', id: phone.person_id } } },
  };
}

/**
 * Builds the `included` array for a page of people.
 *
 * The one rule worth stating: `households.people` side-loads the *Person*
 * records in a household but not their emails or phone numbers, exactly as the
 * real API behaves. That gap is why the sync makes a second pass over
 * `/households/{id}/household_memberships`, so the simulator must reproduce it
 * rather than helpfully filling it in.
 */
function buildIncluded(
  people: readonly SimPerson[],
  includes: readonly string[],
  store: SimulatorStore,
): Resource[] {
  const wanted = new Set(includes);
  const out = new Map<string, Resource>();
  const add = (resource: Resource) => out.set(`${resource.type}:${resource.id}`, resource);

  for (const person of people) {
    if (wanted.has('emails')) store.emailsFor(person.id).forEach((e) => add(emailResource(e)));
    if (wanted.has('phone_numbers')) {
      store.phonesFor(person.id).forEach((p) => add(phoneResource(p)));
    }

    if (wanted.has('households') || wanted.has('households.people')) {
      for (const household of store.householdsForPerson(person.id)) {
        add({
          type: 'Household',
          id: household.id,
          attributes: {
            name: household.name,
            member_count: store.memberCount(household.id),
            primary_contact_id: household.primary_contact_id,
            primary_contact_name: household.primary_contact_name,
          },
          relationships: {
            people: {
              data: store
                .membershipsForHousehold(household.id)
                .map((m) => ({ type: 'Person', id: m.person_id })),
            },
          },
        });

        if (wanted.has('households.people')) {
          for (const membership of store.membershipsForHousehold(household.id)) {
            const member = store.personById(membership.person_id);
            if (member) add(personResource(member, store));
          }
        }
      }
    }

    if (wanted.has('field_data')) {
      for (const datum of store.fieldDataFor(person.id)) {
        add({
          type: 'FieldDatum',
          id: datum.id,
          attributes: { value: datum.value },
          relationships: {
            person: { data: { type: 'Person', id: datum.person_id } },
            field_definition: {
              data: { type: 'FieldDefinition', id: datum.field_definition_id },
            },
          },
        });

        if (wanted.has('field_data.field_definition')) {
          const definition = store.fieldDefinitionById(datum.field_definition_id);
          if (definition) {
            add({
              type: 'FieldDefinition',
              id: definition.id,
              attributes: {
                name: definition.name,
                slug: definition.slug,
                data_type: definition.data_type,
              },
            });
          }
        }
      }
    }
  }

  return [...out.values()];
}

/* -------------------------------------------------------------------------- */
/* Responses                                                                   */
/* -------------------------------------------------------------------------- */

function json(status: number, body: unknown, headers: Record<string, string> = {}): SimResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: JSON.stringify(body),
  };
}

function error(status: number, title: string, detail: string): SimResponse {
  return json(status, {
    errors: [{ status: String(status), title, detail, code: title.toLowerCase().replace(/\s+/g, '_') }],
  });
}

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

const PERSON_PATH = /^\/people\/([^/]+)$/;
const LIST_PEOPLE_PATH = /^\/lists\/([^/]+)\/people$/;
const HOUSEHOLD_MEMBERSHIPS_PATH = /^\/households\/([^/]+)\/household_memberships$/;

function checkAuth(request: SimRequest, store: SimulatorStore): SimResponse | null {
  const header = request.authorization ?? '';
  if (!header.toLowerCase().startsWith('basic ')) {
    return error(401, 'Unauthorized', 'A Personal Access Token is required.');
  }
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const appId = separator === -1 ? decoded : decoded.slice(0, separator);
  const secret = separator === -1 ? '' : decoded.slice(separator + 1);

  if (appId !== store.appId || secret !== store.secret) {
    return error(401, 'Unauthorized', 'The Personal Access Token was not recognised.');
  }
  return null;
}

/**
 * Serves one request. Pure with respect to HTTP: it takes a parsed request and
 * returns a response, so the same function backs both the injected `fetch` used
 * by unit tests and the `node:http` server used by the end-to-end suite.
 */
export function handleRequest(request: SimRequest, store: SimulatorStore): SimResponse {
  const response = route(request, store);
  store.requestLog.push({
    method: request.method,
    path: request.path,
    query: request.query,
    status: response.status,
  });
  return response;
}

function route(request: SimRequest, store: SimulatorStore): SimResponse {
  // Health check answers before auth so a container orchestrator can probe it.
  if (request.path === '/_health') {
    return json(200, { ok: true, people: store.people.length });
  }

  const fault = store.takeFault();
  if (fault) {
    return json(
      fault.status,
      { errors: [{ status: String(fault.status), title: fault.message, detail: fault.message }] },
      fault.retryAfter !== undefined ? { 'retry-after': String(fault.retryAfter) } : {},
    );
  }

  const unauthorized = checkAuth(request, store);
  if (unauthorized) return unauthorized;

  const query = parseQuery(request.query);
  const method = request.method.toUpperCase();

  if (method === 'GET' && request.path === '/people') {
    return servePeople(collectionFor(query, store), query, store, request.path);
  }

  const listMatch = LIST_PEOPLE_PATH.exec(request.path);
  if (method === 'GET' && listMatch) {
    const list = store.listById(decodeURIComponent(listMatch[1]!));
    if (!list) return error(404, 'Not Found', `No list with id "${listMatch[1]}".`);
    const members = list.member_ids
      .map((id) => store.personById(id))
      .filter((person): person is SimPerson => person !== undefined);
    return servePeople(members, query, store, request.path);
  }

  const personMatch = PERSON_PATH.exec(request.path);
  if (method === 'GET' && personMatch) {
    const person = store.personById(decodeURIComponent(personMatch[1]!));
    if (!person) return error(404, 'Not Found', `No person with id "${personMatch[1]}".`);
    return json(200, {
      data: personResource(person, store),
      included: buildIncluded([person], csv(query.include), store),
    });
  }

  const membershipMatch = HOUSEHOLD_MEMBERSHIPS_PATH.exec(request.path);
  if (method === 'GET' && membershipMatch) {
    return serveMemberships(decodeURIComponent(membershipMatch[1]!), query, store);
  }

  if (method === 'POST' && request.path === '/people') {
    const attributes = extractAttributes(request.body);
    if (!attributes) return error(400, 'Bad Request', 'Expected a JSON:API document with data.attributes.');
    if (!String(attributes.first_name ?? '').trim() || !String(attributes.last_name ?? '').trim()) {
      return error(422, 'Unprocessable Entity', 'first_name and last_name are required.');
    }
    const created = store.createPerson(attributes);
    return json(201, { data: personResource(created, store) });
  }

  if (method === 'PATCH' && personMatch) {
    const attributes = extractAttributes(request.body);
    if (!attributes) return error(400, 'Bad Request', 'Expected a JSON:API document with data.attributes.');
    const updated = store.updatePerson(decodeURIComponent(personMatch[1]!), attributes);
    if (!updated) return error(404, 'Not Found', `No person with id "${personMatch[1]}".`);
    return json(200, { data: personResource(updated, store) });
  }

  return error(404, 'Not Found', `${method} ${request.path} is not implemented by the simulator.`);
}

function extractAttributes(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const attributes = (data as { attributes?: unknown }).attributes;
  if (!attributes || typeof attributes !== 'object') return null;
  return attributes as Record<string, unknown>;
}

/** `GET /people` honours both `filter=` and `where[...]`. */
function collectionFor(
  query: Record<string, QueryNode>,
  store: SimulatorStore,
): readonly SimPerson[] {
  const filters = csv(query.filter);

  if (filters.includes('admins') || filters.includes('organization_admins')) {
    return store.people.filter((person) => person.site_administrator);
  }
  return store.people;
}

function servePeople(
  candidates: readonly SimPerson[],
  query: Record<string, QueryNode>,
  store: SimulatorStore,
  selfPath: string,
): SimResponse {
  const filtered = applyWhere(candidates, nested(query.where));
  const ordered = applyOrder(filtered, scalar(query.order));

  const requestedPerPage = Number(scalar(query.per_page) ?? store.pageSize);
  const perPage = Math.max(
    1,
    Math.min(store.pageSize, Number.isFinite(requestedPerPage) ? requestedPerPage : store.pageSize),
  );
  const offset = Math.max(0, Number(scalar(query.offset) ?? 0) || 0);

  const page = ordered.slice(offset, offset + perPage);
  const nextOffset = offset + perPage;
  const hasMore = nextOffset < ordered.length;

  const body: Record<string, unknown> = {
    links: { self: `${selfPath}?offset=${offset}` },
    data: page.map((person) => personResource(person, store)),
    included: buildIncluded(page, csv(query.include), store),
    meta: {
      total_count: ordered.length,
      count: page.length,
      can_order_by: ['updated_at', 'created_at', 'last_name', 'first_name', 'grade'],
    },
  };

  if (hasMore) {
    // `short-page` advertises nothing and relies on the client noticing a full
    // page followed by a short one — the least forgiving of the three shapes.
    if (store.pagination === 'links') {
      (body.links as Record<string, string>).next = `${selfPath}?offset=${nextOffset}`;
    } else if (store.pagination === 'meta') {
      (body.meta as Record<string, unknown>).next = { offset: nextOffset };
    }
  }

  return json(200, body);
}

/**
 * `GET /households/{id}/household_memberships`.
 *
 * This is the endpoint that carries `household_role`, and with
 * `include=person,person.emails,person.phone_numbers` it is the only way to get
 * a parent's contact details in one place.
 */
function serveMemberships(
  householdId: string,
  query: Record<string, QueryNode>,
  store: SimulatorStore,
): SimResponse {
  const household = store.householdById(householdId);
  if (!household) return error(404, 'Not Found', `No household with id "${householdId}".`);

  const memberships = store.membershipsForHousehold(householdId);
  const includes = new Set(csv(query.include));
  const included: Resource[] = [];
  const seen = new Set<string>();
  const add = (resource: Resource) => {
    const key = `${resource.type}:${resource.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    included.push(resource);
  };

  for (const membership of memberships) {
    const person = store.personById(membership.person_id);
    if (!person) continue;
    if (includes.has('person')) add(personResource(person, store));
    if (includes.has('person.emails')) {
      store.emailsFor(person.id).forEach((email) => add(emailResource(email)));
    }
    if (includes.has('person.phone_numbers')) {
      store.phonesFor(person.id).forEach((phone) => add(phoneResource(phone)));
    }
  }

  return json(200, {
    links: { self: `/households/${householdId}/household_memberships` },
    data: memberships.map((membership) => ({
      type: 'HouseholdMembership',
      id: membership.id,
      attributes: {
        household_role: membership.household_role,
        person_name: membership.person_name,
        pending: membership.pending,
      },
      relationships: {
        person: { data: { type: 'Person', id: membership.person_id } },
        household: { data: { type: 'Household', id: householdId } },
      },
    })),
    included,
    meta: { total_count: memberships.length, count: memberships.length },
  });
}
