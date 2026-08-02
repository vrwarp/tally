/**
 * The simulated Planning Center organisation.
 *
 * This is not filler data. Every record here exists to exercise a decision the
 * real mapping code has to make, and the awkward ones are the point:
 *
 *   - a student whose `nickname` differs from `first_name`
 *   - a student whose `nickname` is in another script, so neither half of the
 *     name can stand in for the other
 *   - a student with no `grade`, carrying only a `graduation_year`
 *   - a 5th grader, who must be excluded from a 6-12 ministry
 *   - an inactive person, who must be deactivated rather than deleted
 *   - students with no `birthdate` at all, and one born on 29 February
 *   - birthdays either side of the anchor, so the roster's week-ahead and
 *     week-behind chips both have somebody to land on
 *   - a household with two adults, so the parent-contact pick has to be stable
 *   - a household with no adult at all
 *   - a team member with no email address, who cannot be granted access
 *
 * Person ids deliberately sit in a different range from the ones
 * `scripts/seed.ts` assigns, so the two seeded worlds stay distinguishable: a
 * student that appears in Tally after a sync provably came from here.
 */
import type {
  SimCheckIn,
  SimCheckInsEvent,
  SimCheckInsEventTime,
  SimCheckInsPeriod,
  SimEmail,
  SimFieldDatum,
  SimFieldDefinition,
  SimHousehold,
  SimHouseholdMembership,
  SimList,
  SimOrg,
  SimPerson,
  SimPhoneNumber,
} from './types.js';

/** Fixed so `where[updated_at][gt]` behaviour is reproducible across runs. */
export const FIXTURE_ANCHOR = new Date('2026-07-01T12:00:00.000Z');

export const STUDENT_LIST_ID = 'YOUTH_STUDENTS';
export const TEAM_LIST_ID = 'YOUTH_TEAM';
/** A list that exists, has members, and is the wrong answer. See `createFixtureOrg`. */
export const STALE_LIST_ID = 'YOUTH_CAMP_2019';

/** Default Personal Access Token pair the simulator accepts. */
export const DEFAULT_APP_ID = 'sim-app-id';
export const DEFAULT_SECRET = 'sim-secret';

/** The Check-Ins event worth importing: weekly, with history and its quirks. */
export const CHECKINS_WEEKLY_EVENT_ID = 'CI770001';
/** Archived — must not be offered for import. */
export const CHECKINS_ARCHIVED_EVENT_ID = 'CI770002';
/** `frequency: "None"` — importable history, nothing to project ahead. */
export const CHECKINS_ONE_OFF_EVENT_ID = 'CI770003';

function iso(daysBefore: number): string {
  return new Date(FIXTURE_ANCHOR.getTime() - daysBefore * 86_400_000).toISOString();
}

interface YouthSpec {
  id: string;
  first: string;
  last: string;
  nickname?: string;
  grade: number | null;
  graduationYear?: number;
  allergies?: string;
  /**
   * `YYYY-MM-DD`, the way Planning Center sends it, or omitted for a profile
   * nobody has finished — which is a real and common state and the one the
   * roster's "no birthday" chip exists to surface.
   */
  birthdate?: string;
  inactive?: boolean;
  /** Days before the anchor this person was last touched in Planning Center. */
  updatedDaysAgo: number;
  household?: string;
}

const YOUTH: readonly YouthSpec[] = [
  { id: '4200001', first: 'Amara', last: 'Okonkwo', grade: 8, birthdate: '2011-03-14', updatedDaysAgo: 2, household: 'H1' },
  { id: '4200002', first: 'Benjamin', last: 'Okonkwo', nickname: 'Benji', grade: 6, birthdate: '2013-11-02', updatedDaysAgo: 2, household: 'H1' },
  { id: '4200003', first: 'Sofia', last: 'Delgado', grade: 11, allergies: 'Severe peanut allergy — EpiPen in her bag', birthdate: '2008-06-28', updatedDaysAgo: 5, household: 'H2' },
  { id: '4200004', first: 'Mateo', last: 'Delgado', grade: 7, birthdate: '2012-09-19', updatedDaysAgo: 40, household: 'H2' },
  { id: '4200005', first: 'Hannah', last: 'Kim', grade: 9, birthdate: '2010-07-04', updatedDaysAgo: 1, household: 'H3' },
  { id: '4200006', first: 'Joshua', last: 'Kim', grade: 12, birthdate: '2007-12-30', updatedDaysAgo: 60, household: 'H3' },
  { id: '4200007', first: 'Priyanka', last: 'Raman', nickname: 'Pri', grade: 10, birthdate: '2009-05-21', updatedDaysAgo: 9, household: 'H4' },
  { id: '4200008', first: 'Elijah', last: 'Brooks', grade: 8, allergies: 'Lactose intolerant', birthdate: '2011-01-09', updatedDaysAgo: 3, household: 'H5' },
  { id: '4200009', first: 'Naomi', last: 'Brooks', grade: 6, updatedDaysAgo: 3, household: 'H5' },
  { id: '4200010', first: 'Tobias', last: 'Fischer', grade: 7, birthdate: '2012-08-15', updatedDaysAgo: 14, household: 'H6' },
  { id: '4200011', first: 'Leila', last: 'Haddad', grade: 11, birthdate: '2008-02-29', updatedDaysAgo: 21, household: 'H7' },
  { id: '4200012', first: 'Caleb', last: 'Nguyen', grade: 9, birthdate: '2010-10-11', updatedDaysAgo: 6, household: 'H8' },
  { id: '4200013', first: 'Zara', last: 'Ahmed', grade: 10, updatedDaysAgo: 4, household: 'H9' },
  { id: '4200014', first: 'Marcus', last: 'Johnson', grade: 12, birthdate: '2007-04-06', updatedDaysAgo: 30, household: 'H10' },
  // Grade is blank; only a graduation year is on file. The mapper has to derive it.
  { id: '4200015', first: 'Ivy', last: 'Petrova', grade: null, graduationYear: 2030, birthdate: '2012-06-25', updatedDaysAgo: 7 },
  // A 5th grader: too young for a 6-12 ministry and must never reach the roster.
  { id: '4200016', first: 'Oliver', last: 'Grant', grade: 5, birthdate: '2014-05-05', updatedDaysAgo: 8, household: 'H11' },
  // Left the ministry — must be deactivated, never deleted, because attendance
  // history points at this record.
  { id: '4200017', first: 'Ruth', last: 'Abebe', grade: 12, inactive: true, birthdate: '2007-09-13', updatedDaysAgo: 11 },
  // Lives with a grandparent whose household role is "other_adult".
  { id: '4200018', first: 'Dexter', last: 'Cole', grade: 6, birthdate: '2013-07-07', updatedDaysAgo: 12, household: 'H12' },
  // A nickname in a script the roster cannot fold down to Latin letters.
  // Planning Center shows him as `Benson “蔡秉洲” Tsai`, and so must Tally —
  // keeping only one half means the profile and the roster row cannot be
  // matched up by eye.
  { id: '4200019', first: 'Benson', last: 'Tsai', nickname: '蔡秉洲', grade: 6, updatedDaysAgo: 4, household: 'H13' },
];

interface AdultSpec {
  id: string;
  first: string;
  last: string;
  household: string;
  role: 'parent_guardian' | 'adult' | 'other_adult';
  email?: string;
  phone?: string;
}

const PARENTS: readonly AdultSpec[] = [
  { id: '5200001', first: 'Chidi', last: 'Okonkwo', household: 'H1', role: 'parent_guardian', email: 'chidi.okonkwo@example.org', phone: '(555) 010-1001' },
  // Two adults in one household: the pick has to be deterministic, not "whichever
  // the index happened to yield this run".
  { id: '5200002', first: 'Ngozi', last: 'Okonkwo', household: 'H1', role: 'parent_guardian', email: 'ngozi.okonkwo@example.org', phone: '(555) 010-1002' },
  { id: '5200003', first: 'Rosa', last: 'Delgado', household: 'H2', role: 'parent_guardian', email: 'rosa.delgado@example.org', phone: '(555) 010-1003' },
  { id: '5200004', first: 'Grace', last: 'Kim', household: 'H3', role: 'adult', email: 'grace.kim@example.org', phone: '(555) 010-1004' },
  // Phone only — no email. Profile completeness must still be satisfied.
  { id: '5200005', first: 'Anand', last: 'Raman', household: 'H4', role: 'parent_guardian', phone: '(555) 010-1005' },
  { id: '5200006', first: 'Denise', last: 'Brooks', household: 'H5', role: 'parent_guardian', email: 'denise.brooks@example.org', phone: '(555) 010-1006' },
  { id: '5200007', first: 'Klaus', last: 'Fischer', household: 'H6', role: 'parent_guardian', email: 'klaus.fischer@example.org' },
  { id: '5200008', first: 'Yara', last: 'Haddad', household: 'H7', role: 'parent_guardian', phone: '(555) 010-1008' },
  { id: '5200009', first: 'Linh', last: 'Nguyen', household: 'H8', role: 'parent_guardian', email: 'linh.nguyen@example.org', phone: '(555) 010-1009' },
  { id: '5200010', first: 'Samir', last: 'Ahmed', household: 'H9', role: 'parent_guardian', email: 'samir.ahmed@example.org', phone: '(555) 010-1010' },
  { id: '5200011', first: 'Yolanda', last: 'Grant', household: 'H11', role: 'parent_guardian', email: 'yolanda.grant@example.org' },
  { id: '5200012', first: 'Wilma', last: 'Cole', household: 'H12', role: 'other_adult', phone: '(555) 010-1012' },
  { id: '5200013', first: 'Mei', last: 'Tsai', household: 'H13', role: 'parent_guardian', email: 'mei.tsai@example.org', phone: '(555) 010-1013' },
];

interface TeamSpec {
  id: string;
  first: string;
  last: string;
  email?: string;
  permissions: string | null;
  siteAdmin?: boolean;
}

/**
 * The first three ids and addresses match `scripts/seed.ts`, so a sync run in a
 * seeded environment updates the existing team rather than growing a parallel
 * one. The fourth is new: it proves a sync actually adds access.
 */
const TEAM: readonly TeamSpec[] = [
  { id: '9100001', first: 'Dana', last: 'Ruiz', email: 'dana.ruiz@example.org', permissions: 'Manager', siteAdmin: true },
  { id: '9100002', first: 'Miriam', last: 'Achebe', email: 'miriam.achebe@example.org', permissions: 'Manager' },
  { id: '9100003', first: 'Sam', last: 'Whitfield', email: 'sam.whitfield@example.org', permissions: 'Viewer' },
  { id: '9100004', first: 'Priya', last: 'Raman', email: 'priya.raman@example.org', permissions: 'Editor' },
  // No email address on file: cannot be granted access, and must not crash the sync.
  { id: '9100005', first: 'Gerald', last: 'Fontaine', permissions: 'Viewer' },
];

const HOUSEHOLD_NAMES: Record<string, string> = {
  H1: 'Okonkwo Household',
  H2: 'Delgado Household',
  H3: 'Kim Household',
  H4: 'Raman Household',
  H5: 'Brooks Household',
  H6: 'Fischer Household',
  H7: 'Haddad Household',
  H8: 'Nguyen Household',
  H9: 'Ahmed Household',
  H10: 'Johnson Household',
  H11: 'Grant Household',
  H12: 'Cole Household',
  H13: 'Tsai Household',
};

/**
 * Builds a fresh, independent copy of the organisation.
 *
 * Returned by value on every call so a test that creates a person through the
 * write-back path cannot leak into the next test.
 */
export function createFixtureOrg(): SimOrg {
  const people: SimPerson[] = [];
  const emails: SimEmail[] = [];
  const phoneNumbers: SimPhoneNumber[] = [];
  const memberships: SimHouseholdMembership[] = [];
  const fieldData: SimFieldDatum[] = [];

  let emailSeq = 1;
  let phoneSeq = 1;
  let membershipSeq = 1;

  const fieldDefinitions: SimFieldDefinition[] = [];

  for (const spec of YOUTH) {
    people.push({
      id: spec.id,
      first_name: spec.first,
      last_name: spec.last,
      nickname: spec.nickname ?? null,
      given_name: spec.first,
      grade: spec.grade,
      graduation_year: spec.graduationYear ?? null,
      birthdate: spec.birthdate ?? null,
      child: true,
      medical_notes: spec.allergies ?? null,
      status: spec.inactive ? 'inactive' : 'active',
      inactivated_at: spec.inactive ? iso(spec.updatedDaysAgo) : null,
      people_permissions: null,
      site_administrator: false,
      created_at: iso(400),
      updated_at: iso(spec.updatedDaysAgo),
    });

    if (spec.household) {
      memberships.push({
        id: `HM${membershipSeq++}`,
        household_id: spec.household,
        person_id: spec.id,
        household_role: 'child_or_dependent',
        person_name: `${spec.first} ${spec.last}`,
        pending: false,
      });
    }

  }

  for (const spec of PARENTS) {
    people.push({
      id: spec.id,
      first_name: spec.first,
      last_name: spec.last,
      nickname: null,
      given_name: spec.first,
      grade: null,
      graduation_year: null,
      birthdate: null,
      child: false,
      medical_notes: null,
      status: 'active',
      inactivated_at: null,
      people_permissions: null,
      site_administrator: false,
      created_at: iso(400),
      updated_at: iso(45),
    });

    memberships.push({
      id: `HM${membershipSeq++}`,
      household_id: spec.household,
      person_id: spec.id,
      household_role: spec.role,
      person_name: `${spec.first} ${spec.last}`,
      pending: false,
    });

    if (spec.email) {
      emails.push({
        id: `E${emailSeq++}`,
        person_id: spec.id,
        address: spec.email,
        location: 'Home',
        primary: true,
        blocked: false,
      });
    }
    if (spec.phone) {
      phoneNumbers.push({
        id: `P${phoneSeq++}`,
        person_id: spec.id,
        number: spec.phone,
        e164: `+1${spec.phone.replace(/\D/g, '')}`,
        location: 'Mobile',
        primary: true,
      });
    }
  }

  for (const spec of TEAM) {
    people.push({
      id: spec.id,
      first_name: spec.first,
      last_name: spec.last,
      nickname: null,
      given_name: spec.first,
      grade: null,
      graduation_year: null,
      birthdate: null,
      child: false,
      medical_notes: null,
      status: 'active',
      inactivated_at: null,
      people_permissions: spec.permissions,
      site_administrator: spec.siteAdmin ?? false,
      created_at: iso(500),
      updated_at: iso(20),
    });

    if (spec.email) {
      emails.push({
        id: `E${emailSeq++}`,
        person_id: spec.id,
        address: spec.email,
        location: 'Work',
        primary: true,
        blocked: false,
      });
    }
  }

  const householdIds = [...new Set(memberships.map((m) => m.household_id))].sort();
  const households: SimHousehold[] = householdIds.map((id) => {
    const adult = memberships.find(
      (m) => m.household_id === id && m.household_role !== 'child_or_dependent',
    );
    const any = memberships.find((m) => m.household_id === id);
    return {
      id,
      name: HOUSEHOLD_NAMES[id] ?? `${id} Household`,
      primary_contact_id: adult?.person_id ?? any?.person_id ?? '',
      primary_contact_name: adult?.person_name ?? any?.person_name ?? '',
    };
  });

  const lists: SimList[] = [
    {
      id: STUDENT_LIST_ID,
      name: 'Youth Students',
      description: 'Everyone in the youth ministry, maintained by the youth pastor.',
      // The list is what a youth pastor maintains by hand, so it includes the
      // student with no grade and excludes the 5th grader — the two cases where
      // a human overrules the grade filter in either direction.
      member_ids: YOUTH.filter((y) => y.id !== '4200016').map((y) => y.id),
      refreshed_at: '2026-02-13T12:00:00Z',
      auto_refresh: true,
      starred: true,
    },
    {
      id: TEAM_LIST_ID,
      name: 'Youth Team',
      description: 'Adult counselors and core team.',
      member_ids: TEAM.map((t) => t.id),
      refreshed_at: '2026-02-13T12:00:00Z',
      auto_refresh: true,
    },
    /*
     * A third list nobody should pick, and the reason the picker shows counts
     * and health at all: it is stale, it is broken upstream, and its name is
     * close enough to the real one to be chosen by mistake from a bare id.
     */
    {
      id: STALE_LIST_ID,
      name: 'Youth Camp 2019',
      description: 'Summer camp signups. Long over.',
      member_ids: YOUTH.slice(0, 3).map((y) => y.id),
      refreshed_at: '2019-07-04T12:00:00Z',
      auto_refresh: false,
      invalid: true,
    },
  ];

  const checkIns = createCheckInsFixture();

  return {
    people,
    emails,
    phoneNumbers,
    households,
    memberships,
    fieldDefinitions,
    fieldData,
    lists,
    ...checkIns,
  };
}

/**
 * The Check-Ins half of the fixture organisation: the kiosk that was counting
 * this ministry before Tally existed, with every quirk the import has to
 * survive on display.
 *
 *  - four Friday nights, one of which nobody attended (a snow week)
 *  - one period with no date at all, which the real API genuinely serves
 *  - a duplicate check-in (checked out and back in on one night)
 *  - a volunteer's check-in — a leader, not a student
 *  - a one-time guest with no person record behind the name
 *  - a `Guest`-kind check-in for a real person, who *is* an attendee
 *  - an archived event and a `frequency: "None"` event, for the picker
 *
 * Fridays are 19:30 America/Los_Angeles, stored the way the API stores them —
 * as UTC instants the night lands on Saturday in. Getting the local calendar
 * day back out of these is exactly the work the import's id derivation does,
 * so the fixture must not make it easy by lying in UTC.
 */
function createCheckInsFixture(): Pick<
  SimOrg,
  'checkInsEvents' | 'checkInsPeriods' | 'checkInsEventTimes' | 'checkIns'
> {
  const checkInsEvents: SimCheckInsEvent[] = [
    {
      id: CHECKINS_WEEKLY_EVENT_ID,
      name: 'Friday Fellowship',
      frequency: 'Weekly',
      archived_at: null,
      created_at: iso(400),
      updated_at: iso(4),
    },
    {
      id: CHECKINS_ARCHIVED_EVENT_ID,
      name: 'VBS 2019',
      frequency: 'Daily',
      archived_at: '2019-08-01T12:00:00Z',
      created_at: '2019-06-01T12:00:00Z',
      updated_at: '2019-08-01T12:00:00Z',
    },
    {
      id: CHECKINS_ONE_OFF_EVENT_ID,
      name: 'Winter Retreat Check-In',
      frequency: 'None',
      archived_at: null,
      created_at: iso(200),
      updated_at: iso(150),
    },
  ];

  /** Friday 19:30 PDT is Saturday 02:30 UTC; two hours long. */
  const friday = (utcDay: string) => ({
    startsAt: `${utcDay}T02:30:00Z`,
    endsAt: `${utcDay}T04:30:00Z`,
  });
  const nights = [
    { id: 'CIP1', ...friday('2026-06-06') },
    { id: 'CIP2', ...friday('2026-06-13') }, // the snow week — nobody came
    { id: 'CIP3', ...friday('2026-06-20') },
    { id: 'CIP4', ...friday('2026-06-27') },
  ];

  const checkInsPeriods: SimCheckInsPeriod[] = [
    ...nights.map((night) => ({
      id: night.id,
      event_id: CHECKINS_WEEKLY_EVENT_ID,
      starts_at: night.startsAt,
      ends_at: night.endsAt,
      note: null,
    })),
    // The dateless period the real API serves — a kiosk opened against nothing.
    {
      id: 'CIP5',
      event_id: CHECKINS_WEEKLY_EVENT_ID,
      starts_at: null,
      ends_at: null,
      note: null,
    },
    {
      id: 'CIP6',
      event_id: CHECKINS_ONE_OFF_EVENT_ID,
      starts_at: '2026-01-17T18:00:00Z',
      ends_at: '2026-01-17T20:00:00Z',
      note: null,
    },
  ];

  const checkInsEventTimes: SimCheckInsEventTime[] = nights.map((night, index) => ({
    id: `CIT${index + 1}`,
    event_period_id: night.id,
    starts_at: night.startsAt,
    shows_at: new Date(Date.parse(night.startsAt) - 30 * 60_000).toISOString(),
    hides_at: night.endsAt,
    day_of_week: 5,
    hour: 19,
    minute: 30,
  }));

  let sequence = 1;
  const checkIn = (input: {
    periodId: string;
    personId?: string | null;
    kind?: string;
    minutesAfter?: number;
    firstName?: string;
    lastName?: string;
  }): SimCheckIn => {
    const period = checkInsPeriods.find((candidate) => candidate.id === input.periodId)!;
    const base = period.starts_at ? Date.parse(period.starts_at) : Date.parse(iso(30));
    return {
      id: `CIC${sequence++}`,
      event_id: period.event_id,
      event_period_id: period.id,
      person_id: input.personId ?? null,
      kind: input.kind ?? 'Regular',
      first_name: input.firstName ?? 'Guest',
      last_name: input.lastName ?? '',
      created_at: new Date(base + (input.minutesAfter ?? 0) * 60_000).toISOString(),
      one_time_guest: (input.personId ?? null) === null,
    };
  };

  const amara = '4200001';
  const benji = '4200002';
  const sofia = '4200003';
  const mateo = '4200004';
  const chidiParent = '5200001';

  const checkIns: SimCheckIn[] = [
    // Night one: two regulars, a duplicate, and a volunteering parent.
    checkIn({ periodId: 'CIP1', personId: amara, firstName: 'Amara', lastName: 'Okonkwo' }),
    checkIn({ periodId: 'CIP1', personId: benji, minutesAfter: 3, firstName: 'Benjamin', lastName: 'Okonkwo' }),
    // Checked out and back in 40 minutes later — one student, one night, one row.
    checkIn({ periodId: 'CIP1', personId: amara, minutesAfter: 40, firstName: 'Amara', lastName: 'Okonkwo' }),
    checkIn({ periodId: 'CIP1', personId: chidiParent, kind: 'Volunteer', firstName: 'Chidi', lastName: 'Okonkwo' }),

    // Night three: a regular, a Guest-kind check-in for a real person, and a
    // one-time guest who exists only as a name typed at the kiosk.
    checkIn({ periodId: 'CIP3', personId: amara, firstName: 'Amara', lastName: 'Okonkwo' }),
    checkIn({ periodId: 'CIP3', personId: mateo, kind: 'Guest', minutesAfter: 12, firstName: 'Mateo', lastName: 'Delgado' }),
    checkIn({ periodId: 'CIP3', personId: null, kind: 'Guest', minutesAfter: 15, firstName: 'Walk-in', lastName: 'Wendy' }),

    // Night four, the latest — what the recurrence rule anchors on.
    checkIn({ periodId: 'CIP4', personId: amara, firstName: 'Amara', lastName: 'Okonkwo' }),
    checkIn({ periodId: 'CIP4', personId: benji, minutesAfter: 2, firstName: 'Benjamin', lastName: 'Okonkwo' }),
    checkIn({ periodId: 'CIP4', personId: sofia, minutesAfter: 5, firstName: 'Sofia', lastName: 'Delgado' }),

    // The retreat: one night, one student.
    checkIn({ periodId: 'CIP6', personId: sofia, firstName: 'Sofia', lastName: 'Delgado' }),
  ];

  return { checkInsEvents, checkInsPeriods, checkInsEventTimes, checkIns };
}

/** Ids referenced by tests, so an assertion never hard-codes a bare string. */
export const FIXTURE_IDS = {
  amara: '4200001',
  benjiWithNickname: '4200002',
  bensonWithScriptNickname: '4200019',
  sofiaWithAllergy: '4200003',
  /** The second flagged student, so a batch read has more than one to carry. */
  elijahWithAllergy: '4200008',
  ivyNoGrade: '4200015',
  oliverFifthGrader: '4200016',
  ruthInactive: '4200017',
  /** No `birthdate` upstream at all: nothing for a day-only edit to keep. */
  naomiNoBirthday: '4200009',
  dexterGrandparent: '4200018',
  /** In a household of his own, with no adult in it — nobody to ring. */
  marcusNoAdultAtHome: '4200014',
  /** His household's only adult has an email and no phone. */
  tobiasEmailOnlyParent: '4200010',
  /** Hers has a phone and no email. */
  leilaPhoneOnlyParent: '4200011',
  /** Checked into Friday Fellowship as a `Guest` — an attendee all the same. */
  mateoCheckInsGuest: '4200004',
  twoAdultHousehold: 'H1',
  adminDana: '9100001',
  managerMiriam: '9100002',
  viewerSam: '9100003',
  editorPriya: '9100004',
  noEmailGerald: '9100005',
} as const;
