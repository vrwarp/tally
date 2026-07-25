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
  SmallGroup,
  Student,
  TallyEvent,
  UserProfile,
} from '@/types';
import { DEFAULT_SETTINGS, buildSearchName } from '@/types';

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`;

/** A fixed clock so date-sensitive assertions never depend on the wall clock. */
export const NOW = new Date('2026-02-13T19:30:00');

export function makeStudent(overrides: Partial<Student> = {}): Student {
  const firstName = overrides.firstName ?? 'Jamie';
  const lastName = overrides.lastName ?? 'Rivera';

  return {
    id: overrides.id ?? nextId('student'),
    firstName,
    lastName,
    grade: (overrides.grade ?? 8) as Grade,
    gender: overrides.gender ?? 'unspecified',
    smallGroupId: overrides.smallGroupId ?? null,
    parentName: overrides.parentName ?? 'Alex Rivera',
    parentPhone: overrides.parentPhone ?? '555-0100',
    parentEmail: overrides.parentEmail ?? null,
    allergies: overrides.allergies ?? null,
    notes: overrides.notes ?? null,
    status: overrides.status ?? 'active',
    isVisitor: overrides.isVisitor ?? false,
    profileComplete: overrides.profileComplete ?? true,
    searchName: overrides.searchName ?? buildSearchName(firstName, lastName),
    firstAttendedAt: overrides.firstAttendedAt ?? null,
    lastAttendedAt: overrides.lastAttendedAt ?? null,
    pcoPersonId: overrides.pcoPersonId ?? null,
    pcoUpdatedAt: overrides.pcoUpdatedAt ?? null,
    pcoSyncedAt: overrides.pcoSyncedAt ?? null,
    pcoPushPending: overrides.pcoPushPending ?? false,
    createdAt: overrides.createdAt ?? new Date('2025-09-01T12:00:00'),
    updatedAt: overrides.updatedAt ?? new Date('2025-09-01T12:00:00'),
    createdBy: overrides.createdBy ?? 'seed',
  };
}

export function makeEvent(overrides: Partial<TallyEvent> = {}): TallyEvent {
  const startAt = overrides.startAt ?? new Date('2026-02-13T19:00:00');
  const endAt = overrides.endAt ?? new Date('2026-02-13T21:00:00');

  return {
    id: overrides.id ?? nextId('event'),
    title: overrides.title ?? 'Friday Fellowship',
    mode: overrides.mode ?? 'recurring',
    seriesId: overrides.seriesId ?? 'friday-fellowship',
    startAt,
    endAt,
    checkInOpensAt: overrides.checkInOpensAt ?? new Date(startAt.getTime() - 60 * 60_000),
    checkInClosesAt: overrides.checkInClosesAt ?? new Date(endAt.getTime() + 60 * 60_000),
    location: overrides.location ?? null,
    notes: overrides.notes ?? null,
    requiresRsvp: overrides.requiresRsvp ?? false,
    requiresWaiver: overrides.requiresWaiver ?? false,
    requiresPayment: overrides.requiresPayment ?? false,
    feeCents: overrides.feeCents ?? null,
    defaultGroupingMode: overrides.defaultGroupingMode ?? 'all',
    status: overrides.status ?? 'scheduled',
    createdAt: overrides.createdAt ?? new Date('2026-01-01T12:00:00'),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01T12:00:00'),
    createdBy: overrides.createdBy ?? 'seed',
  };
}

export function makeAttendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  const studentId = overrides.studentId ?? nextId('student');
  return {
    id: overrides.id ?? studentId,
    studentId,
    eventId: overrides.eventId ?? 'event-1',
    seriesId: overrides.seriesId ?? 'friday-fellowship',
    checkedInAt: overrides.checkedInAt ?? NOW,
    checkedInBy: overrides.checkedInBy ?? 'counselor-1',
    method: overrides.method ?? 'tap',
    isFirstEver: overrides.isFirstEver ?? false,
  };
}

export function makeRsvp(overrides: Partial<Rsvp> = {}): Rsvp {
  const studentId = overrides.studentId ?? nextId('student');
  return {
    id: overrides.id ?? studentId,
    studentId,
    eventId: overrides.eventId ?? 'event-1',
    status: overrides.status ?? 'yes',
    waiverSigned: overrides.waiverSigned ?? false,
    paymentReceived: overrides.paymentReceived ?? false,
    amountPaidCents: overrides.amountPaidCents ?? null,
    notes: overrides.notes ?? null,
    updatedAt: overrides.updatedAt ?? NOW,
    updatedBy: overrides.updatedBy ?? 'core-1',
  };
}

export function makeSmallGroup(overrides: Partial<SmallGroup> = {}): SmallGroup {
  return {
    id: overrides.id ?? nextId('group'),
    name: overrides.name ?? '8th Grade Boys',
    grades: overrides.grades ?? [8],
    gender: overrides.gender ?? 'male',
    order: overrides.order ?? 0,
  };
}

export function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: overrides.id ?? nextId('user'),
    email: overrides.email ?? 'counselor@example.org',
    displayName: overrides.displayName ?? 'Sam Counselor',
    role: overrides.role ?? 'counselor',
    assignedGroupId: overrides.assignedGroupId ?? null,
    active: overrides.active ?? true,
    createdAt: overrides.createdAt ?? new Date('2025-08-01T12:00:00'),
    lastSeenAt: overrides.lastSeenAt ?? null,
    pcoPersonId: overrides.pcoPersonId ?? null,
  };
}

export function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** Builds a past-instance snapshot from an event and the ids that attended it. */
export function makeSnapshot(
  event: TallyEvent,
  presentStudentIds: readonly string[],
): EventAttendanceSnapshot {
  return { event, presentStudentIds: new Set(presentStudentIds) };
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
