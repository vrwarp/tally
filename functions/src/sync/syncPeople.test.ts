import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PcoConfig } from '../config.js';
import type { PcoClient, PcoPage, PcoQuery } from '../pco/client.js';
import type {
  JsonApiResource,
  PcoEmail,
  PcoHousehold,
  PcoHouseholdMembership,
  PcoPerson,
  PcoPersonAttributes,
  PcoPhoneNumber,
} from '../pco/types.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { syncPeople } from './syncPeople.js';

/* -------------------------------------------------------------------------- */
/* Fake Planning Center                                                        */
/* -------------------------------------------------------------------------- */

interface FakeResponse {
  data: JsonApiResource[];
  included?: JsonApiResource[];
}

/** Serves canned pages keyed by the path prefix the sync asks for. */
function fakeClient(routes: Record<string, FakeResponse>): PcoClient & { requests: string[] } {
  const requests: string[] = [];

  function lookup(path: string): FakeResponse {
    requests.push(path);
    const key = Object.keys(routes).find((route) => path.startsWith(route));
    return key ? routes[key]! : { data: [] };
  }

  return {
    requests,
    async get<TData>(path: string) {
      const response = lookup(path);
      return { data: response.data as TData, included: response.included ?? [] };
    },
    async post<TData>(path: string) {
      lookup(path);
      return { data: {} as TData };
    },
    async patch<TData>(path: string) {
      lookup(path);
      return { data: {} as TData };
    },
    async *paginate<T>(path: string, _query?: PcoQuery): AsyncGenerator<PcoPage<T>> {
      const response = lookup(path);
      yield {
        data: response.data as T[],
        included: response.included ?? [],
        meta: {},
        pageIndex: 0,
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const NOW = new Date('2026-02-13T19:30:00Z');
const OLD = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));

const CONFIG: PcoConfig = {
  appId: 'app',
  secret: 'secret',
  baseUrl: 'https://api.planningcenteronline.com/people/v2',
  baseUrlOverridden: false,
  rosterSource: 'grade',
  studentListId: null,
  counselorListId: null,
  minGrade: 6,
  maxGrade: 12,
  writeBack: 'create',
  syncSchedule: 'every 6 hours',
  smallGroupField: null,
  configError: null,
};

function person(id: string, attributes: PcoPersonAttributes, householdIds: string[] = []): PcoPerson {
  return {
    id,
    type: 'Person',
    attributes: { child: true, updated_at: '2026-02-10T00:00:00Z', ...attributes },
    relationships:
      householdIds.length > 0
        ? { households: { data: householdIds.map((hid) => ({ type: 'Household', id: hid })) } }
        : {},
  };
}

function household(id: string, memberIds: string[]): PcoHousehold {
  return {
    id,
    type: 'Household',
    attributes: { name: 'Rivera' },
    relationships: { people: { data: memberIds.map((pid) => ({ type: 'Person', id: pid })) } },
  };
}

function membership(id: string, householdId: string, personId: string, role: string): PcoHouseholdMembership {
  return {
    id,
    type: 'HouseholdMembership',
    attributes: { household_role: role },
    relationships: { person: { data: { type: 'Person', id: personId } } },
    links: { household: `/households/${householdId}` },
  };
}

function email(id: string, personId: string, address: string): PcoEmail {
  return {
    id,
    type: 'Email',
    attributes: { address, primary: true },
    relationships: { person: { data: { type: 'Person', id: personId } } },
  };
}

function phone(id: string, personId: string, number: string): PcoPhoneNumber {
  return {
    id,
    type: 'PhoneNumber',
    attributes: { number, primary: true },
    relationships: { person: { data: { type: 'Person', id: personId } } },
  };
}

/** A Tally student document as the app would have written it. */
function storedStudent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    firstName: 'Jamie',
    lastName: 'Rivera',
    grade: 8,
    gender: 'unspecified',
    smallGroupId: 'journey-2',
    parentName: null,
    parentPhone: null,
    parentEmail: null,
    allergies: null,
    notes: 'Loves the drums.',
    status: 'active',
    isVisitor: false,
    profileComplete: false,
    searchName: 'jamie rivera',
    firstAttendedAt: OLD,
    lastAttendedAt: OLD,
    pcoPersonId: '100',
    pcoUpdatedAt: OLD,
    pcoSyncedAt: OLD,
    pcoPushPending: false,
    createdAt: OLD,
    updatedAt: OLD,
    createdBy: 'planning-center',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('syncPeople', () => {
  let db: FakeFirestore;

  beforeEach(() => {
    db = new FakeFirestore();
  });

  const run = (client: PcoClient, overrides: Partial<Parameters<typeof syncPeople>[0]> = {}) =>
    syncPeople({ db, client, config: CONFIG, now: NOW, triggeredBy: 'test', ...overrides });

  it('creates a student, with the parent contact pulled from their household', async () => {
    const client = fakeClient({
      '/people': {
        data: [person('100', { first_name: 'Jamie', last_name: 'Rivera', grade: 8 }, ['H1'])],
        included: [household('H1', ['100', '301'])],
      },
      '/households/H1/household_memberships': {
        data: [membership('m1', 'H1', '301', 'parent_guardian')],
        included: [
          person('301', { first_name: 'Alex', last_name: 'Rivera', child: false }),
          phone('p1', '301', '555-0100'),
          email('e1', '301', 'alex@example.org'),
        ],
      },
    });

    const result = await run(client);

    expect(result.status).toBe('ok');
    expect(result.counts.studentsCreated).toBe(1);
    const [path] = db.writtenPaths('students/');
    const created = db.get(path!)!;
    expect(created).toMatchObject({
      firstName: 'Jamie',
      lastName: 'Rivera',
      grade: 8,
      searchName: 'jamie rivera',
      parentName: 'Alex Rivera',
      parentPhone: '555-0100',
      parentEmail: 'alex@example.org',
      profileComplete: true,
      pcoPersonId: '100',
      pcoPushPending: false,
      isVisitor: false,
      smallGroupId: null,
      createdBy: 'planning-center',
    });
  });

  it('updates a changed student without touching the fields Tally owns', async () => {
    db.seed('students/s1', storedStudent());
    const client = fakeClient({
      '/people': { data: [person('100', { first_name: 'Jamie', last_name: 'Rivera', grade: 9 })] },
    });

    const result = await run(client);

    expect(result.counts.studentsUpdated).toBe(1);
    const stored = db.get('students/s1')!;
    expect(stored.grade).toBe(9);
    // Tally's own fields survive the pull untouched.
    expect(stored.smallGroupId).toBe('journey-2');
    expect(stored.notes).toBe('Loves the drums.');
    expect(stored.firstAttendedAt).toBe(OLD);
    // Only what actually moved is written.
    const write = db.writes.find((entry) => entry.path === 'students/s1')!;
    expect(Object.keys(write.data).sort()).toEqual([
      'grade',
      'pcoSyncedAt',
      'pcoUpdatedAt',
      'updatedAt',
    ]);
  });

  it('writes nothing at all for a student who has not changed', async () => {
    db.seed('students/s1', storedStudent());
    const client = fakeClient({
      '/people': { data: [person('100', { first_name: 'Jamie', last_name: 'Rivera', grade: 8 })] },
    });

    const result = await run(client);

    expect(result.counts.studentsUpdated).toBe(0);
    expect(db.writtenPaths('students/')).toEqual([]);
    // The stored document is byte-for-byte what it was.
    expect(db.get('students/s1')).toEqual(storedStudent());
  });

  it('collapses a quick-added visitor onto the matching Planning Center person', async () => {
    db.seed(
      'students/visitor-1',
      storedStudent({
        firstName: 'José',
        lastName: 'Núñez',
        grade: 7,
        searchName: 'josé núñez',
        isVisitor: true,
        profileComplete: false,
        pcoPersonId: null,
        pcoUpdatedAt: null,
        pcoPushPending: true,
        smallGroupId: null,
        notes: null,
        createdBy: 'counselor-1',
      }),
    );

    const client = fakeClient({
      '/people': {
        data: [person('777', { first_name: 'Jose', last_name: 'Nunez', grade: 7 }, ['H2'])],
        included: [household('H2', ['777', '801'])],
      },
      '/households/H2/household_memberships': {
        data: [membership('m1', 'H2', '801', 'parent_guardian')],
        included: [
          person('801', { first_name: 'Rosa', last_name: 'Nunez', child: false }),
          phone('p1', '801', '555-0177'),
        ],
      },
    });

    const result = await run(client);

    // One record, not two.
    expect(result.counts.studentsCreated).toBe(0);
    expect(result.counts.studentsUpdated).toBe(1);
    expect(db.writtenPaths('students/')).toEqual(['students/visitor-1']);

    const stored = db.get('students/visitor-1')!;
    expect(stored.pcoPersonId).toBe('777');
    expect(stored.pcoPushPending).toBe(false);
    expect(stored.parentPhone).toBe('555-0177');
    // A reachable parent is exactly what clears the "we don't know this kid" badge.
    expect(stored.isVisitor).toBe(false);
    expect(stored.profileComplete).toBe(true);
  });

  it('deactivates a person Planning Center marked inactive, keeping the record', async () => {
    db.seed('students/s1', storedStudent());
    const client = fakeClient({
      '/people': {
        data: [
          person('100', { first_name: 'Jamie', last_name: 'Rivera', grade: 8, status: 'inactive' }),
        ],
      },
    });

    const result = await run(client);

    expect(result.counts.studentsDeactivated).toBe(1);
    expect(result.counts.studentsUpdated).toBe(0);
    expect(db.get('students/s1')).toMatchObject({ status: 'inactive', lastAttendedAt: OLD });
  });

  it('deactivates a linked student who dropped off the roster, but only on a full sweep', async () => {
    db.seed('students/s1', storedStudent({ pcoPersonId: '100' }));
    db.seed('students/s2', storedStudent({ pcoPersonId: '200', firstName: 'Sam' }));
    const client = fakeClient({
      '/people': { data: [person('100', { first_name: 'Jamie', last_name: 'Rivera', grade: 8 })] },
    });

    const full = await run(client, { full: true });

    expect(full.counts.studentsDeactivated).toBe(1);
    expect(db.get('students/s2')).toMatchObject({ status: 'inactive' });
    expect(db.get('students/s1')).toMatchObject({ status: 'active' });
  });

  it('refuses to empty the roster when a full sweep returns nobody', async () => {
    db.seed('students/s1', storedStudent());
    // A deleted List or a broken filter looks exactly like this, and wiping the
    // whole ministry on that guess is not undoable in one click.
    const result = await run(fakeClient({ '/people': { data: [] } }), { full: true });

    expect(result.counts.studentsDeactivated).toBe(0);
    expect(db.get('students/s1')).toMatchObject({ status: 'active' });
  });

  it('leaves a student alone on an incremental run that simply did not mention them', async () => {
    db.seed('config/pcoSync', {
      status: 'ok',
      cursor: Timestamp.fromDate(new Date('2026-02-01T00:00:00Z')),
      lastFullSyncAt: Timestamp.fromDate(new Date('2026-02-13T06:00:00Z')),
    });
    db.seed('students/s2', storedStudent({ pcoPersonId: '200', firstName: 'Sam' }));
    const client = fakeClient({ '/people': { data: [] } });

    const result = await run(client);

    expect(result.full).toBe(false);
    expect(result.counts.studentsDeactivated).toBe(0);
    expect(db.get('students/s2')).toMatchObject({ status: 'active' });
  });

  it('writes the access roster entries the sign-in flow looks up', async () => {
    const client = fakeClient({
      '/people': { data: [person('100', { first_name: 'Jamie', last_name: 'Rivera', grade: 8 })] },
      '/lists/COUNSELORS/people': {
        data: [
          person('500', {
            first_name: 'Sam',
            last_name: 'Counselor',
            child: false,
            people_permissions: 'Manager',
          }),
          person('501', { first_name: 'No', last_name: 'Email', child: false }),
        ],
        included: [email('e5', '500', 'Sam.Counselor@example.org')],
      },
    });

    const result = await run(client, { config: { ...CONFIG, counselorListId: 'COUNSELORS' } });

    expect(result.counts.teamMembersMapped).toBe(1);
    expect(db.get('accessRoster/sam,counselor@example,org')).toMatchObject({
      email: 'sam.counselor@example.org',
      displayName: 'Sam Counselor',
      role: 'core',
      pcoPersonId: '500',
      active: true,
    });
  });

  it('does not rewrite an access roster entry that has not changed', async () => {
    db.seed('accessRoster/sam@example,org', {
      email: 'sam@example.org',
      displayName: 'Sam Counselor',
      role: 'counselor',
      pcoPersonId: '500',
      assignedGroupId: null,
      active: true,
      syncedAt: OLD,
    });

    const client = fakeClient({
      '/people': { data: [] },
      '/lists/COUNSELORS/people': {
        data: [person('500', { first_name: 'Sam', last_name: 'Counselor', child: false })],
        included: [email('e5', '500', 'sam@example.org')],
      },
    });

    await run(client, { config: { ...CONFIG, counselorListId: 'COUNSELORS' } });

    expect(db.writtenPaths('accessRoster/')).toEqual([]);
  });

  it('records a terminal error state instead of leaving the sync stuck on running', async () => {
    const failing: PcoClient = {
      ...fakeClient({}),
      // Never yields on purpose: this models the API failing on the first page.
      // eslint-disable-next-line require-yield
      async *paginate<T>(): AsyncGenerator<PcoPage<T>> {
        throw new Error('Planning Center 500 for /people');
      },
    };

    const result = await run(failing);

    expect(result.status).toBe('error');
    expect(db.get('config/pcoSync')).toMatchObject({
      status: 'error',
      lastError: 'Planning Center 500 for /people',
    });
  });

  it('advances the cursor to the newest updated_at it saw', async () => {
    const client = fakeClient({
      '/people': {
        data: [
          person('100', { first_name: 'A', last_name: 'One', grade: 8, updated_at: '2026-02-10T00:00:00Z' }),
          person('101', { first_name: 'B', last_name: 'Two', grade: 9, updated_at: '2026-02-12T09:00:00Z' }),
        ],
      },
    });

    const result = await run(client);

    expect(result.cursor?.toISOString()).toBe('2026-02-12T09:00:00.000Z');
    const state = db.get('config/pcoSync')!;
    expect(state.status).toBe('ok');
    expect((state.cursor as Timestamp).toDate().toISOString()).toBe('2026-02-12T09:00:00.000Z');
    expect(state.lastFullSyncAt).toBeDefined();
  });

  it('keeps an adult out of the student roster in grade mode', async () => {
    const client = fakeClient({
      '/people': {
        data: [
          person('100', { first_name: 'Jamie', last_name: 'Rivera', grade: 8 }),
          person('900', { first_name: 'Pat', last_name: 'Adult', child: false }),
        ],
      },
    });

    const result = await run(client);

    expect(result.counts.peopleScanned).toBe(2);
    expect(result.counts.studentsCreated).toBe(1);
  });
});
