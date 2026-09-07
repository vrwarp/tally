/**
 * Planning Center person -> Tally record. Pure functions, no I/O.
 *
 * This is the whole integration's centre of gravity. Everything above it is
 * plumbing that can be retried; a mistake here quietly writes the wrong grade or
 * the wrong parent's phone number onto a real child's record and nobody notices
 * until it matters. Hence: no clock reads, no network, no Firestore — every
 * decision is a function of its arguments and is covered in mapping.test.ts.
 *
 * The Tally field names and semantics mirror `StudentDoc` / `AccessRosterEntryDoc`
 * in src/types/index.ts. They are re-declared rather than imported because Cloud
 * Functions compile as a separate package against firebase-admin, while the app
 * types are written against the browser SDK's `Timestamp`.
 */
import {
  buildSearchName,
  clampGrade,
  compareIds,
  composeFirstName,
  firstNonEmpty,
  trimmed,
  type GradeRange,
} from '../backends/mappingShared.js';
import {
  HOUSEHOLD_ADULT_ROLES,
  PCO_TYPES,
  type JsonApiIdentifier,
  type JsonApiResource,
  type PcoEmail,
  type PcoHousehold,
  type PcoHouseholdMembership,
  type PcoPerson,
  type PcoPersonAttributes,
  type PcoPhoneNumber,
} from './types.js';

/**
 * The backend-independent halves of this mapping moved to
 * ../backends/mappingShared.ts when the Attendees backend arrived — the same
 * names, the same behavior, one copy. Re-exported here because this module is
 * where the Planning Center flows (and their tests) have always found them.
 */
export {
  buildSearchName,
  clampGrade,
  compareIds,
  composeFirstName,
  computeProfileComplete,
  emailKey,
  nameGradeKey,
  splitFirstName,
  type GradeRange,
} from '../backends/mappingShared.js';

/* -------------------------------------------------------------------------- */
/* Tally-side shapes                                                           */
/* -------------------------------------------------------------------------- */

export type StudentStatus = 'active' | 'inactive';
export type Role = 'counselor' | 'core' | 'admin';

/** Exactly the fields Planning Center owns on a student (PCO_MANAGED_STUDENT_FIELDS). */
export interface MappedStudent {
  firstName: string;
  lastName: string;
  /** Null when the backend holds neither a grade nor a graduation year. */
  grade: number | null;
  allergies: string | null;
  /**
   * The day of the year somebody has a birthday on, as `MM-DD`, or null when
   * Planning Center holds no birthdate.
   *
   * Deliberately year-less. What a roster row does with this is say "cake on
   * Friday" and "nobody has filled this in", and neither question needs to know
   * how old a child is or what year they were born — which is the part of a
   * birthdate that identifies a person. So the year is dropped here, at the
   * boundary, rather than being carried to every browser on the roster and
   * trusted not to be used. `getPersonDetails` is where a screen with a reason
   * asks for more.
   */
  birthday: string | null;
  status: StudentStatus;
  /** Denormalised search key; must match `buildSearchName` in src/types. */
  searchName: string;
  pcoPersonId: string;
  pcoUpdatedAt: Date | null;
}

export interface AdultContact {
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
}

/** The household adult `extractAdultContact` reports on, identified. */
export interface ContactCandidate {
  /** Planning Center person id of the adult. */
  id: string;
  /** Their person resource, when it was side-loaded. */
  member: PcoPerson | null;
  /** Their display name, composed the same way `contactName` is. */
  name: string | null;
}

export interface StudentMappingContext extends GradeRange {
  /**
   * Anchor for deriving a grade from `graduation_year`. Omit it and a person
   * with no `grade` simply lands on `minGrade` — guessing from a stale clock
   * would be worse than admitting we do not know.
   */
  now?: Date;
}

/**
 * The first-name half of a Planning Center person's display name.
 *
 * `given_name` is the legal-name fallback, present when `first_name` has been
 * overridden.
 */
export function displayFirstName(attributes: PcoPersonAttributes): string {
  return composeFirstName(
    firstNonEmpty(attributes.first_name, attributes.given_name),
    attributes.nickname,
  );
}

function toIdentifierArray(data: JsonApiIdentifier | JsonApiIdentifier[] | null | undefined) {
  if (!data) return [] as JsonApiIdentifier[];
  return Array.isArray(data) ? data : [data];
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

/* -------------------------------------------------------------------------- */
/* The `included` index                                                        */
/* -------------------------------------------------------------------------- */

export interface IncludedIndex {
  /** Keyed `${type}:${id}`. */
  byKey: Map<string, JsonApiResource>;
  byType: Map<string, JsonApiResource[]>;
}

export function buildIncludedIndex(included: readonly JsonApiResource[] | undefined): IncludedIndex {
  const index: IncludedIndex = { byKey: new Map(), byType: new Map() };
  addToIncludedIndex(index, included);
  return index;
}

/**
 * Merges more resources into an existing index.
 *
 * The sync builds one index per run rather than per page: households are shared
 * between siblings, and re-fetching a household for every child in it would
 * triple the request count for a family of three.
 */
export function addToIncludedIndex(
  index: IncludedIndex,
  included: readonly JsonApiResource[] | undefined,
): IncludedIndex {
  for (const resource of included ?? []) {
    if (!resource || typeof resource.id !== 'string' || typeof resource.type !== 'string') continue;
    const key = `${resource.type}:${resource.id}`;
    if (index.byKey.has(key)) continue;
    index.byKey.set(key, resource);
    const bucket = index.byType.get(resource.type);
    if (bucket) bucket.push(resource);
    else index.byType.set(resource.type, [resource]);
  }
  return index;
}

export function getIncluded<T extends JsonApiResource>(
  index: IncludedIndex,
  type: string,
  id: string,
): T | null {
  return (index.byKey.get(`${type}:${id}`) as T | undefined) ?? null;
}

function listIncluded<T extends JsonApiResource>(index: IncludedIndex, type: string): T[] {
  return (index.byType.get(type) ?? []) as T[];
}

/** Included Emails/PhoneNumbers carry `relationships.person`, so they can be
 * attached to their owner without trusting the person's own relationship block. */
function ownedBy(resource: JsonApiResource, personId: string): boolean {
  const data = resource.relationships?.person?.data;
  if (!data || Array.isArray(data)) return false;
  return data.id === personId;
}

/**
 * Every phone number Planning Center holds for this person, raw as entered.
 *
 * All of them, unlike `extractAdultContact`'s one: the kiosk's last-4 index
 * answers "does any number in this family end in these digits", and a parent
 * types whichever of their numbers they think of first.
 */
export function phoneNumbersOf(person: PcoPerson, index: IncludedIndex): string[] {
  const values: string[] = [];
  for (const phone of listIncluded<PcoPhoneNumber>(index, PCO_TYPES.phoneNumber)) {
    if (!ownedBy(phone, person.id)) continue;
    const value = firstNonEmpty(
      phone.attributes?.number,
      phone.attributes?.national,
      phone.attributes?.e164,
    );
    if (value) values.push(value);
  }
  return values;
}

/* -------------------------------------------------------------------------- */
/* Person -> student                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The US school year that ends in the given calendar year. August or later
 * belongs to the year that ends next spring, which is what "graduation year"
 * counts down to.
 */
function schoolYearEnding(now: Date): number {
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}

/** Grade implied by a graduation year: seniors graduate in the year they finish 12th. */
export function gradeFromGraduationYear(graduationYear: number, now: Date): number {
  return 12 - (graduationYear - schoolYearEnding(now));
}

/**
 * The two ends of school. Pre-K is `-1`, kindergarten is `0`, and a senior
 * graduates from 12th.
 *
 * These bound the *derivation* below, not the roster: `minGrade`/`maxGrade` are
 * the band a church runs on and are somebody's configuration, while this is the
 * range a grade can be at all — `Grade` in src/types/index.ts, and
 * `ABSOLUTE_MIN_GRADE`/`ABSOLUTE_MAX_GRADE` in ../config.ts, which is the same
 * range said twice more because neither file can import this one.
 */
const FIRST_GRADE = -1;
const LAST_GRADE = 12;

/**
 * The grade Planning Center actually holds, or null when it says nothing.
 *
 * Kept separate from `mapPersonToStudent` because the two callers want opposite
 * things from a blank: a screen showing "what Planning Center thinks" must be
 * able to say that Planning Center thinks nothing.
 *
 * A `grade` Planning Center holds outright is reported as it stands — that is
 * the whole point of this function, and the band is the roster's business to
 * filter rather than this one's to rewrite.
 *
 * A grade *derived* from a graduation year is different: the arithmetic is a
 * straight line and school is not, so it keeps counting past both ends. A
 * class year far enough out belongs to a child who is not in school yet — an
 * infant in the nursery derives to `-4` — and a senior who graduated six years
 * ago derives to 18th. Neither is a grade. Outside Pre-K–12 the honest answer
 * is that they have none, which is what `Grade` in src/types/index.ts says and
 * what every screen already renders for a child too young for one.
 *
 * The bounds also swallow the non-finite cases the fuzz suite found: an
 * `Infinity` graduation year derives to `-Infinity`, which no comparison here
 * admits. It used to be absorbed by the clamp that no longer runs —
 * `Math.max(minGrade, -Infinity)` quietly answered `minGrade`, so garbage
 * upstream arrived looking like a confident 6th grader.
 */
export function pcoGrade(person: PcoPerson, now?: Date): number | null {
  const attributes: PcoPersonAttributes = person.attributes ?? {};
  if (typeof attributes.grade === 'number' && Number.isFinite(attributes.grade)) {
    return attributes.grade;
  }
  if (now && typeof attributes.graduation_year === 'number') {
    const derived = gradeFromGraduationYear(attributes.graduation_year, now);
    return derived >= FIRST_GRADE && derived <= LAST_GRADE ? derived : null;
  }
  return null;
}

/**
 * The month and day of a person's birthdate, or null.
 *
 * Planning Center sends `birthdate` as `YYYY-MM-DD`, and sometimes as nothing
 * at all — an unfilled field on a person somebody added in a hurry, which is
 * the case the roster's "no birthday" chip exists to surface. Anything that
 * does not parse is treated as absent rather than guessed at: a half-typed date
 * upstream should read as missing, not as a birthday on some arbitrary day.
 */
export function birthdayOf(person: PcoPerson): string | null {
  const raw = trimmed((person.attributes ?? {}).birthdate);
  if (raw === null) return null;

  const match = /^\d{4}-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${match[1]}-${match[2]}`;
}

/**
 * The year Planning Center keeps for a birthday nobody knows the year of.
 *
 * Its own help says so — "use 1885 as the birth year, which will show no age" —
 * and a person entered that way in Planning Center's own form comes back from
 * the API as `1885-12-14`. So this is not a sentinel Tally invented; it is the
 * one already in the data, and writing it is how a day-only birthday is stored
 * without claiming an age for a child.
 *
 * Read in two directions. `resolveBirthdate` writes it for a day typed against
 * a person with no birthdate at all, and `fullBirthdayOf` refuses to *show* it,
 * because 1885 on a profile is not a year of birth — it is the absence of one,
 * and printing it would be the one thing this convention exists to avoid.
 *
 * Below `EARLIEST_BIRTH_YEAR` on purpose: a caller cannot type it, because a
 * leader typing 1885 in the year box means a mistake rather than this.
 */
export const UNKNOWN_BIRTH_YEAR = 1885;

/**
 * The whole birthday, for the one-person read — `YYYY-MM-DD`, or `MM-DD` when
 * the year on file is Planning Center's "nobody knows" 1885. Null when there is
 * no birthdate.
 *
 * The two shapes are exactly the two Tally *sends* (see `parseBirthdayPatch`),
 * which is the point: what an edit form opens on and what it saves are then the
 * same vocabulary, and a leader who can see the year can retype it.
 *
 * Deliberately not what the roster carries. `birthdayOf` drops the year for
 * every row of it, because a browser holding eighty-five children must not hold
 * eighty-five dates of birth. This is the other half of that rule rather than an
 * exception to it: one student, asked for by a core team member on the screen
 * that is showing that student, alongside their allergies and their parent's
 * phone number.
 */
export function fullBirthdayOf(person: PcoPerson): string | null {
  const monthDay = birthdayOf(person);
  if (monthDay === null) return null;

  const raw = trimmed((person.attributes ?? {}).birthdate) ?? '';
  const year = Number(/^(\d{4})-/.exec(raw)?.[1]);
  if (!Number.isFinite(year) || year === UNKNOWN_BIRTH_YEAR) return monthDay;

  return `${year}-${monthDay}`;
}

export function normaliseStatus(person: PcoPerson): StudentStatus {
  const attributes: PcoPersonAttributes = person.attributes ?? {};
  if (trimmed(attributes.inactivated_at) !== null) return 'inactive';
  return trimmed(attributes.status)?.toLowerCase() === 'inactive' ? 'inactive' : 'active';
}

export function mapPersonToStudent(person: PcoPerson, ctx: StudentMappingContext): MappedStudent {
  const attributes: PcoPersonAttributes = person.attributes ?? {};

  // Planning Center's own format, quoted nickname and all. See displayFirstName.
  const firstName = displayFirstName(attributes);
  const lastName = trimmed(attributes.last_name) ?? '';

  const grade = pcoGrade(person, ctx.now);

  return {
    firstName,
    lastName,
    grade: clampGrade(grade).grade,
    allergies: trimmed(attributes.medical_notes),
    birthday: birthdayOf(person),
    status: normaliseStatus(person),
    searchName: buildSearchName(firstName, lastName),
    pcoPersonId: person.id,
    pcoUpdatedAt: parseDate(attributes.updated_at),
  };
}

/**
 * Grade-mode membership test.
 *
 * The API can filter `where[grade]` on one exact value but not a range, so the
 * band is enforced here. A person with neither a grade nor a graduation year is
 * *not* assumed to be a youth — an adult volunteer with a blank grade would
 * otherwise be swept into the student roster.
 */
export function isYouth(person: PcoPerson, options: GradeRange & { now?: Date }): boolean {
  const grade = pcoGrade(person, options.now);
  if (grade === null) return false;

  return grade >= options.minGrade && grade <= options.maxGrade;
}

/* -------------------------------------------------------------------------- */
/* Parent contact                                                              */
/* -------------------------------------------------------------------------- */

/** Household ids the person belongs to, from their own relationships or, failing
 * that, from any indexed household that lists them as a member. */
function householdIdsFor(person: PcoPerson, index: IncludedIndex): string[] {
  const direct = toIdentifierArray(person.relationships?.households?.data).map((item) => item.id);
  if (direct.length > 0) return direct;

  return listIncluded<PcoHousehold>(index, PCO_TYPES.household)
    .filter((household) =>
      toIdentifierArray(household.relationships?.people?.data).some((item) => item.id === person.id),
    )
    .map((household) => household.id);
}

/**
 * `HouseholdMembership` resources are not includable from `/people`, so the sync
 * fetches them per household and stamps the household id onto each one before
 * indexing. This reads that stamp.
 */
function membershipHousehold(membership: PcoHouseholdMembership): string | null {
  const data = membership.relationships?.household?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id;
}

function membershipPerson(membership: PcoHouseholdMembership): string | null {
  const data = membership.relationships?.person?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id;
}

/** Lower is more parental. `Infinity` means "not an adult in this household". */
function adultRank(role: string | null, person: PcoPerson | null): number {
  if (role) {
    const rank = (HOUSEHOLD_ADULT_ROLES as readonly string[]).indexOf(role);
    if (rank >= 0) return rank;
    return Number.POSITIVE_INFINITY;
  }
  // No membership record: fall back to the person's own `child` flag, which is
  // the only adult/child signal `include=households.people` gives us.
  if (person?.attributes?.child === false) return HOUSEHOLD_ADULT_ROLES.length;
  return Number.POSITIVE_INFINITY;
}

function pickContactValue<T extends JsonApiResource<{ primary?: boolean | null }>>(
  candidates: T[],
  read: (resource: T) => string | null,
): string | null {
  const usable = candidates
    .filter((candidate) => read(candidate) !== null)
    .sort((a, b) => compareIds(a.id, b.id));
  if (usable.length === 0) return null;

  const primary = usable.find((candidate) => candidate.attributes?.primary === true);
  return read(primary ?? usable[0]!);
}

/** Which of the two contact fields Planning Center already holds for a person. */
export interface ContactFieldsOnFile {
  phone: boolean;
  email: boolean;
}

/**
 * Exactly the two fields `extractAdultContact` would hand back, as yes/no.
 *
 * Answered per field rather than as one boolean because the write path needs to
 * know *which* half is missing: it may add the one that is absent and must not
 * add a second copy of the one that is not.
 */
export function contactFieldsOnFile(person: PcoPerson, index: IncludedIndex): ContactFieldsOnFile {
  const email =
    listIncluded<PcoEmail>(index, PCO_TYPES.email).some(
      (candidate) => ownedBy(candidate, person.id) && trimmed(candidate.attributes?.address) !== null,
    ) ||
    // The same last resort `extractAdultContact` falls back to, for a person
    // whose Email records were not side-loaded.
    trimmed(person.attributes?.primary_email_address) !== null;

  const phone = listIncluded<PcoPhoneNumber>(index, PCO_TYPES.phoneNumber).some(
    (candidate) =>
      ownedBy(candidate, person.id) &&
      firstNonEmpty(
        candidate.attributes?.number,
        candidate.attributes?.national,
        candidate.attributes?.e164,
      ) !== null,
  );

  return { phone, email };
}

/**
 * Whether Planning Center holds any way to reach this person.
 *
 * That is what lets the answer be carried for a whole roster without carrying a
 * single parent's contact details along with it.
 */
export function hasContactDetails(person: PcoPerson, index: IncludedIndex): boolean {
  const onFile = contactFieldsOnFile(person, index);
  return onFile.phone || onFile.email;
}

/**
 * Finds the adult Tally should call about this student.
 *
 * Preference order is `parent_guardian`, then `adult`, then `other_adult`, then
 * any household member flagged as not-a-child; ties break on Planning Center id
 * so two syncs over an unchanged household never flap between mum and dad and
 * churn every counselor's listener.
 *
 * Split out from `extractAdultContact` because the write path needs the same
 * answer with the id still attached. "Who does Tally say to ring" and "whose
 * record does Tally add a number to" must be the same person — a row that says
 * nobody can be reached, and a write that lands on a different adult in the
 * household, would leave the row saying it still.
 */
export function findContactCandidate(
  person: PcoPerson,
  householdIndex: IncludedIndex,
): ContactCandidate | null {
  const householdIds = new Set(householdIdsFor(person, householdIndex));
  if (householdIds.size === 0) return null;

  const memberships = listIncluded<PcoHouseholdMembership>(
    householdIndex,
    PCO_TYPES.householdMembership,
  ).filter((membership) => {
    const household = membershipHousehold(membership);
    return household !== null && householdIds.has(household);
  });

  const roleByPersonId = new Map<string, string>();
  for (const membership of memberships) {
    const memberId = membershipPerson(membership);
    const role = trimmed(membership.attributes?.household_role)?.toLowerCase();
    if (memberId && role) roleByPersonId.set(memberId, role);
  }

  const memberIds = new Set<string>(roleByPersonId.keys());
  for (const householdId of householdIds) {
    const household = getIncluded<PcoHousehold>(householdIndex, PCO_TYPES.household, householdId);
    for (const member of toIdentifierArray(household?.relationships?.people?.data)) {
      memberIds.add(member.id);
    }
  }
  memberIds.delete(person.id);

  const ranked = [...memberIds]
    .map((id) => {
      const member = getIncluded<PcoPerson>(householdIndex, PCO_TYPES.person, id);
      return { id, member, rank: adultRank(roleByPersonId.get(id) ?? null, member) };
    })
    .filter((candidate) => Number.isFinite(candidate.rank))
    .sort((a, b) => a.rank - b.rank || compareIds(a.id, b.id));

  const chosen = ranked[0];
  if (!chosen) return null;

  const attributes: PcoPersonAttributes = chosen.member?.attributes ?? {};
  return {
    id: chosen.id,
    member: chosen.member ?? null,
    name:
      firstNonEmpty(
        [displayFirstName(attributes), trimmed(attributes.last_name)].filter(Boolean).join(' '),
        attributes.name,
      ) ?? null,
  };
}

/** Parent name, phone and email for a student, or nulls when there is nobody. */
export function extractAdultContact(person: PcoPerson, householdIndex: IncludedIndex): AdultContact {
  const chosen = findContactCandidate(person, householdIndex);
  if (!chosen) return { contactName: null, contactPhone: null, contactEmail: null };

  const attributes: PcoPersonAttributes = chosen.member?.attributes ?? {};
  const emails = listIncluded<PcoEmail>(householdIndex, PCO_TYPES.email).filter((email) =>
    ownedBy(email, chosen.id),
  );
  const phones = listIncluded<PcoPhoneNumber>(householdIndex, PCO_TYPES.phoneNumber).filter((phone) =>
    ownedBy(phone, chosen.id),
  );

  return {
    contactName: chosen.name,
    contactPhone: pickContactValue(phones, (phone) =>
      firstNonEmpty(phone.attributes?.number, phone.attributes?.national, phone.attributes?.e164),
    ),
    contactEmail:
      pickContactValue(emails, (email) => trimmed(email.attributes?.address)?.toLowerCase() ?? null) ??
      trimmed(attributes.primary_email_address)?.toLowerCase() ??
      null,
  };
}
