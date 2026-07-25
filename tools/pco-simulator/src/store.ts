/**
 * The simulator's mutable state and the query operations the API exposes over
 * it. Everything here is synchronous and in-memory; `handler.ts` owns all HTTP
 * concerns.
 */
import { createFixtureOrg, DEFAULT_APP_ID, DEFAULT_SECRET } from './fixtures.js';
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
  reset(): void {
    this.org = this.options.empty ? emptyOrg() : createFixtureOrg();
    this.requestLog.length = 0;
    this.rateLimit = null;
    this.failWith = null;
    this.nextPersonId = 6_600_001;
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

function emptyOrg(): SimOrg {
  return {
    people: [],
    emails: [],
    phoneNumbers: [],
    households: [],
    memberships: [],
    fieldDefinitions: [],
    fieldData: [],
    lists: [],
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
