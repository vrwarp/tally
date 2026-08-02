/**
 * Test fixtures.
 *
 * Every helper returns a fully-populated domain object with sensible defaults
 * so a test only has to state the field it actually cares about.
 */
import type {
  AppSettings,
  AttendanceRecord,
  EventAttendanceSnapshot,
  Grade,
  Rsvp,
  Student,
  TallyEvent,
  UserProfile,
} from '@/types';
import { DEFAULT_SETTINGS, buildSearchName } from '@/types';

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

/**
 * Applies an override, falling back only when the caller omitted the field.
 *
 * `??` cannot be used here: a one-off event is *defined* by `seriesId: null`,
 * and `overrides.seriesId ?? 'friday-fellowship'` would silently hand the test
 * a recurring event instead — which is precisely the series-isolation bug the
 * predictive-roster suite exists to catch.
 */
function pick<T, K extends keyof T>(overrides: Partial<T>, key: K, fallback: T[K]): T[K] {
  const value = overrides[key];
  return value === undefined ? fallback : (value as T[K]);
}

/** A fixed clock so date-sensitive assertions never depend on the wall clock. */
export const NOW = new Date('2026-02-13T19:30:00');

export function makeStudent(overrides: Partial<Student> = {}): Student {
  const firstName = overrides.firstName ?? 'Jamie';
  const lastName = overrides.lastName ?? 'Rivera';

  return {
    id: pick(overrides, 'id', nextId('student')),
    firstName,
    lastName,
    grade: (pick(overrides, 'grade', 8) as Grade),
    notes: pick(overrides, 'notes', null),
    status: pick(overrides, 'status', 'active'),
    isVisitor: pick(overrides, 'isVisitor', false),
    fromPlanningCenter: pick(overrides, 'fromPlanningCenter', true),
    profileComplete: pick(overrides, 'profileComplete', true),
    hasAllergies: pick(overrides, 'hasAllergies', false),
    birthday: pick(overrides, 'birthday', '03-14'),
    // Optional on `Student`: present on roster-sourced rows, absent on
    // documents. Only carried through when a test says so.
    ...(overrides.gradeOnFile === undefined ? {} : { gradeOnFile: overrides.gradeOnFile }),
    searchName: pick(overrides, 'searchName', buildSearchName(firstName, lastName)),
    firstAttendedAt: pick(overrides, 'firstAttendedAt', null),
    lastAttendedAt: pick(overrides, 'lastAttendedAt', null),
    pcoPersonId: pick(overrides, 'pcoPersonId', null),
    pcoPushPending: pick(overrides, 'pcoPushPending', false),
    createdAt: pick(overrides, 'createdAt', new Date('2025-09-01T12:00:00')),
    updatedAt: pick(overrides, 'updatedAt', new Date('2025-09-01T12:00:00')),
    createdBy: pick(overrides, 'createdBy', 'seed'),
    updatedBy: pick(overrides, 'updatedBy', null),
  };
}

export function makeEvent(overrides: Partial<TallyEvent> = {}): TallyEvent {
  const startAt = overrides.startAt ?? new Date('2026-02-13T19:00:00');
  const endAt = overrides.endAt ?? new Date('2026-02-13T21:00:00');

  return {
    id: pick(overrides, 'id', nextId('event')),
    title: pick(overrides, 'title', 'Friday Fellowship'),
    description: pick(overrides, 'description', null),
    icon: pick(overrides, 'icon', null),
    mode: pick(overrides, 'mode', 'recurring'),
    seriesId: pick(overrides, 'seriesId', 'friday-fellowship'),
    recurrence: pick(overrides, 'recurrence', null),
    recurrenceRootId: pick(overrides, 'recurrenceRootId', null),
    predictFromChain: pick(overrides, 'predictFromChain', null),
    startAt,
    endAt,
    checkInOpensAt: pick(overrides, 'checkInOpensAt', new Date(startAt.getTime() - 60 * 60_000)),
    checkInClosesAt: pick(overrides, 'checkInClosesAt', new Date(endAt.getTime() + 60 * 60_000)),
    location: pick(overrides, 'location', null),
    notes: pick(overrides, 'notes', null),
    requiresRsvp: pick(overrides, 'requiresRsvp', false),
    status: pick(overrides, 'status', 'scheduled'),
    createdAt: pick(overrides, 'createdAt', new Date('2026-01-01T12:00:00')),
    updatedAt: pick(overrides, 'updatedAt', new Date('2026-01-01T12:00:00')),
    createdBy: pick(overrides, 'createdBy', 'seed'),
    // A fixture stands in for a document unless a test is specifically about
    // the projected half of the calendar.
    materialized: pick(overrides, 'materialized', true),
  };
}

export function makeAttendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  const studentId = overrides.studentId ?? nextId('student');
  return {
    id: pick(overrides, 'id', studentId),
    studentId,
    eventId: pick(overrides, 'eventId', 'event-1'),
    seriesId: pick(overrides, 'seriesId', 'friday-fellowship'),
    checkedInAt: pick(overrides, 'checkedInAt', NOW),
    checkedInBy: pick(overrides, 'checkedInBy', 'counselor-1'),
    method: pick(overrides, 'method', 'tap'),
    isFirstEver: pick(overrides, 'isFirstEver', false),
  };
}

export function makeRsvp(overrides: Partial<Rsvp> = {}): Rsvp {
  const studentId = overrides.studentId ?? nextId('student');
  return {
    id: pick(overrides, 'id', studentId),
    studentId,
    eventId: pick(overrides, 'eventId', 'event-1'),
    status: pick(overrides, 'status', 'yes'),
    notes: pick(overrides, 'notes', null),
    updatedAt: pick(overrides, 'updatedAt', NOW),
    updatedBy: pick(overrides, 'updatedBy', 'core-1'),
  };
}

export function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: pick(overrides, 'id', nextId('user')),
    email: pick(overrides, 'email', 'counselor@example.org'),
    displayName: pick(overrides, 'displayName', 'Sam Counselor'),
    role: pick(overrides, 'role', 'counselor'),
    active: pick(overrides, 'active', true),
    createdAt: pick(overrides, 'createdAt', new Date('2025-08-01T12:00:00')),
    lastSeenAt: pick(overrides, 'lastSeenAt', null),
    pcoPersonId: pick(overrides, 'pcoPersonId', null),
  };
}

export function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/**
 * Builds a past-instance snapshot from an event and the ids that attended it.
 *
 * `held` follows the ids, which is what reading a whole register gives you. A
 * test about the profile's projections — one student's own records, where an
 * empty set means "they were absent" rather than "nobody came" — passes it
 * explicitly.
 */
export function makeSnapshot(
  event: TallyEvent,
  presentStudentIds: readonly string[],
  held: boolean = presentStudentIds.length > 0,
): EventAttendanceSnapshot {
  return { event, presentStudentIds: new Set(presentStudentIds), held };
}

/**
 * A run of weekly instances of one series, newest last.
 * `weeksAgo: 3` yields three Fridays before `NOW`.
 */
export function makeWeeklyEvents(options: {
  count: number;
  seriesId?: string;
  title?: string;
  endingBefore?: Date;
}): TallyEvent[] {
  const { count, seriesId = 'friday-fellowship', title = 'Friday Fellowship' } = options;
  const anchor = options.endingBefore ?? NOW;

  return Array.from({ length: count }, (_, index) => {
    const weeksBack = count - index;
    const startAt = new Date(anchor.getTime() - weeksBack * 7 * 86_400_000);
    startAt.setHours(19, 0, 0, 0);
    const endAt = new Date(startAt.getTime() + 2 * 60 * 60_000);

    return makeEvent({
      id: `${seriesId}-${weeksBack}`,
      title,
      seriesId,
      startAt,
      endAt,
      checkInOpensAt: new Date(startAt.getTime() - 60 * 60_000),
      checkInClosesAt: new Date(endAt.getTime() + 60 * 60_000),
    });
  });
}
