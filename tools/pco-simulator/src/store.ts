/**
 * The simulator's mutable state and the query operations the API exposes over
 * it. Everything here is synchronous and in-memory; `handler.ts` owns all HTTP
 * concerns.
 */
import {
  createFixtureOrg,
  DEFAULT_APP_ID,
  DEFAULT_SECRET,
  STALE_LIST_ID,
  STUDENT_LIST_ID,
  TEAM_LIST_ID,
} from './fixtures.js';
import type {
  SimCheckIn,
  SimCheckInsEvent,
  SimCheckInsEventTime,
  SimCheckInsPeriod,
  SimEmail,
  SimHousehold,
  SimHouseholdMembership,
  SimList,
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
   * API root echoed back in `links.self`, and in `links.next` when the
   * pagination mode is `absolute-links`.
   */
  publicUrl?: string;
  /**
   * How the simulator advertises the next page.
   *
   * `links` is what Planning Center actually sends, and it is *relative*:
   * `/people/v2/people?offset=100&per_page=100`, a path with no origin on it.
   * This simulator used to send an absolute URL in every mode, on the reasoning
   * that a client which could follow those could follow anything — which had it
   * exactly backwards. `fetch` rejects a relative URL, so the real API's own
   * link shape was the one shape nothing here ever tested, and page two of the
   * first roster larger than a single page failed with `Invalid URL`.
   *
   * `absolute-links` keeps the other shape, because a proxy in front of the API
   * may rewrite links and because it costs nothing to stay compatible with it.
   * `meta` covers the responses that carry only `meta.next`.
   *
   * `no-cursor` advertises nothing at all. A client that treats "no cursor" as
   * "no more data" truncates the roster silently — students just vanish — so
   * this mode exists to prove Tally's client keeps walking while pages come
   * back full.
   */
  pagination?: 'links' | 'absolute-links' | 'meta' | 'no-cursor';
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
  private nextCheckInsId = 9001;

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
    this.nextCheckInsId = 9001;
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

  get lists(): readonly SimList[] {
    return this.org.lists;
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

  /* ---- Check-Ins reads --------------------------------------------------- */

  get checkInsEvents(): readonly SimCheckInsEvent[] {
    return this.org.checkInsEvents;
  }

  checkInsEventById(id: string): SimCheckInsEvent | undefined {
    return this.org.checkInsEvents.find((event) => event.id === id);
  }

  checkInsPeriodsFor(eventId: string): SimCheckInsPeriod[] {
    return this.org.checkInsPeriods.filter((period) => period.event_id === eventId);
  }

  checkInsEventTimesFor(periodId: string): SimCheckInsEventTime[] {
    return this.org.checkInsEventTimes.filter((time) => time.event_period_id === periodId);
  }

  checkInsFor(eventId: string): SimCheckIn[] {
    return this.org.checkIns.filter((checkIn) => checkIn.event_id === eventId);
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
    if ('medical_notes' in attributes) {
      assign('medical_notes', optionalString(attributes.medical_notes));
    }
    if ('birthdate' in attributes) assign('birthdate', optionalString(attributes.birthdate));
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
   * `POST /households`.
   *
   * The real endpoint takes the name and primary contact as attributes and the
   * members as a JSON:API relationship, so that is what this reads. Everybody
   * named in `people` gets a membership; the primary contact is recorded as the
   * parent or guardian and everyone else as a dependent, which is the shape a
   * household created from Tally's add-a-parent form actually has.
   */
  createHousehold(input: {
    attributes: Record<string, unknown>;
    memberIds: readonly string[];
  }): SimHousehold | undefined {
    const primaryId = optionalString(input.attributes.primary_contact_id) ?? input.memberIds[0];
    const primary = primaryId ? this.personById(primaryId) : undefined;
    if (!primary) return undefined;

    const household: SimHousehold = {
      id: `H${this.org.households.length + 1000}`,
      name: optionalString(input.attributes.name) ?? `${primary.last_name} Household`,
      primary_contact_id: primary.id,
      primary_contact_name: `${primary.first_name} ${primary.last_name}`.trim(),
    };
    this.org.households.push(household);

    const members = new Set([primary.id, ...input.memberIds]);
    for (const memberId of members) {
      this.addHouseholdMember(household.id, {
        person_id: memberId,
        household_role: memberId === primary.id ? 'parent_guardian' : 'child_or_dependent',
      });
    }

    return household;
  }

  /**
   * `POST /households/{id}/household_memberships`.
   *
   * Returns the membership already on file rather than a second one when the
   * person is in this household twice over — the real API rejects the duplicate,
   * and either way what a caller must never get is two links between the same
   * pair.
   */
  addHouseholdMember(
    householdId: string,
    attributes: Record<string, unknown>,
  ): SimHouseholdMembership | undefined {
    const household = this.householdById(householdId);
    const person = this.personById(optionalString(attributes.person_id) ?? '');
    if (!household || !person) return undefined;

    const existing = this.org.memberships.find(
      (membership) => membership.household_id === householdId && membership.person_id === person.id,
    );
    if (existing) return existing;

    const membership: SimHouseholdMembership = {
      id: `M${this.org.memberships.length + 1000}`,
      household_id: householdId,
      person_id: person.id,
      household_role:
        optionalString(attributes.household_role) ?? (person.child ? 'child_or_dependent' : 'adult'),
      person_name: `${person.first_name} ${person.last_name}`.trim(),
      pending: attributes.pending === true,
    };
    this.org.memberships.push(membership);
    return membership;
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
    /**
     * The Planning Center id to assign, when the caller needs to know it in
     * advance. `scripts/seed.ts` does: Tally's student ids are derived from it,
     * and so are the attendance records it writes, so letting the simulator
     * allocate one would leave every seeded check-in pointing at nobody.
     */
    id?: string;
    firstName: string;
    lastName: string;
    grade: number;
    nickname?: string | null;
    allergies?: string | null;
    /** `YYYY-MM-DD`, or absent for a profile nobody has finished. */
    birthdate?: string | null;
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
      child: true,
      medical_notes: input.allergies ?? null,
      birthdate: input.birthdate ?? null,
      status: input.status ?? 'active',
    });
    if (input.id) student.id = input.id;

    // A seeded student belongs on the youth pastor's List, or a deployment
    // configured for list mode would see an empty ministry.
    const studentList = this.org.lists.find((entry) => entry.id === STUDENT_LIST_ID);
    if (studentList) studentList.member_ids.push(student.id);

    // The first few also land on the stale camp list, so a seeded organisation
    // has more than one plausible answer to "which list is the roster". A
    // picker that only ever shows the right choice proves nothing about the
    // wrong one.
    const campList = this.org.lists.find((entry) => entry.id === STALE_LIST_ID);
    if (campList && campList.member_ids.length < 12) campList.member_ids.push(student.id);

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

  /**
   * Seeds a whole Check-Ins event in one call: the event, its nights, the
   * kiosk windows and every check-in. The same reasoning as `seedStudent` —
   * the API is read-only, so realistic history is only expressible from
   * inside, and a test that needs "two years of Fridays with a snow week and
   * a duplicate" should be able to say so in one literal.
   *
   * Check-ins name people from the *same* person store the People API serves,
   * because that is how the real host behaves and it is the identity Tally's
   * import depends on. A `personId` that names nobody seeds a check-in whose
   * person cannot be side-loaded — deliberately expressible, so a test can
   * cover that too. A null `personId` is a one-time guest.
   */
  seedCheckInsEvent(input: {
    id?: string;
    name: string;
    frequency?: string;
    archivedAt?: string | null;
    periods?: readonly {
      id?: string;
      /** ISO instant, or null for the odd upstream period with no date. */
      startsAt: string | null;
      endsAt?: string | null;
      note?: string | null;
      eventTimes?: readonly {
        showsAt?: string | null;
        hidesAt?: string | null;
        dayOfWeek?: number | null;
        hour?: number | null;
        minute?: number | null;
      }[];
      checkIns?: readonly {
        personId?: string | null;
        /** "Regular" (default) | "Guest" | "Volunteer". */
        kind?: string;
        /** Defaults to the period's own start. */
        createdAt?: string;
        firstName?: string;
        lastName?: string;
      }[];
    }[];
  }): SimCheckInsEvent {
    const now = this.clock().toISOString();
    const event: SimCheckInsEvent = {
      id: input.id ?? `CI${this.nextCheckInsId++}`,
      name: input.name,
      frequency: input.frequency ?? 'Weekly',
      archived_at: input.archivedAt ?? null,
      created_at: now,
      updated_at: now,
    };
    this.org.checkInsEvents.push(event);

    for (const periodInput of input.periods ?? []) {
      const period: SimCheckInsPeriod = {
        id: periodInput.id ?? `CIP${this.nextCheckInsId++}`,
        event_id: event.id,
        starts_at: periodInput.startsAt,
        ends_at: periodInput.endsAt ?? null,
        note: periodInput.note ?? null,
      };
      this.org.checkInsPeriods.push(period);

      for (const timeInput of periodInput.eventTimes ?? []) {
        this.org.checkInsEventTimes.push({
          id: `CIT${this.nextCheckInsId++}`,
          event_period_id: period.id,
          starts_at: periodInput.startsAt,
          shows_at: timeInput.showsAt ?? null,
          hides_at: timeInput.hidesAt ?? null,
          day_of_week: timeInput.dayOfWeek ?? null,
          hour: timeInput.hour ?? null,
          minute: timeInput.minute ?? null,
        });
      }

      for (const checkInInput of periodInput.checkIns ?? []) {
        const personId = checkInInput.personId ?? null;
        const person = personId ? this.personById(personId) : undefined;
        this.org.checkIns.push({
          id: `CIC${this.nextCheckInsId++}`,
          event_id: event.id,
          event_period_id: period.id,
          person_id: personId,
          kind: checkInInput.kind ?? 'Regular',
          first_name: checkInInput.firstName ?? person?.first_name ?? 'Guest',
          last_name: checkInInput.lastName ?? person?.last_name ?? '',
          created_at: checkInInput.createdAt ?? periodInput.startsAt ?? now,
          one_time_guest: personId === null,
        });
      }
    }

    return event;
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
 * The Lists are deliberately not empty-as-in-absent. A list a caller names has
 * to resolve to *an empty list* rather than to a 404, because those mean
 * different things: one is "nobody on it yet", the other is "your List id is
 * wrong", and Tally reports them differently on purpose. Seeding into a fresh
 * organisation must not silently produce the second.
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
    checkInsEvents: [],
    checkInsPeriods: [],
    checkInsEventTimes: [],
    checkIns: [],
    lists: [
      {
        id: STUDENT_LIST_ID,
        name: 'Youth Students',
        member_ids: [],
        auto_refresh: true,
        refreshed_at: '2026-02-13T12:00:00Z',
        starred: true,
      },
      {
        id: TEAM_LIST_ID,
        name: 'Youth Team',
        member_ids: [],
        auto_refresh: true,
        refreshed_at: '2026-02-13T12:00:00Z',
      },
      // The decoy, and the reason the roster picker shows counts and health at
      // all: a name this similar is indistinguishable from the real list when
      // the setting is a bare id copied out of a URL.
      {
        id: STALE_LIST_ID,
        name: 'Youth Camp 2019',
        member_ids: [],
        description: 'Summer camp signups. Long over.',
        auto_refresh: false,
        refreshed_at: '2019-07-04T12:00:00Z',
        invalid: true,
      },
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
