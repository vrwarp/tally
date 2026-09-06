/**
 * Shared plumbing for the Firestore rules suite.
 *
 * The tests run inside `firebase emulators:exec`, which exports
 * FIRESTORE_EMULATOR_HOST; everything else — the project id, the ruleset, the
 * seed data — is pinned here so a failing test names a rule, not a fixture.
 *
 * Seeding goes through `withSecurityRulesDisabled` on purpose: the fixtures
 * represent state the sync function and previous admins already created, so
 * writing them under the rules under test would make the setup circular.
 */
import { readFileSync } from 'node:fs';
import {
  Timestamp,
  doc,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { paths } from '@/lib/paths';
import type {
  AppSettingsDoc,
  AttendanceRecordDoc,
  EventAccessDoc,
  InvitationDoc,
  PcoRuntimeConfigDoc,
  RsvpDoc,
  StudentDoc,
  TallyEventDoc,
  UserProfileDoc,
} from '@/types';

// `node:process` is CommonJS-only under this tsconfig, and @types/node's
// globals are not in `types`. One structural declaration is cheaper than
// reshaping the build for a single environment variable.
declare const process: { env: Record<string, string | undefined> };

const PROJECT_ID = 'demo-tally';
const DEFAULT_EMULATOR = '127.0.0.1:8080';

/** Signed-in identities the suite reuses. `stranger` deliberately has no profile. */
export const UID = {
  counselor: 'uid-counselor',
  core: 'uid-core',
  admin: 'uid-admin',
  inactive: 'uid-inactive',
  stranger: 'uid-stranger',
  /**
   * An active counselor in good standing who is on no restricted gathering.
   *
   * Distinct from `stranger`, who has no profile: every "denied" this uid earns
   * is earned by the access list alone, which is the only way to tell a
   * gathering's fence apart from the app's front door.
   */
  outsider: 'uid-outsider',
  /** Core, and deliberately not on the restricted chain either. */
  outsiderCore: 'uid-outsider-core',
} as const;

export const ID = {
  student: 'student-1',
  otherStudent: 'student-2',
  event: 'event-1',
  series: 'friday-fellowship',
  /**
   * The locked gathering. Restricted to `counselor` and `core`; `outsider`,
   * `outsiderCore` and every other member are off it, and `admin` passes
   * regardless.
   */
  restrictedSeries: 'sunday-school',
  restrictedEvent: 'event-sunday-1',
} as const;

const T0 = Timestamp.fromDate(new Date('2026-02-13T19:00:00Z'));
const T1 = Timestamp.fromDate(new Date('2026-02-13T21:00:00Z'));

export async function initTestEnv(): Promise<RulesTestEnvironment> {
  const [host, rawPort] = (process.env.FIRESTORE_EMULATOR_HOST ?? DEFAULT_EMULATOR).split(':');

  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host,
      port: Number(rawPort),
    },
  });
}

/**
 * `RulesTestContext.firestore()` is declared against the compat typings but
 * returns a modular `Firestore` at runtime, which is what every call site here
 * (and in `src/services`) actually uses.
 */
function firestoreOf(context: RulesTestContext): Firestore {
  return context.firestore() as unknown as Firestore;
}

export function asUser(env: RulesTestEnvironment, uid: string): Firestore {
  return firestoreOf(env.authenticatedContext(uid));
}

export function asAnonymous(env: RulesTestEnvironment): Firestore {
  return firestoreOf(env.unauthenticatedContext());
}

/**
 * A kiosk session: a real member's uid narrowed by the `kiosk: true` custom
 * claim the pairing flow mints. Same person, less allowed.
 */
export function asKiosk(env: RulesTestEnvironment, uid: string): Firestore {
  return firestoreOf(env.authenticatedContext(uid, { kiosk: true }));
}

/* -------------------------------------------------------------------------- */
/* Document builders — stored shapes, so `Timestamp` rather than `Date`        */
/* -------------------------------------------------------------------------- */

export function userDoc(overrides: Partial<UserProfileDoc> = {}): UserProfileDoc {
  return {
    email: 'sam@example.org',
    displayName: 'Sam Counselor',
    role: 'counselor',
    active: true,
    createdAt: T0,
    lastSeenAt: null,
    pcoPersonId: null,
    ...overrides,
  };
}

export function studentDoc(overrides: Partial<StudentDoc> = {}): StudentDoc {
  return {
    firstName: 'Jamie',
    lastName: 'Rivera',
    grade: 8,
    notes: null,
    status: 'active',
    isVisitor: false,
    pcoPersonId: null,
    upstreamPushPending: true,
    searchName: 'jamie rivera',
    firstAttendedAt: null,
    lastAttendedAt: null,
    createdAt: T0,
    updatedAt: T0,
    createdBy: UID.counselor,
    updatedBy: null,
    ...overrides,
  };
}

export function eventDoc(overrides: Partial<TallyEventDoc> = {}): TallyEventDoc {
  return {
    title: 'Friday Fellowship',
    description: null,
    icon: null,
    mode: 'recurring',
    seriesId: ID.series,
    recurrence: {
      frequency: 'weekly',
      interval: 1,
      weekdays: [5],
      monthlyMode: 'dayOfMonth',
      until: null,
      count: null,
    },
    recurrenceRootId: null,
    predictFromChain: null,
    startAt: T0,
    endAt: T1,
    checkInOpensAt: T0,
    checkInClosesAt: T1,
    location: null,
    notes: null,
    requiresRsvp: false,
    requiresCheckOut: false,
    labelTemplate: null,
    kioskTheme: null,
    kioskBackdropId: null,
    status: 'scheduled',
    createdAt: T0,
    updatedAt: T0,
    createdBy: UID.core,
    ...overrides,
  };
}

export function attendanceDoc(overrides: Partial<AttendanceRecordDoc> = {}): AttendanceRecordDoc {
  return {
    studentId: ID.student,
    eventId: ID.event,
    seriesId: ID.series,
    checkedInAt: T0,
    checkedInBy: UID.counselor,
    method: 'tap',
    isFirstEver: false,
    ...overrides,
  };
}

export function rsvpDoc(overrides: Partial<RsvpDoc> = {}): RsvpDoc {
  return {
    studentId: ID.student,
    eventId: ID.event,
    status: 'yes',
    notes: null,
    updatedAt: T0,
    updatedBy: UID.core,
    ...overrides,
  };
}

export function settingsDoc(overrides: Partial<AppSettingsDoc> = {}): AppSettingsDoc {
  return {
    predictiveMinAttended: 2,
    predictiveOfLastN: 3,
    miaConsecutiveMisses: 3,
    newVisitorWindowDays: 7,
    updatedAt: T0,
    updatedBy: UID.core,
    ...overrides,
  };
}

/**
 * The Planning Center settings the core team owns.
 *
 * Written as a whole document by the app rather than field by field, so the
 * factory produces every key — including the ones a leader cleared, which are
 * empty strings rather than absent.
 */
export function pcoConfigDoc(overrides: Partial<PcoRuntimeConfigDoc> = {}): PcoRuntimeConfigDoc {
  return {
    minGrade: 6,
    maxGrade: 12,
    writeBack: 'create',
    cacheTtlSeconds: 30,
    baseUrl: '',
    updatedAt: T0,
    updatedBy: UID.core,
    ...overrides,
  };
}

/** The Attendees counterpart of `pcoConfigDoc` — same posture, its own keys. */
export function a32ConfigDoc(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    enabled: true,
    baseUrl: '',
    divisionId: '1',
    meetSlug: 'the-rock',
    characterSlug: 'junior-student',
    assemblySlug: 'youth',
    minGrade: 6,
    maxGrade: 12,
    writeBack: 'create',
    cacheTtlSeconds: 30,
    updatedAt: T0,
    updatedBy: UID.core,
    ...overrides,
  };
}

/**
 * An invitation, as an admin leaves it.
 *
 * This is the allowlist that used to be a Planning Center List — the one thing
 * a List genuinely could not express, since "these particular twelve adults"
 * is not a filter rule.
 */
export function invitationDoc(overrides: Partial<InvitationDoc> = {}): InvitationDoc {
  return {
    email: 'newcomer@example.org',
    role: 'counselor',
    invitedAt: T0,
    invitedBy: UID.admin,
    ...overrides,
  };
}

/**
 * A gathering's access list.
 *
 * Defaults to restricted, because an unrestricted one is a document that should
 * not exist: absence is how a gathering says it is open, and the rules refuse
 * to create a document that claims nothing.
 */
export function eventAccessDoc(overrides: Partial<EventAccessDoc> = {}): EventAccessDoc {
  return {
    chainKey: ID.restrictedSeries,
    restricted: true,
    members: [UID.counselor, UID.core],
    updatedAt: T0,
    updatedBy: UID.core,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Seeding                                                                     */
/* -------------------------------------------------------------------------- */

/** One profile per role, plus the deactivated case every test needs. */
export async function seedUsers(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = firestoreOf(context);
    await setDoc(
      doc(db, paths.user(UID.counselor)),
      userDoc({ email: 'counselor@example.org', role: 'counselor' }),
    );
    await setDoc(doc(db, paths.user(UID.core)), userDoc({ email: 'core@example.org', role: 'core' }));
    await setDoc(
      doc(db, paths.user(UID.admin)),
      userDoc({ email: 'admin@example.org', role: 'admin' }),
    );
    await setDoc(
      doc(db, paths.user(UID.inactive)),
      userDoc({ email: 'former@example.org', role: 'core', active: false }),
    );
    await setDoc(
      doc(db, paths.user(UID.outsider)),
      userDoc({ email: 'outsider@example.org', role: 'counselor' }),
    );
    await setDoc(
      doc(db, paths.user(UID.outsiderCore)),
      userDoc({ email: 'outsider-core@example.org', role: 'core' }),
    );
  });
}

/** The rest of the world: a student, an event, an attendance row, an RSVP, config. */
export async function seedContent(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = firestoreOf(context);
    await setDoc(doc(db, paths.student(ID.student)), studentDoc());
    await setDoc(
      doc(db, paths.student(ID.otherStudent)),
      studentDoc({ firstName: 'Robin', lastName: 'Ng', searchName: 'robin ng' }),
    );
    await setDoc(doc(db, paths.event(ID.event)), eventDoc());
    await setDoc(doc(db, paths.attendance(ID.event, ID.student)), attendanceDoc());
    await setDoc(doc(db, paths.rsvp(ID.event, ID.student)), rsvpDoc());
    await setDoc(doc(db, paths.settings()), settingsDoc());

    /*
     * A second gathering, locked. `event-1` above stays open — every existing
     * assertion in the suite runs against it, and the most important thing this
     * feature can prove is that an unrestricted gathering did not change.
     */
    await setDoc(
      doc(db, paths.event(ID.restrictedEvent)),
      eventDoc({ title: 'Sunday School', seriesId: ID.restrictedSeries }),
    );
    await setDoc(
      doc(db, paths.attendance(ID.restrictedEvent, ID.student)),
      attendanceDoc({ eventId: ID.restrictedEvent, seriesId: ID.restrictedSeries }),
    );
    await setDoc(
      doc(db, paths.rsvp(ID.restrictedEvent, ID.student)),
      rsvpDoc({ eventId: ID.restrictedEvent }),
    );
    await setDoc(doc(db, paths.eventAccess(ID.restrictedSeries)), eventAccessDoc());
  });
}

export async function seedAll(env: RulesTestEnvironment): Promise<void> {
  await seedUsers(env);
  await seedContent(env);
}
