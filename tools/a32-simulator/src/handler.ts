/**
 * The Attendees API, answered from the store.
 *
 * Faithful where the integration can tell: token auth (401 without), DRF
 * router paths with their trailing slashes, the `{"totalCount", "data"}`
 * envelope with `take`/`skip`, `searchValue` against the infos blob, the
 * X-headers on attendee create, whole-blob `infos` replacement on PATCH, and
 * the SpyGuard viewsets' insistence on `X-Target-Attendee-Id`. Everything the
 * simulator does not model answers 404, loudly.
 */
import {
  ATTENDANCE_CATEGORIES,
  FAMILY_CATEGORY,
  HIDDEN_ROLE,
  type A32SimulatorStore,
  type SimAttendance,
  type SimAttendee,
  type SimFolk,
  type SimFolkAttendee,
  type SimGathering,
} from './store.js';
import type {
  AttendanceRow,
  AttendeeRow,
  Envelope,
  FolkAttendeeRow,
  FolkRow,
  GatheringRow,
  MeetRow,
  RelationRow,
  SimRequest,
  SimResponse,
} from './types.js';

function json(status: number, body: unknown): SimResponse {
  return { status, body };
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function paginate<T>(rows: T[], query: SimRequest['query']): Envelope<T> {
  const take = Number.parseInt(first(query.take) ?? '20', 10);
  const skip = Number.parseInt(first(query.skip) ?? '0', 10);
  return {
    totalCount: rows.length,
    data: rows.slice(skip, skip + (Number.isFinite(take) ? take : 20)),
  };
}

/* -------------------------------------------------------------------------- */
/* Serializers                                                                 */
/* -------------------------------------------------------------------------- */

function folkRow(store: A32SimulatorStore, folk: SimFolk): FolkRow {
  return {
    id: folk.id,
    created: folk.createdAt,
    modified: folk.createdAt,
    is_removed: folk.isRemoved,
    division: store.division.id,
    category: folk.category,
    display_name: folk.displayName,
    display_order: 0,
    infos: {},
    places: [],
  };
}

function folkAttendeeRow(store: A32SimulatorStore, edge: SimFolkAttendee): FolkAttendeeRow {
  const folk = store.folks.get(edge.folkId)!;
  return {
    id: edge.id,
    created: folk.createdAt,
    modified: folk.createdAt,
    is_removed: edge.isRemoved,
    folk: folkRow(store, folk),
    attendee: edge.attendeeId,
    role: edge.roleId,
    display_order: 0,
    start: null,
    finish: null,
    infos: {},
    file: null,
    file_path: '',
  };
}

function attendeeRow(store: A32SimulatorStore, attendee: SimAttendee): AttendeeRow {
  const memberships = store.folkAttendees.filter(
    (edge) => edge.attendeeId === attendee.id && !edge.isRemoved,
  );
  const attending = store.attendingOf(attendee.id);
  const meets = attending
    ? store.attendingMeets.filter((row) => row.attendingId === attending.id && !row.isRemoved)
    : [];
  return {
    id: attendee.id,
    created: attendee.created,
    modified: attendee.modified,
    division: store.division.id,
    user: null,
    first_name: attendee.firstName,
    last_name: attendee.lastName,
    first_name2: attendee.firstName2,
    last_name2: attendee.lastName2,
    gender: attendee.gender,
    actual_birthday: attendee.actualBirthday,
    estimated_birthday: attendee.estimatedBirthday,
    deathday: attendee.deathday,
    photo: null,
    infos: attendee.infos,
    organization_slug: store.organization.slug,
    attendingmeets: meets.map((row) => ({
      attendingmeet_id: row.id,
      meet_slug: store.meet.slug,
      attendingmeet_category: 1,
    })),
    folkattendee_set: memberships.map((edge) => folkAttendeeRow(store, edge)),
    folkcities: '',
    visitor_since: null,
    photo_path: '',
    places: [],
  };
}

function relationRow(relation: A32SimulatorStore['relations'][number]): RelationRow {
  return {
    id: relation.id,
    title: relation.title,
    gender: relation.gender,
    emergency_contact: relation.emergencyContact,
    scheduler: relation.scheduler,
    relative: true,
    consanguinity: true,
    display_order: relation.id,
    reciprocal_ids: [],
  };
}

function meetRow(store: A32SimulatorStore): MeetRow {
  return {
    id: store.meet.id,
    slug: store.meet.slug,
    display_name: store.meet.displayName,
    assembly: store.assembly.id,
    assembly_name: store.assembly.displayName,
    major_character: store.character.id,
    start: '2020-01-01T00:00:00Z',
    finish: '2075-01-01T00:00:00Z',
    shown_audience: true,
    audience_editable: false,
    infos: store.meet.infos,
    schedule_rules: [],
  };
}

function gatheringRow(store: A32SimulatorStore, gathering: SimGathering): GatheringRow {
  return {
    id: gathering.id,
    meet: gathering.meetId,
    display_name: gathering.displayName,
    start: gathering.start,
    finish: gathering.finish,
    infos: {},
    gathering_label: `${store.meet.displayName} ${gathering.displayName}`,
    site: '',
  };
}

function attendanceRow(store: A32SimulatorStore, attendance: SimAttendance): AttendanceRow {
  const gathering = store.gatherings.find((row) => row.id === attendance.gatheringId)!;
  const attending = store.attendings.find((row) => row.id === attendance.attendingId)!;
  const attendee = store.attendees.get(attending.attendeeId)!;
  const names = (attendee.infos.names as Record<string, unknown> | undefined) ?? {};
  const fixed = (attendee.infos.fixed as Record<string, unknown> | undefined) ?? {};
  return {
    id: attendance.id,
    gathering: gathering.id,
    attending: attending.id,
    character: attendance.characterId,
    team: null,
    category: attendance.categoryId,
    start: null,
    finish: null,
    display_order: 0,
    infos: {},
    file: null,
    file_path: '',
    attendee_id: attendee.id,
    registrant_attendee_id: null,
    attending__attendee__infos__names__original: String(names.original ?? ''),
    attending__attendee__first_name: attendee.firstName,
    attending__attendee__last_name: attendee.lastName,
    attending__attendee__first_name2: attendee.firstName2,
    attending__attendee__last_name2: attendee.lastName2,
    attending__attendee__infos__fixed__grade:
      fixed.grade === undefined || fixed.grade === null ? null : String(fixed.grade),
    attending__attendee__infos__fixed__food_pref:
      fixed.food_pref === undefined || fixed.food_pref === null ? null : String(fixed.food_pref),
    gathering__display_name: gathering.displayName,
    gathering__meet: gathering.meetId,
    gathering__meet__assembly: store.assembly.id,
    photo: '',
  };
}

/* -------------------------------------------------------------------------- */
/* Routing                                                                     */
/* -------------------------------------------------------------------------- */

const UNAUTHENTICATED = { detail: 'Authentication credentials were not provided.' };

export function handleRequest(store: A32SimulatorStore, request: SimRequest): SimResponse {
  store.requests.push({ method: request.method, path: request.path });

  if (store.down) return json(503, { detail: 'Simulated outage.' });

  const authorization = request.headers.authorization ?? '';
  if (authorization !== `Token ${store.token}`) return json(401, UNAUTHENTICATED);

  const { method, path } = request;
  const segments = path.replace(/^\/+|\/+$/g, '').split('/');

  // DRF's router redirects nothing: a missing trailing slash on a write is a
  // real-world 404 clients hit. Model it so the client's slash discipline is
  // tested rather than trusted.
  if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && !path.endsWith('/')) {
    return json(404, { detail: 'Not found (missing trailing slash).' });
  }

  if (segments[0] === 'persons' && segments[1] === 'api') {
    return personsApi(store, request, segments.slice(2));
  }
  if (segments[0] === 'occasions' && segments[1] === 'api') {
    return occasionsApi(store, request, segments.slice(2));
  }
  return json(404, { detail: `No route for ${method} ${path}` });
}

function activeAttendees(store: A32SimulatorStore): SimAttendee[] {
  return [...store.attendees.values()].filter((attendee) => !attendee.isRemoved);
}

function personsApi(
  store: A32SimulatorStore,
  request: SimRequest,
  segments: string[],
): SimResponse {
  const { method, query, headers } = request;
  const body = (request.body ?? {}) as Record<string, unknown>;
  const [resource, id] = segments;

  if (resource === 'datagrid_data_attendee') {
    if (method === 'GET' && id) {
      const attendee = store.attendees.get(id);
      if (!attendee || attendee.isRemoved) return json(404, { detail: 'Not found.' });
      return json(200, attendeeRow(store, attendee));
    }
    if (method === 'GET') {
      const term = first(query.searchValue)?.toLowerCase();
      let rows = activeAttendees(store);
      if (term) {
        rows = rows.filter((attendee) =>
          JSON.stringify(attendee.infos).toLowerCase().includes(term),
        );
      }
      rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return json(200, paginate(rows.map((attendee) => attendeeRow(store, attendee)), query));
    }
    if (method === 'POST') {
      const attendee = store.createAttendee({
        firstName: (body.first_name as string | null) ?? null,
        lastName: (body.last_name as string | null) ?? null,
        firstName2: (body.first_name2 as string | null) ?? null,
        lastName2: (body.last_name2 as string | null) ?? null,
        gender: (body.gender as SimAttendee['gender']) ?? 'UNSPECIFIED',
        actualBirthday: (body.actual_birthday as string | null) ?? null,
        estimatedBirthday: (body.estimated_birthday as string | null) ?? null,
        infos: (body.infos as Record<string, unknown>) ?? {},
      });

      const rawFolkId = headers['x-add-folk'];
      const roleId = headers['x-folk-role'];
      const meetId = headers['x-join-meet'];
      const characterSlug = headers['x-join-character'];

      if (rawFolkId && roleId) {
        const folk =
          rawFolkId === 'new'
            ? store.createFolk(FAMILY_CATEGORY, `${attendee.lastName ?? ''} family`.trim())
            : store.folks.get(rawFolkId);
        if (!folk) return json(404, { detail: 'No such folk.' });
        store.addFolkAttendee(folk.id, attendee.id, Number.parseInt(roleId, 10));
      }
      if (meetId && Number.parseInt(meetId, 10) === store.meet.id) {
        const character =
          characterSlug === store.character.slug || !characterSlug ? store.character : null;
        if (character) store.joinMeet(attendee.id, store.meet.id, character.id);
      }
      return json(201, attendeeRow(store, attendee));
    }
    if (method === 'PATCH' || method === 'PUT') {
      const target = headers['x-target-attendee-id'];
      if (!target) return json(404, { detail: 'X-Target-Attendee-Id required.' });
      if (!id) return json(404, { detail: 'Not found.' });
      const updated = store.updateAttendee(id, body);
      if (!updated) return json(404, { detail: 'Not found.' });
      return json(200, attendeeRow(store, updated));
    }
  }

  if (resource === 'attendee_families') {
    const target = headers['x-target-attendee-id'];
    if (!target || !store.attendees.get(target)) {
      return json(403, { detail: 'X-Target-Attendee-Id required.' });
    }
    if (method === 'GET') {
      const category = first(query.categoryId);
      let folks = store.familyFolksOf(target);
      if (category !== undefined) {
        folks = folks.filter((folk) => folk.category === Number.parseInt(category, 10));
      }
      return json(200, paginate(folks.map((folk) => folkRow(store, folk)), query));
    }
    if (method === 'POST') {
      const folk = store.createFolk(
        typeof body.category === 'number' ? body.category : FAMILY_CATEGORY,
        String(body.display_name ?? 'family'),
      );
      return json(201, folkRow(store, folk));
    }
  }

  if (resource === 'datagrid_data_familyattendees' || resource === 'attendee_relationships') {
    const target = headers['x-target-attendee-id'];
    if (!target || !store.attendees.get(target)) {
      return json(403, { detail: 'X-Target-Attendee-Id required.' });
    }
    if (method === 'GET') {
      const folkIds = new Set(store.familyFolksOf(target).map((folk) => folk.id));
      const category = first(query.categoryId);
      let edges = store.folkAttendees.filter(
        (edge) => folkIds.has(edge.folkId) && !edge.isRemoved && edge.roleId !== HIDDEN_ROLE,
      );
      if (category !== undefined) {
        const wanted = Number.parseInt(category, 10);
        edges = edges.filter((edge) => store.folks.get(edge.folkId)?.category === wanted);
      }
      return json(200, paginate(edges.map((edge) => folkAttendeeRow(store, edge)), query));
    }
    if (method === 'POST') {
      const folk = store.folks.get(String(body.folk ?? ''));
      const attendee = store.attendees.get(String(body.attendee ?? ''));
      const role = Number.parseInt(String(body.role ?? ''), 10);
      if (!folk || !attendee || !Number.isFinite(role)) {
        return json(400, { detail: 'folk, attendee and role are required.' });
      }
      const edge = store.addFolkAttendee(folk.id, attendee.id, role);
      return json(201, folkAttendeeRow(store, edge));
    }
  }

  if (resource === 'all_relations' && method === 'GET') {
    const rows = store.relations
      .filter((relation) => relation.id !== HIDDEN_ROLE)
      .map(relationRow);
    return json(200, paginate(rows, query));
  }

  if (resource === 'attendee_attendings' && method === 'GET') {
    const target = headers['x-target-attendee-id'];
    if (!target || !store.attendees.get(target)) return json(404, { detail: 'Not found.' });
    const rows = store.attendings
      .filter((attending) => attending.attendeeId === target)
      .map((attending) => ({
        id: attending.id,
        created: '2020-01-01T00:00:00Z',
        modified: '2020-01-01T00:00:00Z',
        attendee: attending.attendeeId,
        category: attending.category,
        registration: null,
        price: null,
      }));
    return json(200, paginate(rows, query));
  }

  if (resource === 'default_attendingmeets' && method === 'PUT') {
    const target = headers['x-target-attendee-id'];
    if (!target || !store.attendees.get(target)) return json(403, { detail: 'No target attendee.' });
    const action = String(body.action ?? '');
    const meetSlug = String(body.meet ?? '');
    if (meetSlug !== store.meet.slug) return json(404, { detail: 'No such meet.' });
    if (action === 'join') {
      const row = store.joinMeet(target, store.meet.id, store.character.id);
      return json(200, { action, attendingmeet: row.id });
    }
    if (action === 'leave') {
      const attending = store.attendingOf(target);
      for (const row of store.attendingMeets) {
        if (attending && row.attendingId === attending.id && row.meetId === store.meet.id) {
          row.isRemoved = true;
        }
      }
      return json(200, { action });
    }
    return json(400, { detail: 'action must be join or leave.' });
  }

  return json(404, { detail: `No persons route for ${method} ${request.path}` });
}

function occasionsApi(
  store: A32SimulatorStore,
  request: SimRequest,
  segments: string[],
): SimResponse {
  const { method, query } = request;
  const [resource] = segments;

  if (resource === 'organization_meets' && method === 'GET') {
    const assemblies = many(query['assemblies[]']).map((value) => Number.parseInt(value, 10));
    const rows =
      assemblies.length === 0 || assemblies.includes(store.assembly.id) ? [meetRow(store)] : [];
    return json(200, paginate(rows, query));
  }

  if (resource === 'organization_team_gatherings' && method === 'GET') {
    const meets = many(query['meets[]']);
    const start = first(query.start);
    const finish = first(query.finish);
    // One meet in the simulated org, so the filter is all-or-nothing.
    let rows = meets.length === 0 || meets.includes(store.meet.slug) ? [...store.gatherings] : [];
    // Overlap, not containment — the app's own semantics.
    if (start) rows = rows.filter((gathering) => gathering.finish >= start);
    if (finish) rows = rows.filter((gathering) => gathering.start <= finish);
    rows = [...rows].sort((a, b) => (a.start < b.start ? -1 : 1));
    return json(200, paginate(rows.map((gathering) => gatheringRow(store, gathering)), query));
  }

  if (resource === 'organization_meet_character_attendances' && method === 'GET') {
    const meets = many(query['meets[]']);
    const start = first(query.start);
    const finish = first(query.finish);
    const byGathering = new Map(store.gatherings.map((gathering) => [gathering.id, gathering]));
    let rows = store.attendances.filter((attendance) => {
      const gathering = byGathering.get(attendance.gatheringId);
      if (!gathering) return false;
      if (meets.length > 0 && !meets.includes(store.meet.slug)) return false;
      if (start && gathering.finish < start) return false;
      if (finish && gathering.start > finish) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => a.id - b.id);
    return json(200, paginate(rows.map((attendance) => attendanceRow(store, attendance)), query));
  }

  return json(404, { detail: `No occasions route for ${method} ${request.path}` });
}

export { ATTENDANCE_CATEGORIES };
