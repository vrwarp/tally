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
 *   - a household with two adults, so the parent-contact pick has to be stable
 *   - a household with no adult at all
 *   - a team member with no email address, who cannot be granted access
 *
 * Person ids deliberately sit in a different range from the ones
 * `scripts/seed.ts` assigns, so the two seeded worlds stay distinguishable: a
 * student that appears in Tally after a sync provably came from here.
 */
import type {
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
  inactive?: boolean;
  /** Days before the anchor this person was last touched in Planning Center. */
  updatedDaysAgo: number;
  household?: string;
}

const YOUTH: readonly YouthSpec[] = [
  { id: '4200001', first: 'Amara', last: 'Okonkwo', grade: 8, updatedDaysAgo: 2, household: 'H1' },
  { id: '4200002', first: 'Benjamin', last: 'Okonkwo', nickname: 'Benji', grade: 6, updatedDaysAgo: 2, household: 'H1' },
  { id: '4200003', first: 'Sofia', last: 'Delgado', grade: 11, allergies: 'Severe peanut allergy — EpiPen in her bag', updatedDaysAgo: 5, household: 'H2' },
  { id: '4200004', first: 'Mateo', last: 'Delgado', grade: 7, updatedDaysAgo: 40, household: 'H2' },
  { id: '4200005', first: 'Hannah', last: 'Kim', grade: 9, updatedDaysAgo: 1, household: 'H3' },
  { id: '4200006', first: 'Joshua', last: 'Kim', grade: 12, updatedDaysAgo: 60, household: 'H3' },
  { id: '4200007', first: 'Priyanka', last: 'Raman', nickname: 'Pri', grade: 10, updatedDaysAgo: 9, household: 'H4' },
  { id: '4200008', first: 'Elijah', last: 'Brooks', grade: 8, allergies: 'Lactose intolerant', updatedDaysAgo: 3, household: 'H5' },
  { id: '4200009', first: 'Naomi', last: 'Brooks', grade: 6, updatedDaysAgo: 3, household: 'H5' },
  { id: '4200010', first: 'Tobias', last: 'Fischer', grade: 7, updatedDaysAgo: 14, household: 'H6' },
  { id: '4200011', first: 'Leila', last: 'Haddad', grade: 11, updatedDaysAgo: 21, household: 'H7' },
  { id: '4200012', first: 'Caleb', last: 'Nguyen', grade: 9, updatedDaysAgo: 6, household: 'H8' },
  { id: '4200013', first: 'Zara', last: 'Ahmed', grade: 10, updatedDaysAgo: 4, household: 'H9' },
  { id: '4200014', first: 'Marcus', last: 'Johnson', grade: 12, updatedDaysAgo: 30, household: 'H10' },
  // Grade is blank; only a graduation year is on file. The mapper has to derive it.
  { id: '4200015', first: 'Ivy', last: 'Petrova', grade: null, graduationYear: 2030, updatedDaysAgo: 7 },
  // A 5th grader: too young for a 6-12 ministry and must never reach the roster.
  { id: '4200016', first: 'Oliver', last: 'Grant', grade: 5, updatedDaysAgo: 8, household: 'H11' },
  // Left the ministry — must be deactivated, never deleted, because attendance
  // history points at this record.
  { id: '4200017', first: 'Ruth', last: 'Abebe', grade: 12, inactive: true, updatedDaysAgo: 11 },
  // Lives with a grandparent whose household role is "other_adult".
  { id: '4200018', first: 'Dexter', last: 'Cole', grade: 6, updatedDaysAgo: 12, household: 'H12' },
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
      birthdate: null,
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

  return {
    people,
    emails,
    phoneNumbers,
    households,
    memberships,
    fieldDefinitions,
    fieldData,
    lists,
  };
}

/** Ids referenced by tests, so an assertion never hard-codes a bare string. */
export const FIXTURE_IDS = {
  amara: '4200001',
  benjiWithNickname: '4200002',
  bensonWithScriptNickname: '4200019',
  sofiaWithAllergy: '4200003',
  ivyNoGrade: '4200015',
  oliverFifthGrader: '4200016',
  ruthInactive: '4200017',
  dexterGrandparent: '4200018',
  twoAdultHousehold: 'H1',
  adminDana: '9100001',
  managerMiriam: '9100002',
  viewerSam: '9100003',
  editorPriya: '9100004',
  noEmailGerald: '9100005',
} as const;
