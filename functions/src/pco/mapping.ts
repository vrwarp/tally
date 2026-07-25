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
  type PcoFieldDatum,
  type PcoFieldDefinition,
  type PcoHousehold,
  type PcoHouseholdMembership,
  type PcoPerson,
  type PcoPersonAttributes,
  type PcoPhoneNumber,
} from './types.js';

/* -------------------------------------------------------------------------- */
/* Tally-side shapes                                                           */
/* -------------------------------------------------------------------------- */

export type Gender = 'male' | 'female' | 'unspecified';
export type StudentStatus = 'active' | 'inactive';
export type Role = 'counselor' | 'core' | 'admin';

/** Exactly the fields Planning Center owns on a student (PCO_MANAGED_STUDENT_FIELDS). */
export interface MappedStudent {
  firstName: string;
  lastName: string;
  grade: number;
  gender: Gender;
  allergies: string | null;
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

export interface MappedAccessEntry {
  /** Firestore document id for `accessRoster/{emailKey}`. */
  emailKey: string;
  email: string;
  displayName: string | null;
  role: Role;
  pcoPersonId: string;
  assignedGroupId: string | null;
  active: boolean;
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

export interface AccessMappingContext {
  index: IncludedIndex;
  /** Name or slug of the custom field carrying a small-group name. */
  smallGroupField?: string | null;
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
  const normalise = (value: string): string =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
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
 * Normalises Planning Center's free-text gender.
 *
 * Only recorded because Sunday School small groups are split by it; anything
 * unrecognised is 'unspecified' rather than a guess.
 */
export function normaliseGender(value: unknown): Gender {
  const raw = trimmed(value)?.toLowerCase();
  if (raw === 'm' || raw === 'male') return 'male';
  if (raw === 'f' || raw === 'female') return 'female';
  return 'unspecified';
}

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

export function normaliseStatus(person: PcoPerson): StudentStatus {
  const attributes: PcoPersonAttributes = person.attributes ?? {};
  if (trimmed(attributes.inactivated_at) !== null) return 'inactive';
  return trimmed(attributes.status)?.toLowerCase() === 'inactive' ? 'inactive' : 'active';
}

export function mapPersonToStudent(person: PcoPerson, ctx: StudentMappingContext): MappedStudent {
  const attributes: PcoPersonAttributes = person.attributes ?? {};

  // What the kid is actually called wins over what the church database calls
  // them; `given_name` is the legal-name fallback when `first_name` is blank.
  const firstName = firstNonEmpty(attributes.nickname, attributes.first_name, attributes.given_name) ?? '';
  const lastName = trimmed(attributes.last_name) ?? '';

  let grade = typeof attributes.grade === 'number' && Number.isFinite(attributes.grade)
    ? attributes.grade
    : null;
  if (grade === null && ctx.now && typeof attributes.graduation_year === 'number') {
    grade = gradeFromGraduationYear(attributes.graduation_year, ctx.now);
  }

  return {
    firstName,
    lastName,
    grade: Math.min(ctx.maxGrade, Math.max(ctx.minGrade, grade ?? ctx.minGrade)),
    gender: normaliseGender(attributes.gender),
    allergies: trimmed(attributes.medical_notes),
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
  const attributes: PcoPersonAttributes = person.attributes ?? {};

  let grade: number | null =
    typeof attributes.grade === 'number' && Number.isFinite(attributes.grade) ? attributes.grade : null;
  if (grade === null && options.now && typeof attributes.graduation_year === 'number') {
    grade = gradeFromGraduationYear(attributes.graduation_year, options.now);
  }
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

/**
 * Finds the adult Tally should call about this student.
 *
 * Preference order is `parent_guardian`, then `adult`, then `other_adult`, then
 * any household member flagged as not-a-child; ties break on Planning Center id
 * so two syncs over an unchanged household never flap between mum and dad and
 * churn every counselor's listener.
 */
export function extractParentContact(person: PcoPerson, householdIndex: IncludedIndex): ParentContact {
  const householdIds = new Set(householdIdsFor(person, householdIndex));
  if (householdIds.size === 0) return { parentName: null, parentPhone: null, parentEmail: null };

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
  if (!chosen) return { parentName: null, parentPhone: null, parentEmail: null };

  const attributes: PcoPersonAttributes = chosen.member?.attributes ?? {};
  const parentName =
    firstNonEmpty(
      [firstNonEmpty(attributes.nickname, attributes.first_name), trimmed(attributes.last_name)]
        .filter(Boolean)
        .join(' '),
      attributes.name,
    ) ?? null;

  const emails = listIncluded<PcoEmail>(householdIndex, PCO_TYPES.email).filter((email) =>
    ownedBy(email, chosen.id),
  );
  const phones = listIncluded<PcoPhoneNumber>(householdIndex, PCO_TYPES.phoneNumber).filter((phone) =>
    ownedBy(phone, chosen.id),
  );

  return {
    parentName,
    parentPhone: pickContactValue(phones, (phone) =>
      firstNonEmpty(phone.attributes?.number, phone.attributes?.national, phone.attributes?.e164),
    ),
    parentEmail:
      pickContactValue(emails, (email) => trimmed(email.attributes?.address)?.toLowerCase() ?? null) ??
      trimmed(attributes.primary_email_address)?.toLowerCase() ??
      null,
  };
}

/* -------------------------------------------------------------------------- */
/* Person -> access roster entry                                               */
/* -------------------------------------------------------------------------- */

/**
 * Planning Center permission -> Tally role.
 *
 * Only two Planning Center levels imply the dashboard: Manager and Editor are
 * the people who already maintain the roster. Everyone else is a door
 * volunteer, and `site_administrator` is the church's own super-user.
 */
export function mapRole(person: PcoPerson): Role {
  const attributes: PcoPersonAttributes = person.attributes ?? {};
  if (attributes.site_administrator === true) return 'admin';
  const permission = trimmed(attributes.people_permissions)?.toLowerCase();
  if (permission === 'manager' || permission === 'editor') return 'core';
  return 'counselor';
}

function primaryEmailFor(person: PcoPerson, index: IncludedIndex): string | null {
  const emails = listIncluded<PcoEmail>(index, PCO_TYPES.email).filter((email) =>
    ownedBy(email, person.id),
  );
  return (
    pickContactValue(emails, (email) => trimmed(email.attributes?.address)?.toLowerCase() ?? null) ??
    trimmed(person.attributes?.primary_email_address)?.toLowerCase() ??
    null
  );
}

/**
 * Reads a Planning Center custom field by definition name or slug.
 * Returns null when the field is not configured or the person has no value.
 */
export function extractCustomFieldValue(
  person: PcoPerson,
  index: IncludedIndex,
  fieldNameOrSlug: string | null | undefined,
): string | null {
  const wanted = trimmed(fieldNameOrSlug)?.toLowerCase();
  if (!wanted) return null;

  for (const datum of listIncluded<PcoFieldDatum>(index, PCO_TYPES.fieldDatum)) {
    const owner = datum.relationships?.customizable?.data;
    if (!owner || Array.isArray(owner) || owner.id !== person.id) continue;

    const definitionRef = datum.relationships?.field_definition?.data;
    if (!definitionRef || Array.isArray(definitionRef)) continue;
    const definition = getIncluded<PcoFieldDefinition>(
      index,
      PCO_TYPES.fieldDefinition,
      definitionRef.id,
    );
    const name = trimmed(definition?.attributes?.name)?.toLowerCase();
    const slug = trimmed(definition?.attributes?.slug)?.toLowerCase();
    if (name !== wanted && slug !== wanted) continue;

    const value = trimmed(datum.attributes?.value);
    if (value) return value;
  }
  return null;
}

/** Turns "8th Grade Boys" into the `smallGroups/{id}` convention used by the seed. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Builds the allowlist row that lets a counselor sign in at all.
 *
 * Returns null when the person has no email address: Tally authenticates by
 * email, so there is nothing to match a sign-in against. The caller counts that
 * as a skip rather than an error — it is normal for a Planning Center list to
 * contain a volunteer who never gave the church an address.
 */
export function mapPersonToAccessEntry(
  person: PcoPerson,
  ctx: AccessMappingContext,
): MappedAccessEntry | null {
  const email = primaryEmailFor(person, ctx.index);
  if (!email) return null;

  const attributes: PcoPersonAttributes = person.attributes ?? {};
  const displayName =
    firstNonEmpty(
      [firstNonEmpty(attributes.nickname, attributes.first_name), trimmed(attributes.last_name)]
        .filter(Boolean)
        .join(' '),
      attributes.name,
    ) ?? null;

  const groupName = extractCustomFieldValue(person, ctx.index, ctx.smallGroupField);

  return {
    emailKey: emailKey(email),
    email,
    displayName,
    role: mapRole(person),
    pcoPersonId: person.id,
    assignedGroupId: groupName ? slugify(groupName) : null,
    active: normaliseStatus(person) === 'active',
  };
}
