/**
 * Reading people out of Planning Center, on demand.
 *
 * This module replaced a scheduled sweep that copied every person in the church
 * into Firestore and kept the copy in step. That was a lot of machinery, and a
 * lot of stored personal data about minors, to answer questions as small as
 * "what grade is Marcus in".
 *
 * So: Planning Center owns people. Tally asks when it needs to know, and holds
 * the answer for at most `cacheTtlSeconds` (see ./cache.ts). Nothing here writes
 * to Firestore — that is the entire point, and it is worth keeping true.
 *
 * The one thing Tally does still own about a person is the parts Planning
 * Center has no opinion about: which small group they are in, and when they
 * turned up. Those live in `students/{id}` and are written only when Tally
 * itself has something to record, so that collection is sparse rather than a
 * mirror.
 */
import type { PcoConfig } from '../config.js';
import type { PcoClient, PcoQuery } from './client.js';
import { cacheKey, type TtlCache } from './cache.js';
import {
  addToIncludedIndex,
  buildIncludedIndex,
  extractParentContact,
  isYouth,
  mapPersonToAccessEntry,
  mapPersonToStudent,
  type IncludedIndex,
  type MappedAccessEntry,
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
  gender: 'male' | 'female' | 'unspecified';
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
}

export interface RosterResult {
  people: RosterPerson[];
  /** True when the answer came from cache rather than from Planning Center. */
  cached: boolean;
  fetchedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

/** Everything a roster row needs in one request. */
const ROSTER_INCLUDES = ['emails', 'phone_numbers', 'households'] as const;
/** A counselor needs no household; only their own address and small-group field. */
const TEAM_INCLUDES = ['emails', 'phone_numbers'] as const;
const FIELD_INCLUDES = ['field_data', 'field_data.field_definition'] as const;

/**
 * Households are one request each (JSON:API cannot include
 * `household_memberships` from `/people`), so detail reads are capped. A single
 * student is never near this; a person in a commune-sized household would be.
 */
const MAX_HOUSEHOLD_FETCHES = 8;

function rosterPath(config: PcoConfig): string {
  return config.rosterSource === 'list'
    ? `/lists/${encodeURIComponent(config.studentListId ?? '')}/people`
    : '/people';
}

function rosterQuery(config: PcoConfig): PcoQuery {
  // Grade mode cannot express a grade *range*, so `where[child]` narrows the
  // query as far as the API allows and `isYouth` enforces the band locally.
  const where: PcoQuery = config.rosterSource === 'grade' ? { child: true } : {};
  return {
    include: [...ROSTER_INCLUDES],
    order: 'last_name',
    where,
  };
}

/* -------------------------------------------------------------------------- */
/* The youth roster                                                            */
/* -------------------------------------------------------------------------- */

export interface RosterOptions {
  client: PcoClient;
  config: PcoConfig;
  cache: TtlCache;
  now?: Date;
  /** Skip any held answer and ask Planning Center. See `TtlCache.get`. */
  force?: boolean;
}

/**
 * The whole youth roster, as the check-in screen needs it.
 *
 * One pull, no household hydration: the roster does not show parent contact, so
 * paying one request per family to build a list of names would be the old
 * sweep's cost with none of its (dubious) benefit.
 */
export async function fetchYouthRoster(options: RosterOptions): Promise<RosterResult> {
  const { client, config, cache } = options;
  const now = options.now ?? new Date();

  const key = cacheKey({
    kind: 'roster',
    source: config.rosterSource,
    list: config.studentListId,
    min: config.minGrade,
    max: config.maxGrade,
  });

  const before = cache.stats.misses;
  const people = await cache.get(
    key,
    async () => {
      const collected: RosterPerson[] = [];
      const seen = new Set<string>();

      for await (const page of client.paginate<PcoPerson>(rosterPath(config), rosterQuery(config))) {
        for (const person of page.data) {
          // In list mode the youth pastor's list *is* the roster; second-guessing
          // it on grade would drop the 5th grader who comes with an older sibling.
          const youth =
            config.rosterSource === 'list'
              ? true
              : isYouth(person, { minGrade: config.minGrade, maxGrade: config.maxGrade, now });
          if (!youth) continue;
          // A person on two Lists comes back twice; the door does not need to see
          // them twice.
          if (seen.has(person.id)) continue;
          seen.add(person.id);

          const mapped = mapPersonToStudent(person, {
            minGrade: config.minGrade,
            maxGrade: config.maxGrade,
            now,
          });

          collected.push({
            id: pcoStudentId(person.id),
            pcoPersonId: person.id,
            firstName: mapped.firstName,
            lastName: mapped.lastName,
            grade: mapped.grade,
            gender: mapped.gender,
            status: mapped.status,
            searchName: mapped.searchName,
            // Not looked up — see the note on the field. Hydrating households
          // here would be one request per family on the path a counselor waits
          // for at a door.
          profileComplete: null,
            hasAllergies: mapped.allergies !== null && mapped.allergies.length > 0,
          });
        }
      }

      collected.sort((a, b) =>
        a.searchName < b.searchName ? -1 : a.searchName > b.searchName ? 1 : 0,
      );
      return collected;
    },
    options.force,
  );

  return {
    people,
    cached: cache.stats.misses === before,
    fetchedAt: now.toISOString(),
  };
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

  return cache.get(cacheKey({ kind: 'person', id: personId }), async () => {
    const body = await client.get<PcoPerson>(`/people/${encodeURIComponent(personId)}`, {
      include: [...ROSTER_INCLUDES, 'households.people'],
    });

    const person = Array.isArray(body.data) ? body.data[0] : body.data;
    if (!person) return null;

    const index = buildIncludedIndex(body.included);
    await hydrateHouseholds(client, index, person);

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

/* -------------------------------------------------------------------------- */
/* The team                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Looks up one email address on the team roster.
 *
 * This is how `provisionAccess` decides whether somebody signing in is allowed
 * in, and with what role. It used to read a mirrored `accessRoster` collection;
 * asking Planning Center directly means the allowlist is never stale, and Tally
 * never stores a list of staff email addresses at all.
 *
 * Returns null for "not on the roster", which the caller reports as a refusal
 * rather than an error — a volunteer who has not been added yet is a normal
 * thing to be, not a failure.
 */
export async function findTeamMemberByEmail(
  options: RosterOptions & { email: string },
): Promise<MappedAccessEntry | null> {
  const { client, config, cache } = options;
  const email = options.email.trim().toLowerCase();
  if (!email) return null;

  return cache.get(cacheKey({ kind: 'team-member', email, list: config.counselorListId }), () =>
    lookupTeamMember(client, config, email),
  );
}

async function lookupTeamMember(
  client: PcoClient,
  config: PcoConfig,
  email: string,
): Promise<MappedAccessEntry | null> {
  const include = [...TEAM_INCLUDES, ...(config.smallGroupField ? FIELD_INCLUDES : [])];

  // A configured List is the authoritative team roster: being findable in
  // Planning Center is not the same as being on the youth team.
  if (config.counselorListId) {
    for await (const page of client.paginate<PcoPerson>(
      `/lists/${encodeURIComponent(config.counselorListId)}/people`,
      { include },
    )) {
      const index = buildIncludedIndex(page.included);
      for (const person of page.data) {
        const entry = mapPersonToAccessEntry(person, {
          index,
          smallGroupField: config.smallGroupField,
        });
        if (entry?.emailKey && entry.email.trim().toLowerCase() === email) return entry;
      }
    }
    return null;
  }

  // No List configured. Search by email address, then confirm the address
  // actually belongs to the person we got back — Planning Center's search is
  // fuzzy, and "close enough" is not a basis for granting access to a roster of
  // minors.
  for await (const page of client.paginate<PcoPerson>('/people', {
    where: { search_name_or_email: email },
    include,
  })) {
    const index = buildIncludedIndex(page.included);
    for (const person of page.data) {
      const entry = mapPersonToAccessEntry(person, {
        index,
        smallGroupField: config.smallGroupField,
      });
      if (entry && entry.email.trim().toLowerCase() === email) return entry;
    }
  }

  return null;
}
