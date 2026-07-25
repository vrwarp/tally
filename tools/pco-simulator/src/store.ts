/**
 * The simulator's mutable state and the query operations the API exposes over
 * it. Everything here is synchronous and in-memory; `handler.ts` owns all HTTP
 * concerns.
 */
import {
  createFixtureOrg,
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  STUDENT_LIST_ID,
  TEAM_LIST_ID,
} from './fixtures.js';
import type {
  SimEmail,
  SimHousehold,
  SimHouseholdMembership,
  SimOrg,
  SimPerson,
  SimPhoneNumber,
  SimRequestLogEntry,
} from './types.js';

/** Origin the simulator claims to be reachable at, used to build `links`. */
export const DEFAULT_PUBLIC_URL = 'https://pco.simulator.test/people/v2';

export interface SimulatorOptions {
  /** Personal Access Token pair the simulator will accept. */
  appId?: string;
  secret?: string;
  /**
   * API root echoed back in `links.self` / `links.next`.
   *
   * The real API returns pagination links as absolute URLs, so the simulator
   * must too — a relative link would let a client that cannot handle absolute
   * ones pass here and fail in production.
   */
  publicUrl?: string;
  /**
   * How the simulator advertises the next page.
   *
   * The real API sends `links.next`; some responses only carry `meta.next`.
   * Both are exercised because the client supports both, and a client that
   * silently handled only one would look fine right up until Planning Center
   * changed which it sent.
   *
   * `no-cursor` advertises nothing at all. A client that treats "no cursor" as
   * "no more data" truncates the roster silently — students just vanish — so
   * this mode exists to prove Tally's client keeps walking while pages come
   * back full.
   */
  pagination?: 'links' | 'meta' | 'no-cursor';
  /** Records served per page. The real API caps at 100. */
  pageSize?: number;
  /** Start the org empty instead of seeded — used by write-back tests. */
  empty?: boolean;
  /** Fixed clock, so `created_at` on written records is reproducible. */
  now?: () => Date;
}

export interface RateLimitPlan {
  /** Reject this many requests with 429 before letting one through. */
  count: number;
  /** Value for the `Retry-After` header, in seconds. */
  retryAfterSeconds: number;
}

export class SimulatorStore {
  private org: SimOrg;
  private nextPersonId = 6_600_001;
  private nextEmailId = 9001;
  private nextPhoneId = 9001;

  readonly appId: string;
  readonly secret: string;
  readonly pagination: NonNullable<SimulatorOptions['pagination']>;
  readonly publicUrl: string;
  readonly pageSize: number;
  private readonly clock: () => Date;

  /** Every request served, in order. Tests assert against this. */
  readonly requestLog: SimRequestLogEntry[] = [];

  /** Pending fault injection, consumed as requests arrive. */
  private rateLimit: RateLimitPlan | null = null;
  private failWith: { status: number; message: string; count: number } | null = null;

  constructor(private readonly options: SimulatorOptions = {}) {
    this.appId = options.appId ?? DEFAULT_APP_ID;
    this.secret = options.secret ?? DEFAULT_SECRET;
    this.pagination = options.pagination ?? 'links';
    this.publicUrl = (options.publicUrl ?? DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
    this.pageSize = Math.max(1, Math.min(100, options.pageSize ?? 25));
    this.clock = options.now ?? (() => new Date());
    this.org = options.empty ? emptyOrg() : createFixtureOrg();
  }

  /** Restores the seeded organisation and clears logs and fault injection. */
  /**
   * @param overrides `{ empty: true }` starts from nothing, for a caller that
   *        is about to seed its own ministry rather than use the fixtures.
   */
  reset(overrides: Pick<SimulatorOptions, 'empty'> = {}): void {
    const empty = overrides.empty ?? this.options.empty;
    this.org = empty ? emptyOrg() : createFixtureOrg();
    this.requestLog.length = 0;
    this.rateLimit = null;
    this.failWith = null;
    this.nextPersonId = 6_600_001;
  }

  /**
   * Disarms fault injection without touching the organisation.
   *
   * A test that armed a 500 needs to put that back; it does *not* want the
   * seeded ministry replaced by the built-in fixtures, which is what `reset`
   * would do. Since Tally reads its roster from here rather than from Firestore,
   * that would leave the next test looking at a different church.
   */
  clearFaults(): void {
    this.rateLimit = null;
    this.failWith = null;
  }

  /* ---- fault injection ------------------------------------------------- */

  /** Makes the next `count` requests answer 429 with `Retry-After`. */
  scheduleRateLimit(plan: RateLimitPlan): void {
    this.rateLimit = { ...plan };
  }

  /** Makes the next `count` requests answer with an arbitrary error status. */
  scheduleFailure(status: number, message: string, count = 1): void {
    this.failWith = { status, message, count };
  }

  /** Returns a pending fault to apply, consuming one use of it. */
  takeFault(): { status: number; message: string; retryAfter?: number } | null {
    if (this.rateLimit && this.rateLimit.count > 0) {
      this.rateLimit.count -= 1;
      return {
        status: 429,
        message: 'Rate limit exceeded',
        retryAfter: this.rateLimit.retryAfterSeconds,
      };
    }
    if (this.failWith && this.failWith.count > 0) {
      this.failWith.count -= 1;
      return { status: this.failWith.status, message: this.failWith.message };
    }
    return null;
  }

  /* ---- reads ----------------------------------------------------------- */

  get people(): readonly SimPerson[] {
    return this.org.people;
  }

  personById(id: string): SimPerson | undefined {
    return this.org.people.find((person) => person.id === id);
  }

  emailsFor(personId: string): SimEmail[] {
    return this.org.emails.filter((email) => email.person_id === personId);
  }

  phonesFor(personId: string): SimPhoneNumber[] {
    return this.org.phoneNumbers.filter((phone) => phone.person_id === personId);
  }

  primaryEmail(personId: string): SimEmail | undefined {
    const all = this.emailsFor(personId);
    return all.find((email) => email.primary) ?? all[0];
  }

  membershipsForPerson(personId: string): SimHouseholdMembership[] {
    return this.org.memberships.filter((m) => m.person_id === personId);
  }

  membershipsForHousehold(householdId: string): SimHouseholdMembership[] {
    return this.org.memberships
      .filter((m) => m.household_id === householdId)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  householdsForPerson(personId: string): SimHousehold[] {
    const ids = new Set(this.membershipsForPerson(personId).map((m) => m.household_id));
    return this.org.households.filter((household) => ids.has(household.id));
  }

  householdById(id: string): SimHousehold | undefined {
    return this.org.households.find((household) => household.id === id);
  }

  memberCount(householdId: string): number {
    return this.membershipsForHousehold(householdId).length;
  }

  listById(id: string) {
    return this.org.lists.find((list) => list.id === id);
  }

  fieldDataFor(personId: string) {
    return this.org.fieldData.filter((datum) => datum.person_id === personId);
  }

  fieldDefinitionById(id: string) {
    return this.org.fieldDefinitions.find((definition) => definition.id === id);
  }

  /* ---- writes ---------------------------------------------------------- */

  /**
   * Creates a person, mirroring the subset of attributes the real API accepts
   * on `POST /people`. Unknown attributes are ignored rather than rejected,
   * which is what the real API does.
   */
  createPerson(attributes: Record<string, unknown>): SimPerson {
    const now = this.clock().toISOString();
    const person: SimPerson = {
      id: String(this.nextPersonId++),
      first_name: String(attributes.first_name ?? ''),
      last_name: String(attributes.last_name ?? ''),
      nickname: optionalString(attributes.nickname),
      given_name: optionalString(attributes.given_name),
      grade: optionalNumber(attributes.grade),
      graduation_year: optionalNumber(attributes.graduation_year),
      gender: optionalString(attributes.gender),
      birthdate: optionalString(attributes.birthdate),
      child: attributes.child === true,
      medical_notes: optionalString(attributes.medical_notes),
      status: attributes.status === 'inactive' ? 'inactive' : 'active',
      inactivated_at: attributes.status === 'inactive' ? now : null,
      people_permissions: optionalString(attributes.people_permissions),
      site_administrator: attributes.site_administrator === true,
      created_at: now,
      updated_at: now,
    };
    this.org.people.push(person);
    return person;
  }

  updatePerson(id: string, attributes: Record<string, unknown>): SimPerson | undefined {
    const person = this.personById(id);
    if (!person) return undefined;

    const assign = <K extends keyof SimPerson>(key: K, value: SimPerson[K] | undefined) => {
      if (value !== undefined) person[key] = value;
    };

    if ('first_name' in attributes) assign('first_name', String(attributes.first_name ?? ''));
    if ('last_name' in attributes) assign('last_name', String(attributes.last_name ?? ''));
    if ('nickname' in attributes) assign('nickname', optionalString(attributes.nickname));
    if ('grade' in attributes) assign('grade', optionalNumber(attributes.grade));
    if ('gender' in attributes) assign('gender', optionalString(attributes.gender));
    if ('medical_notes' in attributes) {
      assign('medical_notes', optionalString(attributes.medical_notes));
    }
    if ('child' in attributes) assign('child', attributes.child === true);
    if ('status' in attributes) {
      const inactive = attributes.status === 'inactive';
      person.status = inactive ? 'inactive' : 'active';
      person.inactivated_at = inactive ? this.clock().toISOString() : null;
    }

    person.updated_at = this.clock().toISOString();
    return person;
  }

  /**
   * Adds a whole family in one go: the student, a parent, the household that
   * ties them together, and the contact details on the parent.
   *
   * Exists because seeding a realistic ministry through the public API alone
   * would be a dozen round-trips per student — Planning Center has no bulk
   * create, and household membership is not settable from `POST /people`. The
   * seed script drives this through `/_sim/seed`.
   */
  seedStudent(input: {
    firstName: string;
    lastName: string;
    grade: number;
    gender?: string;
    nickname?: string | null;
    allergies?: string | null;
    status?: 'active' | 'inactive';
    parentName?: string | null;
    parentPhone?: string | null;
    parentEmail?: string | null;
  }): SimPerson {
    const student = this.createPerson({
      first_name: input.firstName,
      last_name: input.lastName,
      nickname: input.nickname ?? null,
      grade: input.grade,
      gender: input.gender ?? null,
      child: true,
      medical_notes: input.allergies ?? null,
      status: input.status ?? 'active',
    });

    // A seeded student belongs on the youth pastor's List, or a deployment
    // configured for list mode would see an empty ministry.
    const studentList = this.org.lists.find((entry) => entry.id === STUDENT_LIST_ID);
    if (studentList) studentList.member_ids.push(student.id);

    // No parent named means a student the church has on file but cannot reach —
    // exactly the case the "incomplete profile" list exists for, so it has to
    // be expressible here.
    if (!input.parentName) return student;

    const [parentFirst, ...rest] = input.parentName.trim().split(/\s+/);
    const parent = this.createPerson({
      first_name: parentFirst ?? input.parentName,
      last_name: rest.join(' ') || input.lastName,
      child: false,
    });

    if (input.parentPhone) this.addPhone(parent.id, input.parentPhone);
    if (input.parentEmail) this.addEmail(parent.id, input.parentEmail);

    const household: SimHousehold = {
      id: `H${this.org.households.length + 1000}`,
      name: `${input.lastName} Household`,
      primary_contact_id: parent.id,
      primary_contact_name: `${parent.first_name} ${parent.last_name}`.trim(),
    };
    this.org.households.push(household);

    this.org.memberships.push(
      {
        id: `M${this.org.memberships.length + 1000}`,
        household_id: household.id,
        person_id: parent.id,
        household_role: 'parent_guardian',
        person_name: household.primary_contact_name,
        pending: false,
      },
      {
        id: `M${this.org.memberships.length + 1001}`,
        household_id: household.id,
        person_id: student.id,
        household_role: 'child_or_dependent',
        person_name: `${student.first_name} ${student.last_name}`.trim(),
        pending: false,
      },
    );

    return student;
  }

  /** Adds somebody to the team list, so `provisionAccess` will let them in. */
  seedTeamMember(input: {
    firstName: string;
    lastName: string;
    email: string;
    permissions?: string;
    siteAdministrator?: boolean;
  }): SimPerson {
    const person = this.createPerson({
      first_name: input.firstName,
      last_name: input.lastName,
      child: false,
      people_permissions: input.permissions ?? 'Viewer',
      site_administrator: input.siteAdministrator === true,
    });
    this.addEmail(person.id, input.email);

    const list = this.org.lists.find((entry) => entry.id === TEAM_LIST_ID);
    if (list) list.member_ids.push(person.id);

    return person;
  }

  addEmail(personId: string, address: string, primary = true): SimEmail {
    const email: SimEmail = {
      id: `E${this.nextEmailId++}`,
      person_id: personId,
      address,
      location: 'Home',
      primary,
      blocked: false,
    };
    this.org.emails.push(email);
    return email;
  }

  addPhone(personId: string, number: string, primary = true): SimPhoneNumber {
    const phone: SimPhoneNumber = {
      id: `P${this.nextPhoneId++}`,
      person_id: personId,
      number,
      e164: `+1${number.replace(/\D/g, '')}`,
      location: 'Mobile',
      primary,
    };
    this.org.phoneNumbers.push(phone);
    return phone;
  }

  /** Adds a person to a list, as a youth pastor would in the Planning Center UI. */
  addToList(listId: string, personId: string): void {
    const list = this.listById(listId);
    if (list && !list.member_ids.includes(personId)) list.member_ids.push(personId);
  }

  removeFromList(listId: string, personId: string): void {
    const list = this.listById(listId);
    if (!list) return;
    list.member_ids = list.member_ids.filter((id) => id !== personId);
  }
}

/**
 * An organisation with nobody in it — but with the two Lists still there.
 *
 * The Lists are deliberately not empty-as-in-absent. A configuration pointing
 * at `PCO_STUDENT_LIST_ID` has to resolve to *an empty list* rather than to a
 * 404, because those mean different things: one is "no students yet", the
 * other is "your List id is wrong", and Tally reports them differently on
 * purpose. Seeding into a fresh organisation must not silently produce the
 * second.
 */
function emptyOrg(): SimOrg {
  return {
    people: [],
    emails: [],
    phoneNumbers: [],
    households: [],
    memberships: [],
    fieldDefinitions: [],
    fieldData: [],
    lists: [
      { id: STUDENT_LIST_ID, name: 'Footprints Students', member_ids: [] },
      { id: TEAM_LIST_ID, name: 'Footprints Team', member_ids: [] },
    ],
  };
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
