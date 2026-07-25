/**
 * Firestore snapshot -> domain model mapping.
 *
 * A note on `serverTimestamp()`: while a write is pending locally, the field it
 * targets reads back as `null` in the optimistic snapshot that `onSnapshot`
 * delivers before the server acknowledges. Every mapper here therefore takes a
 * fallback date so an in-flight check-in still renders a sensible time instead
 * of crashing or showing "Invalid Date".
 */
import { Timestamp, type DocumentData, type DocumentSnapshot } from 'firebase/firestore';
import {
  DEFAULT_SETTINGS,
  buildSearchName,
  computeProfileComplete,
  isGrade,
  type AccessRosterEntry,
  type AppSettings,
  type AppSettingsDoc,
  type AttendanceRecord,
  type EventSeries,
  type Grade,
  type PcoSyncCounts,
  type PcoSyncState,
  type Rsvp,
  type SmallGroup,
  type Student,
  type TallyEvent,
  type UserProfile,
} from '@/types';

/* -------------------------------------------------------------------------- */
/* Primitive coercion                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every date this module returns is renderable.
 *
 * An `Invalid Date` is not a cosmetic problem: `date-fns` throws a `RangeError`
 * when it formats one, so a single malformed field turns into a crash on the
 * check-in screen rather than a blank cell. Firestore itself cannot store one,
 * but the locally-cached echo of a write can carry a JS `Date` straight through,
 * and a numeric field of `NaN` produces one too — so the guard lives here,
 * where every path already passes.
 */
function usable(date: Date): Date | null {
  return Number.isFinite(date.getTime()) ? date : null;
}

export function toDate(value: unknown, fallback: Date): Date {
  return toDateOrNull(value) ?? fallback;
}

export function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Timestamp) return usable(value.toDate());
  if (value instanceof Date) return usable(value);
  if (typeof value === 'number') return usable(new Date(value));
  return null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function grade(value: unknown): Grade {
  return isGrade(value) ? value : 6;
}

/**
 * The date to attribute to a locally-pending `serverTimestamp()`.
 * Using the snapshot's own pending flag keeps confirmed records honest.
 */
function pendingFallback(snapshot: DocumentSnapshot<DocumentData>): Date {
  return snapshot.metadata.hasPendingWrites ? new Date() : new Date(0);
}

/* -------------------------------------------------------------------------- */
/* Students                                                                    */
/* -------------------------------------------------------------------------- */

export function toStudent(snapshot: DocumentSnapshot<DocumentData>): Student {
  const data = snapshot.data() ?? {};
  const fallback = pendingFallback(snapshot);
  const firstName = str(data.firstName);
  const lastName = str(data.lastName);

  return {
    id: snapshot.id,
    firstName,
    lastName,
    grade: grade(data.grade),
    gender: (data.gender === 'male' || data.gender === 'female'
      ? data.gender
      : 'unspecified') as Student['gender'],
    smallGroupId: strOrNull(data.smallGroupId),
    parentName: strOrNull(data.parentName),
    parentPhone: strOrNull(data.parentPhone),
    parentEmail: strOrNull(data.parentEmail),
    allergies: strOrNull(data.allergies),
    notes: strOrNull(data.notes),
    status: data.status === 'inactive' ? 'inactive' : 'active',
    isVisitor: bool(data.isVisitor),
    pcoPersonId: strOrNull(data.pcoPersonId),
    pcoUpdatedAt: toDateOrNull(data.pcoUpdatedAt),
    pcoSyncedAt: toDateOrNull(data.pcoSyncedAt),
    pcoPushPending: bool(data.pcoPushPending),
    // Recompute rather than trust the stored flag: a profile edited outside the
    // app (console, import script) can leave the denormalised value stale.
    profileComplete: computeProfileComplete({
      parentPhone: strOrNull(data.parentPhone),
      parentEmail: strOrNull(data.parentEmail),
    }),
    searchName: str(data.searchName) || buildSearchName(firstName, lastName),
    firstAttendedAt: toDateOrNull(data.firstAttendedAt),
    lastAttendedAt: toDateOrNull(data.lastAttendedAt),
    createdAt: toDate(data.createdAt, fallback),
    updatedAt: toDate(data.updatedAt, fallback),
    createdBy: str(data.createdBy),
    updatedBy: strOrNull(data.updatedBy),
  };
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

export function toEvent(snapshot: DocumentSnapshot<DocumentData>): TallyEvent {
  const data = snapshot.data() ?? {};
  const fallback = pendingFallback(snapshot);
  const startAt = toDate(data.startAt, fallback);
  const endAt = toDate(data.endAt, startAt);
  const mode: TallyEvent['mode'] = data.mode === 'oneoff' ? 'oneoff' : 'recurring';

  return {
    id: snapshot.id,
    title: str(data.title, 'Untitled event'),
    mode,
    seriesId: strOrNull(data.seriesId),
    startAt,
    endAt,
    checkInOpensAt: toDate(data.checkInOpensAt, startAt),
    checkInClosesAt: toDate(data.checkInClosesAt, endAt),
    location: strOrNull(data.location),
    notes: strOrNull(data.notes),
    // A one-off without an explicit flag still defaults to an RSVP roster —
    // Journey 4 depends on the bus list being closed by default.
    requiresRsvp: bool(data.requiresRsvp, mode === 'oneoff'),
    requiresWaiver: bool(data.requiresWaiver),
    requiresPayment: bool(data.requiresPayment),
    feeCents: numOrNull(data.feeCents),
    defaultGroupingMode: data.defaultGroupingMode === 'smallGroup' ? 'smallGroup' : 'all',
    status: data.status === 'cancelled' ? 'cancelled' : 'scheduled',
    createdAt: toDate(data.createdAt, fallback),
    updatedAt: toDate(data.updatedAt, fallback),
    createdBy: str(data.createdBy),
  };
}

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

export function toAttendance(
  snapshot: DocumentSnapshot<DocumentData>,
  eventId: string,
): AttendanceRecord {
  const data = snapshot.data() ?? {};
  const method = data.method;

  return {
    id: snapshot.id,
    studentId: str(data.studentId) || snapshot.id,
    eventId: str(data.eventId) || eventId,
    seriesId: strOrNull(data.seriesId),
    // A tap that has not round-tripped yet shows "just now" rather than 1970.
    checkedInAt: toDate(data.checkedInAt, snapshot.metadata.hasPendingWrites ? new Date() : new Date(0)),
    checkedInBy: str(data.checkedInBy),
    method:
      method === 'search' || method === 'quick-add' || method === 'manual' ? method : 'tap',
    isFirstEver: bool(data.isFirstEver),
  };
}

/* -------------------------------------------------------------------------- */
/* RSVPs                                                                       */
/* -------------------------------------------------------------------------- */

export function toRsvp(snapshot: DocumentSnapshot<DocumentData>, eventId: string): Rsvp {
  const data = snapshot.data() ?? {};
  const status = data.status;

  return {
    id: snapshot.id,
    studentId: str(data.studentId) || snapshot.id,
    eventId: str(data.eventId) || eventId,
    status: status === 'no' || status === 'maybe' ? status : 'yes',
    waiverSigned: bool(data.waiverSigned),
    paymentReceived: bool(data.paymentReceived),
    amountPaidCents: numOrNull(data.amountPaidCents),
    notes: strOrNull(data.notes),
    updatedAt: toDate(data.updatedAt, pendingFallback(snapshot)),
    updatedBy: str(data.updatedBy),
  };
}

/* -------------------------------------------------------------------------- */
/* Users, groups, series, settings                                             */
/* -------------------------------------------------------------------------- */

export function toUserProfile(snapshot: DocumentSnapshot<DocumentData>): UserProfile {
  const data = snapshot.data() ?? {};
  const role = data.role;

  return {
    id: snapshot.id,
    email: str(data.email),
    displayName: strOrNull(data.displayName),
    // Unknown or missing role means the least privilege we hand out.
    role: role === 'admin' || role === 'core' ? role : 'counselor',
    assignedGroupId: strOrNull(data.assignedGroupId),
    active: bool(data.active, false),
    createdAt: toDate(data.createdAt, pendingFallback(snapshot)),
    lastSeenAt: toDateOrNull(data.lastSeenAt),
    pcoPersonId: strOrNull(data.pcoPersonId),
  };
}

export function toPcoSyncState(snapshot: DocumentSnapshot<DocumentData>): PcoSyncState {
  const data = snapshot.data() ?? {};
  const status = data.status;
  const counts = (data.counts ?? {}) as Partial<PcoSyncCounts>;

  return {
    status:
      status === 'running' || status === 'ok' || status === 'error' ? status : 'never',
    startedAt: toDateOrNull(data.startedAt),
    finishedAt: toDateOrNull(data.finishedAt),
    cursor: toDateOrNull(data.cursor),
    lastFullSyncAt: toDateOrNull(data.lastFullSyncAt),
    counts: {
      peopleScanned: num(counts.peopleScanned, 0),
      studentsCreated: num(counts.studentsCreated, 0),
      studentsUpdated: num(counts.studentsUpdated, 0),
      studentsDeactivated: num(counts.studentsDeactivated, 0),
      teamMembersMapped: num(counts.teamMembersMapped, 0),
      visitorsPushed: num(counts.visitorsPushed, 0),
      errors: num(counts.errors, 0),
    },
    lastError: strOrNull(data.lastError),
    // Mirrors PCO_ROSTER_SOURCE's default in functions/src/config.ts.
    rosterSource: data.rosterSource === 'list' ? 'list' : 'grade',
    writeBack:
      data.writeBack === 'off' || data.writeBack === 'full' ? data.writeBack : 'create',
    triggeredBy: strOrNull(data.triggeredBy),
  };
}

export function toAccessRosterEntry(
  snapshot: DocumentSnapshot<DocumentData>,
): AccessRosterEntry {
  const data = snapshot.data() ?? {};
  const role = data.role;

  return {
    id: snapshot.id,
    email: str(data.email),
    displayName: strOrNull(data.displayName),
    role: role === 'admin' || role === 'core' ? role : 'counselor',
    pcoPersonId: str(data.pcoPersonId),
    assignedGroupId: strOrNull(data.assignedGroupId),
    active: bool(data.active, false),
    syncedAt: toDate(data.syncedAt, pendingFallback(snapshot)),
  };
}

export function toSmallGroup(snapshot: DocumentSnapshot<DocumentData>): SmallGroup {
  const data = snapshot.data() ?? {};
  const rawGrades = Array.isArray(data.grades) ? data.grades : [];
  const gender = data.gender;

  return {
    id: snapshot.id,
    name: str(data.name, snapshot.id),
    grades: rawGrades.filter(isGrade),
    gender:
      gender === 'male' || gender === 'female' || gender === 'unspecified' ? gender : 'mixed',
    order: num(data.order, 0),
  };
}

export function toEventSeries(snapshot: DocumentSnapshot<DocumentData>): EventSeries {
  const data = snapshot.data() ?? {};

  return {
    id: snapshot.id,
    title: str(data.title, snapshot.id),
    dayOfWeek: num(data.dayOfWeek, 0),
    startTime: str(data.startTime, '19:00'),
    endTime: str(data.endTime, '21:00'),
    checkInOpensMinutesBefore: num(data.checkInOpensMinutesBefore, 60),
    checkInClosesMinutesAfter: num(data.checkInClosesMinutesAfter, 60),
    defaultGroupingMode: data.defaultGroupingMode === 'smallGroup' ? 'smallGroup' : 'all',
    active: bool(data.active, true),
    order: num(data.order, 0),
  };
}

export function toSettings(snapshot: DocumentSnapshot<DocumentData>): AppSettings {
  if (!snapshot.exists()) return DEFAULT_SETTINGS;
  const data = (snapshot.data() ?? {}) as Partial<AppSettingsDoc>;

  // Clamp to sane ranges: a misconfigured `predictiveOfLastN` of 0 would make
  // the Recent block silently vanish, which reads as a bug to a counselor.
  const ofLastN = Math.max(1, Math.min(12, num(data.predictiveOfLastN, DEFAULT_SETTINGS.predictiveOfLastN)));
  const minAttended = Math.max(
    1,
    Math.min(ofLastN, num(data.predictiveMinAttended, DEFAULT_SETTINGS.predictiveMinAttended)),
  );

  return {
    predictiveMinAttended: minAttended,
    predictiveOfLastN: ofLastN,
    miaConsecutiveMisses: Math.max(
      1,
      num(data.miaConsecutiveMisses, DEFAULT_SETTINGS.miaConsecutiveMisses),
    ),
    newVisitorWindowDays: Math.max(
      1,
      num(data.newVisitorWindowDays, DEFAULT_SETTINGS.newVisitorWindowDays),
    ),
    updatedAt: toDateOrNull(data.updatedAt),
    updatedBy: strOrNull(data.updatedBy),
  };
}
