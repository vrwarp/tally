/**
 * Reading people out of Planning Center, on demand.
 *
 * Two questions are easy to run together and are worth keeping apart:
 *
 *   *Who is on the roster* is Tally's. A `students/{id}` document exists for
 *   everyone somebody has put on it, and that document is the decision. It used
 *   to be a Planning Center List, which could not express it: a List is
 *   generated from filter rules, so a hand-picked group of teenagers was only
 *   expressible by inventing a custom field on every person in the church and
 *   filtering on that.
 *
 *   *What those people are called* is Planning Center's. Tally asks when it
 *   needs to know and holds the answer for at most `cacheTtlSeconds` (see
 *   ./cache.ts). Nothing here writes to Firestore, and nothing here stores a
 *   name, a grade or a parent's phone number — that is the entire point, and it
 *   is worth keeping true.
 */
import type { PcoConfig } from '../config.js';
import type { PcoClient } from './client.js';
import { cacheKey, type TtlCache } from './cache.js';
import {
  addToIncludedIndex,
  buildIncludedIndex,
  extractParentContact,
  findParentCandidate,
  hasContactDetails,
  mapPersonToStudent,
  pcoGrade,
  type IncludedIndex,
  type ParentContact,
} from './mapping.js';
import {
  PCO_TYPES,
  type JsonApiIdentifier,
  type PcoHouseholdMembership,
  type PcoPerson,
} from './types.js';

/* -------------------------------------------------------------------------- */
/* Shapes returned to the client                                               */
/* -------------------------------------------------------------------------- */

/**
 * The Planning Center id, in the form Tally uses as a student id everywhere
 * else. Prefixed so it can never collide with the id of a visitor Tally created
 * itself, and so a bare Planning Center id is never mistaken for a Tally one.
 */
export function pcoStudentId(personId: string): string {
  return `pco_${personId}`;
}

/** Inverse of `pcoStudentId`, or null for a Tally-owned id. */
export function personIdFromStudentId(studentId: string): string | null {
  return studentId.startsWith('pco_') ? studentId.slice(4) : null;
}

/**
 * What a counselor standing at a door needs, and nothing else.
 *
 * Explicitly *not* here: parent contact, allergies, address, anything else
 * about a minor. Those are read one person at a time, by someone who has a
 * reason, through `fetchPersonDetails`.
 */
export interface RosterPerson {
  id: string;
  pcoPersonId: string;
  firstName: string;
  lastName: string;
  grade: number;
  status: 'active' | 'inactive';
  searchName: string;
  /**
   * Whether Planning Center holds a way to reach a parent — or `null` for "we
   * did not look".
   *
   * A roster read does not hydrate households, and a parent's phone number
   * lives on the *parent*, not the student. Reporting that absence as `false`
   * made every student on the check-in screen wear an "incomplete profile"
   * badge, which is worse than useless: a warning that fires on everyone is one
   * nobody reads, and it buried the handful of quick-added visitors the badge
   * exists for.
   *
   * `getPersonDetails` knows the real answer for one student at a time.
   */
  profileComplete: boolean | null;
  /**
   * *That* there is an allergy, never what it is. Enough to render the badge
   * that makes a counselor look; the note itself stays behind a detail read.
   */
  hasAllergies: boolean;
}

/** The sensitive fields, fetched only when a screen actually shows them. */
export interface PersonDetails extends ParentContact {
  pcoPersonId: string;
  allergies: string | null;
  /**
   * Whether the student's household holds an adult at all — irrespective of
   * whether anybody has put a phone number on them.
   *
   * This is what separates the two ways a student ends up unreachable, and they
   * are fixed differently: a household with a parent who has no number on file
   * is a number Tally could add, while a student with no household is a family
   * somebody has to build in Planning Center first. Deliberately not the same
   * question as write-back being switched on — that is configuration, decided
   * outside the cache this value is stored in.
   */
  householdAdult: boolean;
}

export interface RosterResult {
  people: RosterPerson[];
  /**
   * Roster entries whose Planning Center person could not be read. Reported so
   * a screen can say "three students are missing" instead of just showing three
   * fewer students.
   */
  unresolved: string[];
  /** True when the answer came from cache rather than from Planning Center. */
  cached: boolean;
  fetchedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/** Everything a roster row needs in one request. */
const ROSTER_INCLUDES = ['emails', 'phone_numbers', 'households'] as const;

/**
 * Households are one request each (JSON:API cannot include
 * `household_memberships` from `/people`), so detail reads are capped. A single
 * student is never near this; a person in a commune-sized household would be.
 */
const MAX_HOUSEHOLD_FETCHES = 8;

/**
 * People fetched one at a time before the roster gives up and says so.
 *
 * The sweep below catches everyone Planning Center has flagged as a child, which
 * is nearly always the whole roster. Anyone else — the graduated senior who
 * still comes, the 5th grader with an older sibling — costs a request each, and
 * that is fine for a handful and ruinous for four hundred. Past this cap the
 * remaining ids are *reported* rather than dropped: a roster quietly missing
 * students is the one failure nobody would notice.
 */
const MAX_INDIVIDUAL_LOOKUPS = 60;

/* -------------------------------------------------------------------------- */
/* The roster                                                                  */
/* -------------------------------------------------------------------------- */

export interface RosterHydration {
  people: RosterPerson[];
  /**
   * Planning Center ids Tally has on its roster but could not read.
   *
   * Deleted upstream, merged into another record, or simply more stragglers
   * than `MAX_INDIVIDUAL_LOOKUPS` allows. Either way the caller has to be able
   * to say so — these are students somebody added on purpose.
   */
  unresolved: string[];
  /**
   * Which households each of them belongs to, keyed by Planning Center person
   * id. Free — a roster read already side-loads `households` — and deliberately
   * kept out of `RosterPerson`, because a counselor at a door has no use for it
   * and this is the module that decides what leaves the server.
   *
   * `fetchParentContactStatus` is the one thing that reads it.
   */
  households: Record<string, string[]>;
}

/**
 * Turns the Planning Center ids on Tally's roster into people.
 *
 * The membership itself is Tally's — a `students/{id}` document exists for
 * everyone on the roster, and that document is the decision somebody made.
 * Planning Center still owns what those people are *called*, and this is where
 * the two meet.
 *
 * Two passes, for cost rather than for correctness. One sweep of
 * `where[child]=true` answers for nearly everybody in a single request per
 * hundred people; whoever is left is fetched individually. Doing it the other
 * way around — a request per student — is four hundred requests against an API
 * that rate-limits, on the path a counselor is waiting on at a door.
 */
async function hydratePeople(
  client: PcoClient,
  config: PcoConfig,
  personIds: readonly string[],
  now: Date,
): Promise<RosterHydration> {
  const wanted = new Set(personIds);
  if (wanted.size === 0) return { people: [], unresolved: [], households: {} };

  const found = new Map<string, PcoPerson>();

  for await (const page of client.paginate<PcoPerson>('/people', {
    include: [...ROSTER_INCLUDES],
    order: 'last_name',
    where: { child: true },
  })) {
    for (const person of page.data) {
      if (wanted.has(person.id)) found.set(person.id, person);
    }
    // Nothing left to look for. The rest of the church is not our business.
    if (found.size === wanted.size) break;
  }

  const stragglers = [...wanted].filter((id) => !found.has(id));
  const unresolved: string[] = [];

  for (const personId of stragglers.slice(0, MAX_INDIVIDUAL_LOOKUPS)) {
    try {
      const body = await client.get<PcoPerson>(`/people/${encodeURIComponent(personId)}`, {
        include: [...ROSTER_INCLUDES],
      });
      const person = Array.isArray(body.data) ? body.data[0] : body.data;
      if (person) found.set(personId, person);
      else unresolved.push(personId);
    } catch {
      // A 404 is the ordinary case here: somebody deleted or merged the person
      // upstream while Tally still has them on the roster. That is a thing to
      // report, not a thing to fail the whole roster over.
      unresolved.push(personId);
    }
  }
  unresolved.push(...stragglers.slice(MAX_INDIVIDUAL_LOOKUPS));

  const people: RosterPerson[] = [];
  const households: Record<string, string[]> = {};
  for (const person of found.values()) {
    households[person.id] = householdIdsOf(person);
    const mapped = mapPersonToStudent(person, {
      minGrade: config.minGrade,
      maxGrade: config.maxGrade,
      now,
    });

    people.push({
      id: pcoStudentId(person.id),
      pcoPersonId: person.id,
      firstName: mapped.firstName,
      lastName: mapped.lastName,
      grade: mapped.grade,
      status: mapped.status,
      searchName: mapped.searchName,
      // Not looked up — see the note on the field. Hydrating households here
      // would be one request per family on the path a counselor waits for at a
      // door.
      profileComplete: null,
      hasAllergies: mapped.allergies !== null && mapped.allergies.length > 0,
    });
  }

  people.sort((a, b) => (a.searchName < b.searchName ? -1 : a.searchName > b.searchName ? 1 : 0));
  return { people, unresolved, households };
}

export interface RosterOptions {
  client: PcoClient;
  config: PcoConfig;
  cache: TtlCache;
  now?: Date;
  /** Skip any held answer and ask Planning Center. See `TtlCache.get`. */
  force?: boolean;
}

/**
 * The roster, as the check-in screen needs it.
 *
 * `personIds` comes from Tally's own membership and is *not* itself cached —
 * only the Planning Center half is. A student added a moment ago changes the
 * set, which changes the cache key, so they appear on the next read instead of
 * whenever the previous answer happens to expire. Membership is Tally's own
 * data and reading it again costs one Firestore query.
 */
export async function fetchRoster(
  options: RosterOptions & { personIds: readonly string[] },
): Promise<RosterResult> {
  const { cache } = options;
  const now = options.now ?? new Date();

  const before = cache.stats.misses;
  const hydrated = await hydratedRoster(options, now);

  return {
    people: hydrated.people,
    unresolved: hydrated.unresolved,
    cached: cache.stats.misses === before,
    fetchedAt: now.toISOString(),
  };
}

/**
 * The cached hydration behind both the roster and the parent-contact status, so
 * asking the second question a moment after the first costs nothing.
 */
function hydratedRoster(
  options: RosterOptions & { personIds: readonly string[] },
  now: Date,
): Promise<RosterHydration> {
  const { client, config, cache } = options;

  const ids = [...new Set(options.personIds)].sort();
  const key = cacheKey({
    kind: 'roster',
    base: config.baseUrl,
    min: config.minGrade,
    max: config.maxGrade,
    ids,
  });

  return cache.get(key, () => hydratePeople(client, config, ids, now), options.force);
}

/* -------------------------------------------------------------------------- */
/* Who can be reached                                                          */
/* -------------------------------------------------------------------------- */

export interface ParentContactStatus {
  /**
   * Tally student id -> whether Planning Center holds a way to reach an adult
   * in that student's household. A student the roster could not resolve is
   * absent rather than `false`: "we could not look" is not "nobody is there".
   */
  reachable: Record<string, boolean>;
  /** Roster entries whose Planning Center person could not be read. */
  unresolved: string[];
  cached: boolean;
  fetchedAt: string;
}

/**
 * The cache entry the church's reachable adults live in.
 *
 * Keyed by base URL alone: the answer is about the church's adults, not about
 * whoever happens to be on Tally's roster this minute. Exported so a write that
 * gives a household its first phone number can drop it — otherwise the
 * "incomplete profiles" list goes on naming a student somebody just fixed.
 */
export function reachableAdultsCacheKey(baseUrl: string): string {
  return cacheKey({ kind: 'reachable-adults', base: baseUrl });
}

/**
 * Which households hold an adult somebody could actually ring, keyed household
 * id -> the ids of the adults in it who have a phone number or an email.
 *
 * One sweep of `where[child]=false`, which is the same shape — and the same
 * cost — as the roster's own sweep of the church's children. The alternative is
 * a request per household, which is what `fetchPersonDetails` does for one
 * student and what nothing may do for four hundred.
 *
 * The ids are kept rather than a bare boolean because a household is shared:
 * a 12th grader flagged as an adult upstream, with their own mobile on file,
 * must not count as their own parent contact.
 *
 * One known gap, and it is the forgiving direction: an adult Planning Center
 * has flagged as a child — a household whose `parent_guardian` is recorded that
 * way — is missed here, though the per-student detail read still finds them
 * through their household role. A rare upstream oddity costs a name on this
 * list, not a name missing from it.
 */
async function sweepReachableAdults(client: PcoClient): Promise<Map<string, string[]>> {
  const byHousehold = new Map<string, string[]>();

  for await (const page of client.paginate<PcoPerson>('/people', {
    include: [...ROSTER_INCLUDES],
    order: 'last_name',
    where: { child: false },
  })) {
    // Per page: the emails and phone numbers side-loaded with it belong to the
    // people on it, and holding the whole church's contact records in one index
    // would be the mirror this module exists to avoid.
    const index = buildIncludedIndex(page.included);

    for (const person of page.data) {
      if (!hasContactDetails(person, index)) continue;
      for (const householdId of householdIdsOf(person)) {
        const existing = byHousehold.get(householdId);
        if (existing) existing.push(person.id);
        else byHousehold.set(householdId, [person.id]);
      }
    }
  }

  return byHousehold;
}

/**
 * Whether each student on the roster has anybody Tally could ring — a boolean
 * each, and nothing else.
 *
 * This is the dashboard's "incomplete profiles" list, and it exists as its own
 * read for two reasons. It must not be on the path a counselor waits for at a
 * door: `fetchRoster` deliberately reports `profileComplete: null`, because
 * hydrating households there would put a second sweep in front of the first
 * name appearing. And it must not hand back contact details to answer a
 * question about their *absence* — the whole list is students nobody can reach,
 * so there is nothing to send.
 */
export async function fetchParentContactStatus(
  options: RosterOptions & { personIds: readonly string[] },
): Promise<ParentContactStatus> {
  const { client, config, cache } = options;
  const now = options.now ?? new Date();

  const before = cache.stats.misses;

  const hydrated = await hydratedRoster(options, now);
  const adults = await cache.get(
    reachableAdultsCacheKey(config.baseUrl),
    () => sweepReachableAdults(client),
    options.force,
  );

  const reachable: Record<string, boolean> = {};
  for (const [personId, householdIds] of Object.entries(hydrated.households)) {
    reachable[pcoStudentId(personId)] = householdIds.some((householdId) =>
      (adults.get(householdId) ?? []).some((adultId) => adultId !== personId),
    );
  }

  return {
    reachable,
    unresolved: hydrated.unresolved,
    cached: cache.stats.misses === before,
    fetchedAt: now.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Searching for somebody to add                                               */
/* -------------------------------------------------------------------------- */

/** One candidate for the "add a student" flow. */
export interface PersonSearchResult {
  pcoPersonId: string;
  /** Tally student id, so the caller can tell whether they are already on the roster. */
  id: string;
  firstName: string;
  lastName: string;
  /**
   * Null when Planning Center holds neither a grade nor a graduation year.
   *
   * Not floored to `minGrade` the way a student document is: this list exists to
   * show what Planning Center thinks, and every adult in the church has a blank
   * grade — rendering all of them as "6th" is a number nobody typed.
   */
  grade: number | null;
  /** What Planning Center thinks: a child, or an adult. Shown, never enforced. */
  child: boolean;
  status: 'active' | 'inactive';
}

/** Enough to choose from, few enough to render as a list on a phone. */
const MAX_SEARCH_RESULTS = 25;

/**
 * Finds people in Planning Center by name, for somebody building the roster.
 *
 * Deliberately unfiltered by grade or by `child`. The whole reason the roster is
 * hand-picked is that those filters are wrong at the edges — the 5th grader who
 * comes with an older sibling, the senior who graduated in May and still leads
 * worship. Both attributes are *shown* so the person choosing can see what they
 * are picking; neither excludes anybody from the list.
 */
export async function searchPeople(options: {
  client: PcoClient;
  config: PcoConfig;
  query: string;
  now?: Date;
  limit?: number;
}): Promise<PersonSearchResult[]> {
  const query = options.query.trim();
  if (!query) return [];

  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(MAX_SEARCH_RESULTS, options.limit ?? MAX_SEARCH_RESULTS));
  const results: PersonSearchResult[] = [];

  for await (const page of options.client.paginate<PcoPerson>('/people', {
    where: { search_name_or_email: query },
    order: 'last_name',
  })) {
    for (const person of page.data) {
      const mapped = mapPersonToStudent(person, {
        minGrade: options.config.minGrade,
        maxGrade: options.config.maxGrade,
        now,
      });
      results.push({
        pcoPersonId: person.id,
        id: pcoStudentId(person.id),
        firstName: mapped.firstName,
        lastName: mapped.lastName,
        grade: pcoGrade(person, now),
        child: person.attributes?.child === true,
        status: mapped.status,
      });
      if (results.length >= limit) return results;
    }
  }

  return results;
}

/* -------------------------------------------------------------------------- */
/* One person, in full                                                         */
/* -------------------------------------------------------------------------- */

function householdIdsOf(person: PcoPerson): string[] {
  const data = person.relationships?.households?.data;
  if (!data) return [];
  const list: JsonApiIdentifier[] = Array.isArray(data) ? data : [data];
  return list.map((item) => item.id);
}

/** One person and everything side-loaded about their household. */
export interface LoadedPerson {
  person: PcoPerson;
  index: IncludedIndex;
}

/**
 * One person, with their household hydrated far enough to name a parent.
 *
 * Uncached on purpose: the callers that want an answer they can *act* on — the
 * write path — must not act on a view of Planning Center that is up to
 * `PCO_CACHE_TTL_SECONDS` old. `fetchPersonDetails` puts its own cache in front
 * of this for the read path, where a few seconds of staleness is the whole
 * point.
 */
export async function loadPersonWithHousehold(
  client: PcoClient,
  personId: string,
): Promise<LoadedPerson | null> {
  const body = await client.get<PcoPerson>(`/people/${encodeURIComponent(personId)}`, {
    include: [...ROSTER_INCLUDES, 'households.people'],
  });

  const person = Array.isArray(body.data) ? body.data[0] : body.data;
  if (!person) return null;

  const index = buildIncludedIndex(body.included);
  await hydrateHouseholds(client, index, person);
  return { person, index };
}

/** The cache entry one student's details live in, so a write can drop it. */
export function personDetailsCacheKey(baseUrl: string, personId: string): string {
  return cacheKey({ kind: 'person', base: baseUrl, id: personId });
}

/**
 * Parent contact and allergies for one student.
 *
 * `include=households.people` gives us who is in the family but neither their
 * role nor their phone number, and `household_memberships` is not includable
 * from `/people` — so learning "which of these adults is the parent, and how do
 * we reach them" costs a request per household. Doing that for one student on
 * the screen someone is actually looking at is cheap. Doing it for four hundred
 * students every six hours is what this module exists to stop.
 */
export async function fetchPersonDetails(
  options: RosterOptions & { personId: string },
): Promise<PersonDetails | null> {
  const { client, config, cache, personId } = options;
  const now = options.now ?? new Date();

  return cache.get(personDetailsCacheKey(config.baseUrl, personId), async () => {
    const loaded = await loadPersonWithHousehold(client, personId);
    if (!loaded) return null;
    const { person, index } = loaded;

    const mapped = mapPersonToStudent(person, {
      minGrade: config.minGrade,
      maxGrade: config.maxGrade,
      now,
    });
    const contact = extractParentContact(person, index);

    return {
      pcoPersonId: person.id,
      allergies: mapped.allergies,
      parentName: contact.parentName,
      parentPhone: contact.parentPhone,
      parentEmail: contact.parentEmail,
      householdAdult: findParentCandidate(person, index) !== null,
    };
  });
}

/**
 * The household id is stamped onto each membership before indexing, because a
 * membership fetched this way carries a link to its household but no
 * relationship object the mapper could read.
 */
async function hydrateHouseholds(
  client: PcoClient,
  index: IncludedIndex,
  person: PcoPerson,
): Promise<void> {
  let fetched = 0;
  for (const householdId of householdIdsOf(person)) {
    if (fetched >= MAX_HOUSEHOLD_FETCHES) return;
    fetched += 1;

    for await (const page of client.paginate<PcoHouseholdMembership>(
      `/households/${encodeURIComponent(householdId)}/household_memberships`,
      { include: ['person', 'person.emails', 'person.phone_numbers'] },
    )) {
      addToIncludedIndex(
        index,
        page.data.map((membership) => ({
          ...membership,
          relationships: {
            ...membership.relationships,
            household: { data: { type: PCO_TYPES.household, id: householdId } },
          },
        })),
      );
      addToIncludedIndex(index, page.included);
    }
  }
}
