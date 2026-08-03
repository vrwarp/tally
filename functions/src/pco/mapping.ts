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

/* -------------------------------------------------------------------------- */
/* Tally-side shapes                                                           */
/* -------------------------------------------------------------------------- */

export type StudentStatus = 'active' | 'inactive';
export type Role = 'counselor' | 'core' | 'admin';

/** Exactly the fields Planning Center owns on a student (PCO_MANAGED_STUDENT_FIELDS). */
export interface MappedStudent {
  firstName: string;
  lastName: string;
  grade: number;
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

export interface ParentContact {
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
}

/** The household adult `extractParentContact` reports on, identified. */
export interface ParentCandidate {
  /** Planning Center person id of the adult. */
  id: string;
  /** Their person resource, when it was side-loaded. */
  member: PcoPerson | null;
  /** Their display name, composed the same way `parentName` is. */
  name: string | null;
}

export interface GradeRange {
  minGrade: number;
  maxGrade: number;
}

export interface StudentMappingContext extends GradeRange {
  /**
   * Anchor for deriving a grade from `graduation_year`. Omit it and a person
   * with no `grade` simply lands on `minGrade` — guessing from a stale clock
   * would be worse than admitting we do not know.
   */
  now?: Date;
}

/* -------------------------------------------------------------------------- */
/* Small helpers, mirrored from src/types                                      */
/* -------------------------------------------------------------------------- */

function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result.length > 0 ? result : null;
}

/** First non-empty string in the list, already trimmed. */
function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const result = trimmed(value);
    if (result !== null) return result;
  }
  return null;
}

/** Must stay identical to `buildSearchName` in src/types/index.ts. */
export function buildSearchName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

/* -------------------------------------------------------------------------- */
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Planning Center writes a person with both a first name and a nickname as
 * `Benson “蔡秉洲” Tsai` — the nickname is an *addition* to the first name, not a
 * replacement for it. Tally used to keep only the nickname, which meant a
 * profile the church office reads as "Benson" showed up here as "蔡秉洲" and the
 * two were impossible to line up by eye.
 *
 * Matching Planning Center's own format costs nothing and buys a lot: the name
 * on screen is the name on the profile page, and because `searchName` is built
 * from it, either spelling finds the student.
 */
const NICKNAME_OPEN = '“';
const NICKNAME_CLOSE = '”';

/**
 * The two halves, joined. A nickname equal to the first name is dropped rather
 * than repeated — `Ben “Ben”` is noise.
 *
 * Must stay identical to `composeFirstName` in src/types/index.ts.
 */
export function composeFirstName(firstName: unknown, nickname: unknown): string {
  const legal = trimmed(firstName);
  const nick = trimmed(nickname);

  if (nick === null) return legal ?? '';
  if (legal === null) return nick;
  // The first name is the canonical spelling of the two.
  if (legal.toLowerCase() === nick.toLowerCase()) return legal;
  return `${legal} ${NICKNAME_OPEN}${nick}${NICKNAME_CLOSE}`;
}

/**
 * The composite pulled apart again.
 *
 * Planning Center stores the halves in separate fields, so pushing the whole
 * string into `first_name` would render as `Benson “蔡秉洲” “蔡秉洲” Tsai` on the
 * next read — and a moment later as a duplicate person, because the matcher
 * would stop recognising them. Anything without the quoted section comes back
 * unchanged, which covers every hand-typed visitor name.
 *
 * Must stay identical to `splitFirstName` in src/types/index.ts.
 */
export function splitFirstName(value: string): { firstName: string; nickname: string | null } {
  const match = /^(.*?)\s*[“"]([^”"]*)[”"]\s*$/.exec(value.trim());
  if (!match) return { firstName: value.trim(), nickname: null };

  const legal = match[1]?.trim() ?? '';
  const nickname = match[2]?.trim() ?? '';
  if (nickname.length === 0) return { firstName: legal, nickname: null };
  // `“Benji”` with nothing in front of it is just a name in quotes.
  if (legal.length === 0) return { firstName: nickname, nickname: null };
  return { firstName: legal, nickname };
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

/** Must stay identical to `emailKey` in src/types/index.ts. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ',');
}

/** Must stay identical to `computeProfileComplete` in src/types/index.ts. */
export function computeProfileComplete(input: {
  parentPhone?: string | null;
  parentEmail?: string | null;
}): boolean {
  return Boolean(input.parentPhone?.trim() || input.parentEmail?.trim());
}

/**
 * Identity key for collapsing a quick-added visitor onto the Planning Center
 * person the church office typed in later. Accents and punctuation are dropped
 * because a counselor thumb-typing "Jose" at the door and the office entering
 * "José" are the same child.
 */
export function nameGradeKey(firstName: string, lastName: string, grade: number): string {
  const normalise = (value: string): string => {
    const folded = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const latin = folded.replace(/[^a-z0-9]+/g, ' ').trim();
    // A name with no Latin letters at all \u2014 \u8521\u79c9\u6d32 \u2014 would otherwise normalise to
    // the empty string, and every such child in a grade would share one key and
    // be merged into whichever came first. Keep the characters instead.
    return latin.length > 0 ? latin : folded.replace(/\s+/g, ' ').trim();
  };
  return `${normalise(firstName)}|${normalise(lastName)}|${grade}`;
}

/**
 * Deterministic ordering for Planning Center ids. Numeric where possible so
 * "9" sorts before "10", falling back to string order for anything else. The
 * point is only that repeated syncs pick the same record every time.
 */
export function compareIds(a: string, b: string): number {
  const left = Number(a);
  const right = Number(b);
  if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
  return a < b ? -1 : a > b ? 1 : 0;
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
 * The grade Planning Center actually holds, or null when it says nothing.
 *
 * Kept separate from `mapPersonToStudent` because the two callers want opposite
 * things from a blank: a student document must carry *some* grade, while a
 * screen showing "what Planning Center thinks" must be able to say that
 * Planning Center thinks nothing.
 */
export function pcoGrade(person: PcoPerson, now?: Date): number | null {
  const attributes: PcoPersonAttributes = person.attributes ?? {};
  if (typeof attributes.grade === 'number' && Number.isFinite(attributes.grade)) {
    return attributes.grade;
  }
  if (now && typeof attributes.graduation_year === 'number') {
    return gradeFromGraduationYear(attributes.graduation_year, now);
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
    grade: Math.min(ctx.maxGrade, Math.max(ctx.minGrade, grade ?? ctx.minGrade)),
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
 * Exactly the two fields `extractParentContact` would hand back, as yes/no.
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
    // The same last resort `extractParentContact` falls back to, for a person
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
 * Split out from `extractParentContact` because the write path needs the same
 * answer with the id still attached. "Who does Tally say to ring" and "whose
 * record does Tally add a number to" must be the same person — a row that says
 * nobody can be reached, and a write that lands on a different adult in the
 * household, would leave the row saying it still.
 */
export function findParentCandidate(
  person: PcoPerson,
  householdIndex: IncludedIndex,
): ParentCandidate | null {
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
export function extractParentContact(person: PcoPerson, householdIndex: IncludedIndex): ParentContact {
  const chosen = findParentCandidate(person, householdIndex);
  if (!chosen) return { parentName: null, parentPhone: null, parentEmail: null };

  const attributes: PcoPersonAttributes = chosen.member?.attributes ?? {};
  const emails = listIncluded<PcoEmail>(householdIndex, PCO_TYPES.email).filter((email) =>
    ownedBy(email, chosen.id),
  );
  const phones = listIncluded<PcoPhoneNumber>(householdIndex, PCO_TYPES.phoneNumber).filter((phone) =>
    ownedBy(phone, chosen.id),
  );

  return {
    parentName: chosen.name,
    parentPhone: pickContactValue(phones, (phone) =>
      firstNonEmpty(phone.attributes?.number, phone.attributes?.national, phone.attributes?.e164),
    ),
    parentEmail:
      pickContactValue(emails, (email) => trimmed(email.attributes?.address)?.toLowerCase() ?? null) ??
      trimmed(attributes.primary_email_address)?.toLowerCase() ??
      null,
  };
}
