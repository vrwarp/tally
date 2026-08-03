/**
 * Reading people out of an Attendees server, on demand.
 *
 * The same two-question split as the Planning Center flows: who is on the
 * roster is Tally's (`students/` documents); what those people are called is
 * the backend's, asked when needed and held for at most `cacheTtlSeconds`.
 * Nothing here writes to Firestore, and nothing here stores a name, a grade
 * or a parent's phone number.
 *
 * The read shape differs from Planning Center in one structural way: the
 * `datagrid_data_attendee` sweep returns whole attendees — contacts, family
 * edges and all riding on each row — so the roster, the allergy notes and
 * the who-can-be-reached question are all answered from one cached sweep
 * instead of three differently-shaped queries.
 */
import type { A32Config } from '../config.js';
import { cacheKey, type TtlCache } from '../pco/cache.js';
import type { ParentContactStatus, PersonDetails, PersonSearchResult, RosterPerson, RosterResult } from '../pco/roster.js';
import { studentIdFor } from '../generated/backendIds.js';
import { isA32GoneError, type A32Client } from './client.js';
import {
  a32Grade,
  allergiesOf,
  contactsOf,
  displayFirstNameOf,
  findParentCandidates,
  fullBirthdayOf,
  mapAttendeeToRosterPerson,
  parentContactOf,
  statusOf,
} from './mapping.js';
import { API, type A32Attendee, type A32FolkAttendee, type A32Relation } from './types.js';

export interface A32FlowOptions {
  client: A32Client;
  config: A32Config;
  cache: TtlCache;
  now?: Date;
  force?: boolean;
}

/**
 * People fetched one at a time when the sweep did not carry them — a row
 * soft-deleted upstream, mostly. Same cap and same reasoning as the Planning
 * Center roster: past it the remaining ids are reported, never dropped.
 */
const MAX_INDIVIDUAL_LOOKUPS = 60;

/** Search results: enough to choose from, few enough for a phone. */
const MAX_SEARCH_RESULTS = 25;

/* -------------------------------------------------------------------------- */
/* The cached sweeps                                                           */
/* -------------------------------------------------------------------------- */

export function orgSweepCacheKey(baseUrl: string): string {
  return cacheKey({ kind: 'a32-org', base: baseUrl });
}

export function relationsCacheKey(baseUrl: string): string {
  return cacheKey({ kind: 'a32-relations', base: baseUrl });
}

export function personDetailsCacheKey(baseUrl: string, personId: string): string {
  return cacheKey({ kind: 'a32-person', base: baseUrl, id: personId });
}

/** The whole organization, one paginated sweep, indexed by attendee id. */
async function sweepOrganization(client: A32Client): Promise<Map<string, A32Attendee>> {
  const byId = new Map<string, A32Attendee>();
  for await (const page of client.paginate<A32Attendee>(API.attendee)) {
    for (const attendee of page.data) byId.set(attendee.id, attendee);
  }
  return byId;
}

function cachedSweep(options: A32FlowOptions): Promise<Map<string, A32Attendee>> {
  return options.cache.get(
    orgSweepCacheKey(options.config.baseUrl),
    () => sweepOrganization(options.client),
    options.force,
  );
}

/**
 * The relation vocabulary, cached. Reference data that changes on the scale
 * of never, but the TTL keeps it honest anyway.
 */
function cachedRelations(options: A32FlowOptions): Promise<Map<number, A32Relation>> {
  return options.cache.get(
    relationsCacheKey(options.config.baseUrl),
    async () => {
      const byId = new Map<number, A32Relation>();
      for await (const page of options.client.paginate<A32Relation>(API.relations)) {
        for (const relation of page.data) byId.set(relation.id, relation);
      }
      return byId;
    },
    options.force,
  );
}

/* -------------------------------------------------------------------------- */
/* The roster                                                                  */
/* -------------------------------------------------------------------------- */

export async function fetchRoster(
  options: A32FlowOptions & { personIds: readonly string[] },
): Promise<RosterResult> {
  const { cache, config } = options;
  const now = options.now ?? new Date();
  const wanted = [...new Set(options.personIds)].sort();

  if (wanted.length === 0) {
    return { people: [], unresolved: [], relinks: [], missing: [], cached: true, fetchedAt: now.toISOString() };
  }

  const before = cache.stats.misses;
  const swept = await cachedSweep(options);

  const people: RosterPerson[] = [];
  const unresolved: string[] = [];
  const missing: string[] = [];

  const stragglers: string[] = [];
  for (const personId of wanted) {
    const attendee = swept.get(personId);
    if (attendee) people.push(mapAttendeeToRosterPerson(attendee, config));
    else stragglers.push(personId);
  }

  for (const personId of stragglers.slice(0, MAX_INDIVIDUAL_LOOKUPS)) {
    try {
      const attendee = await options.client.get<A32Attendee>(API.attendeeById(personId));
      people.push(mapAttendeeToRosterPerson(attendee, config));
    } catch (error) {
      // Soft-deleted upstream is the ordinary case — a thing to report, not a
      // reason to fail the roster. Attendees has no merges, so there is no
      // trail to follow: gone is gone.
      unresolved.push(personId);
      if (isA32GoneError(error)) missing.push(personId);
    }
  }
  unresolved.push(...stragglers.slice(MAX_INDIVIDUAL_LOOKUPS));

  people.sort((a, b) => (a.searchName < b.searchName ? -1 : a.searchName > b.searchName ? 1 : 0));

  return {
    people,
    unresolved,
    relinks: [],
    missing,
    cached: cache.stats.misses === before,
    fetchedAt: now.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

export async function searchPeople(options: {
  client: A32Client;
  config: A32Config;
  query: string;
  limit?: number;
}): Promise<PersonSearchResult[]> {
  const query = options.query.trim();
  if (!query) return [];
  const limit = Math.max(1, Math.min(MAX_SEARCH_RESULTS, options.limit ?? MAX_SEARCH_RESULTS));

  // Never a bare list: `searchValue` narrows server-side against the infos
  // blob, which carries the composed names.
  const results: PersonSearchResult[] = [];
  for await (const page of options.client.paginate<A32Attendee>(API.attendee, {
    searchValue: query,
  })) {
    for (const attendee of page.data) {
      results.push({
        pcoPersonId: attendee.id,
        backendId: 'a32',
        id: studentIdFor('a32', attendee.id),
        firstName: displayFirstNameOf(attendee),
        lastName: attendee.last_name ?? '',
        // What Attendees thinks, unclamped — an adult's blank grade must not
        // render as "6th".
        grade: a32Grade(attendee),
        // Attendees has no child flag; holding a school grade is the closest
        // fact it keeps. Shown, never enforced — same posture as the rest of
        // the picker.
        child: a32Grade(attendee) !== null,
        status: statusOf(attendee),
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* One person, in full                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The family edges around one student, fetched fresh. Uncached inner piece —
 * the write paths must not act on a stale family — with
 * `fetchPersonDetails`'s cache in front of it for the read path.
 */
export async function loadFamilyEdges(
  client: A32Client,
  personId: string,
): Promise<A32FolkAttendee[]> {
  const edges: A32FolkAttendee[] = [];
  for await (const page of client.paginate<A32FolkAttendee>(
    API.folkAttendees,
    { categoryId: 0 },
    { headers: { 'X-Target-Attendee-Id': personId } },
  )) {
    edges.push(...page.data);
  }
  return edges;
}

export async function fetchPersonDetails(
  options: A32FlowOptions & { personId: string },
): Promise<PersonDetails | null> {
  const { client, config, cache, personId } = options;

  return cache.get(
    personDetailsCacheKey(config.baseUrl, personId),
    async () => {
      let attendee: A32Attendee;
      try {
        attendee = await client.get<A32Attendee>(API.attendeeById(personId));
      } catch (error) {
        if (isA32GoneError(error)) return null;
        throw error;
      }

      const [edges, relations] = await Promise.all([
        loadFamilyEdges(client, personId),
        cachedRelations(options),
      ]);
      const candidates = findParentCandidates(personId, edges, relations);

      let contact = { parentName: null as string | null, parentPhone: null as string | null, parentEmail: null as string | null };
      for (const candidate of candidates) {
        let parent: A32Attendee;
        try {
          parent = await client.get<A32Attendee>(API.attendeeById(candidate.id));
        } catch (error) {
          if (isA32GoneError(error)) continue;
          throw error;
        }
        const extracted = parentContactOf(parent);
        // The first candidate names the parent; the first with a way to reach
        // them supplies the contact. Usually the same person.
        if (!contact.parentName) contact = { ...contact, parentName: extracted.parentName };
        if (extracted.parentPhone || extracted.parentEmail) {
          contact = {
            parentName: contact.parentName ?? extracted.parentName,
            parentPhone: extracted.parentPhone,
            parentEmail: extracted.parentEmail,
          };
          break;
        }
      }

      return {
        pcoPersonId: personId,
        allergies: allergiesOf(attendee),
        // The whole date, year included where Attendees holds a real one —
        // the one-person read is allowed what the roster deliberately is not.
        birthdate: fullBirthdayOf(attendee),
        ...contact,
        householdAdult: candidates.length > 0,
      };
    },
    options.force,
  );
}

/* -------------------------------------------------------------------------- */
/* Allergy notes                                                               */
/* -------------------------------------------------------------------------- */

export async function fetchAllergyNotes(
  options: A32FlowOptions & { personIds: readonly string[] },
): Promise<Record<string, string>> {
  const wanted = new Set(options.personIds);
  if (wanted.size === 0) return {};

  // The note rides on the attendee row, so the cached sweep answers for
  // everyone at once — cheaper than Planning Center's request per person.
  const swept = await cachedSweep(options);
  const notes: Record<string, string> = {};
  for (const personId of wanted) {
    const attendee = swept.get(personId);
    const note = attendee ? allergiesOf(attendee) : null;
    if (note !== null) notes[personId] = note;
  }
  return notes;
}

/* -------------------------------------------------------------------------- */
/* Who can be reached                                                          */
/* -------------------------------------------------------------------------- */

export async function fetchParentContactStatus(
  options: A32FlowOptions & { personIds: readonly string[] },
): Promise<ParentContactStatus> {
  const { cache } = options;
  const now = options.now ?? new Date();
  const wanted = [...new Set(options.personIds)];

  const before = cache.stats.misses;
  const [swept, relations] = await Promise.all([cachedSweep(options), cachedRelations(options)]);

  // Family edges ride on every swept row, so the folk -> members index is
  // free — this is the sweep the Planning Center side has to do as its own
  // second query.
  const membersByFolk = new Map<string, A32FolkAttendee[]>();
  for (const attendee of swept.values()) {
    for (const edge of attendee.folkattendee_set ?? []) {
      if (edge.is_removed === true) continue;
      const existing = membersByFolk.get(edge.folk.id);
      if (existing) existing.push(edge);
      else membersByFolk.set(edge.folk.id, [edge]);
    }
  }

  const reachable: Record<string, boolean> = {};
  const unresolved: string[] = [];
  for (const personId of wanted) {
    const attendee = swept.get(personId);
    if (!attendee) {
      unresolved.push(personId);
      continue;
    }
    const ownEdges = attendee.folkattendee_set ?? [];
    const familyEdges = ownEdges
      .flatMap((edge) => membersByFolk.get(edge.folk.id) ?? [])
      .filter((edge, index, all) => all.findIndex((other) => other.id === edge.id) === index);
    const candidates = findParentCandidates(personId, familyEdges, relations);
    reachable[studentIdFor('a32', personId)] = candidates.some((candidate) => {
      const parent = swept.get(candidate.id);
      if (!parent) return false;
      const { phone, email } = contactsOf(parent);
      return phone !== null || email !== null;
    });
  }

  return {
    reachable,
    unresolved,
    cached: cache.stats.misses === before,
    fetchedAt: now.toISOString(),
  };
}
