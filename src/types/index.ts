/**
 * Tally domain model.
 *
 * This module is the single shared contract between the Firestore layer
 * (`src/services`), the live-data hooks (`src/hooks`) and every feature screen.
 *
 * Convention: types suffixed with `Doc` are the *stored* Firestore shapes and
 * use `Timestamp`. The un-suffixed types are the *hydrated* application shapes:
 * they carry a document `id` and use native `Date`. Converters in
 * `src/services/converters.ts` translate between the two, so no component ever
 * has to think about `Timestamp`.
 */
import type { Timestamp } from 'firebase/firestore';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** Footprints serves 6th through 12th grade. */
export type Grade = 6 | 7 | 8 | 9 | 10 | 11 | 12;

export const GRADES: readonly Grade[] = [6, 7, 8, 9, 10, 11, 12] as const;

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'number' && GRADES.includes(value as Grade);
}

/**
 * Recorded only because Sunday School small groups are split by it
 * (Journey 2: "8th Grade Boys"). Never surfaced as a standalone label.
 */
export type Gender = 'male' | 'female' | 'unspecified';

export type StudentStatus = 'active' | 'inactive';

/**
 * `counselor`  — check-in only. The door volunteer.
 * `core`       — counselor plus dashboard, roster editing, event/RSVP management.
 * `admin`      — core plus user management (granting roles).
 */
export type Role = 'counselor' | 'core' | 'admin';

export const ROLE_RANK: Record<Role, number> = { counselor: 1, core: 2, admin: 3 };

/** True when `role` meets or exceeds `required`. */
export function roleAtLeast(role: Role | null | undefined, required: Role): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/* -------------------------------------------------------------------------- */
/* Users (counselors & core team)                                              */
/* -------------------------------------------------------------------------- */

export interface UserProfileDoc {
  email: string;
  displayName: string | null;
  role: Role;
  /** Ties a counselor to a Sunday School small group (Journey 2). */
  assignedGroupId: string | null;
  active: boolean;
  createdAt: Timestamp;
  lastSeenAt: Timestamp | null;
  /** The Planning Center person this counselor was matched to, by email. */
  pcoPersonId: string | null;
}

export interface UserProfile extends Omit<UserProfileDoc, 'createdAt' | 'lastSeenAt'> {
  /** Firebase Auth uid. */
  id: string;
  createdAt: Date;
  lastSeenAt: Date | null;
}

/* -------------------------------------------------------------------------- */
/* Small groups                                                                */
/* -------------------------------------------------------------------------- */

export interface SmallGroupDoc {
  name: string;
  grades: Grade[];
  gender: Gender | 'mixed';
  /** Display order in pickers. */
  order: number;
}

export interface SmallGroup extends SmallGroupDoc {
  id: string;
}

/* -------------------------------------------------------------------------- */
/* Students                                                                    */
/* -------------------------------------------------------------------------- */

export interface StudentDoc {
  firstName: string;
  lastName: string;
  grade: Grade;
  gender: Gender;
  smallGroupId: string | null;

  /* Data minimisation (PRD 4.5): parent contact + allergies, nothing more. */
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
  allergies: string | null;
  notes: string | null;

  status: StudentStatus;
  /** Created through the quick-add visitor modal (Journey 3). */
  isVisitor: boolean;

  /* ---- Planning Center linkage ------------------------------------------ */
  /**
   * `Person.id` in Planning Center People. Null only for a student who exists
   * solely in Tally — a quick-added visitor whose push has not landed yet, or
   * one created while write-back is disabled.
   */
  pcoPersonId: string | null;
  /**
   * Planning Center's own `updated_at` for that person at the last successful
   * pull. The incremental sync uses the maximum of these as its cursor.
   */
  pcoUpdatedAt: Timestamp | null;
  pcoSyncedAt: Timestamp | null;
  /** A Tally-created student still waiting to be pushed to Planning Center. */
  pcoPushPending: boolean;
  /**
   * False until a parent contact method exists. Denormalised so the
   * "Incomplete Profiles" dashboard list is a single indexed query rather than
   * a full-collection scan. Always write via `computeProfileComplete`.
   */
  profileComplete: boolean;

  /** Lowercased "first last", used for the substring search fallback. */
  searchName: string;

  firstAttendedAt: Timestamp | null;
  lastAttendedAt: Timestamp | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface Student
  extends Omit<
    StudentDoc,
    | 'firstAttendedAt'
    | 'lastAttendedAt'
    | 'createdAt'
    | 'updatedAt'
    | 'pcoUpdatedAt'
    | 'pcoSyncedAt'
  > {
  id: string;
  firstAttendedAt: Date | null;
  lastAttendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  pcoUpdatedAt: Date | null;
  pcoSyncedAt: Date | null;
}

/**
 * Fields Planning Center owns once a student is linked.
 *
 * Editing these in Tally would be overwritten on the next pull, so the student
 * editor shows them read-only with a "managed in Planning Center" note unless
 * write-back is enabled.
 */
export const PCO_MANAGED_STUDENT_FIELDS = [
  'firstName',
  'lastName',
  'grade',
  'gender',
  'allergies',
  'status',
] as const satisfies readonly (keyof Student)[];

export type PcoManagedStudentField = (typeof PCO_MANAGED_STUDENT_FIELDS)[number];

/**
 * A profile counts as complete once the core team can reach a parent.
 * Phone or email is enough — Journey 3 only asks for "emergency contact number".
 */
export function computeProfileComplete(input: {
  parentPhone?: string | null;
  parentEmail?: string | null;
}): boolean {
  return Boolean(input.parentPhone?.trim() || input.parentEmail?.trim());
}

export function studentFullName(student: Pick<Student, 'firstName' | 'lastName'>): string {
  return `${student.firstName} ${student.lastName}`.trim();
}

/** Canonical value for `StudentDoc.searchName`. */
export function buildSearchName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

/* -------------------------------------------------------------------------- */
/* Event series (the recurring templates)                                      */
/* -------------------------------------------------------------------------- */

/**
 * How a roster is grouped by default when a counselor opens an event.
 * `all`        — one flat predictive roster (Friday night door check-in).
 * `smallGroup` — pre-filtered to the counselor's assigned group (Sunday School).
 */
export type RosterGroupingMode = 'all' | 'smallGroup';

export interface EventSeriesDoc {
  title: string;
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** Local wall-clock "HH:mm". */
  startTime: string;
  endTime: string;
  checkInOpensMinutesBefore: number;
  checkInClosesMinutesAfter: number;
  defaultGroupingMode: RosterGroupingMode;
  active: boolean;
  order: number;
}

export interface EventSeries extends EventSeriesDoc {
  id: string;
}

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `recurring` — Fridays/Sundays. Speed-first, roster = all active youth with a
 *               predictive "Recent" block on top.
 * `oneoff`    — retreats/outings. Accountability-first, roster = RSVPs only,
 *               with waiver/payment warnings.
 */
export type EventMode = 'recurring' | 'oneoff';

export type EventStatus = 'scheduled' | 'cancelled';

export interface TallyEventDoc {
  title: string;
  mode: EventMode;
  /** Set for `recurring` events; identifies which history informs prediction. */
  seriesId: string | null;
  startAt: Timestamp;
  endAt: Timestamp;
  /** Window during which this event is auto-selected as "active". */
  checkInOpensAt: Timestamp;
  checkInClosesAt: Timestamp;
  location: string | null;
  notes: string | null;

  /** One-off accountability switches. */
  requiresRsvp: boolean;
  requiresWaiver: boolean;
  requiresPayment: boolean;
  feeCents: number | null;

  defaultGroupingMode: RosterGroupingMode;
  status: EventStatus;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
}

export interface TallyEvent
  extends Omit<
    TallyEventDoc,
    'startAt' | 'endAt' | 'checkInOpensAt' | 'checkInClosesAt' | 'createdAt' | 'updatedAt'
  > {
  id: string;
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How the counselor found the student. Purely diagnostic — it tells the core
 * team whether the predictive roster is actually earning its keep.
 */
export type CheckInMethod = 'tap' | 'search' | 'quick-add' | 'manual';

/**
 * Stored at `events/{eventId}/attendance/{studentId}`.
 *
 * The document id is the student id, which makes check-in idempotent: two
 * counselors tapping the same student concurrently converge on one record
 * instead of creating duplicates.
 */
export interface AttendanceRecordDoc {
  studentId: string;
  eventId: string;
  seriesId: string | null;
  checkedInAt: Timestamp;
  checkedInBy: string;
  method: CheckInMethod;
  /** First time this student has ever been marked present at anything. */
  isFirstEver: boolean;
}

export interface AttendanceRecord extends Omit<AttendanceRecordDoc, 'checkedInAt'> {
  /** Equal to `studentId`. */
  id: string;
  checkedInAt: Date;
}

/* -------------------------------------------------------------------------- */
/* RSVPs (one-off events)                                                      */
/* -------------------------------------------------------------------------- */

export type RsvpStatus = 'yes' | 'no' | 'maybe';

/** Stored at `events/{eventId}/rsvps/{studentId}`. */
export interface RsvpDoc {
  studentId: string;
  eventId: string;
  status: RsvpStatus;
  waiverSigned: boolean;
  paymentReceived: boolean;
  amountPaidCents: number | null;
  notes: string | null;
  updatedAt: Timestamp;
  updatedBy: string;
}

export interface Rsvp extends Omit<RsvpDoc, 'updatedAt'> {
  /** Equal to `studentId`. */
  id: string;
  updatedAt: Date;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

/** Stored as the single document `config/settings`. */
export interface AppSettingsDoc {
  /**
   * Predictive roster thresholds (PRD 4.2): a student is "Recent" when they
   * attended at least `minAttended` of the last `ofLastN` instances of the
   * same event series.
   */
  predictiveMinAttended: number;
  predictiveOfLastN: number;
  /** Consecutive missed recurring events before a student lands on the MIA list. */
  miaConsecutiveMisses: number;
  /** How far back the "New Visitors" dashboard list looks. */
  newVisitorWindowDays: number;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
}

export interface AppSettings extends Omit<AppSettingsDoc, 'updatedAt' | 'updatedBy'> {
  updatedAt: Date | null;
  updatedBy: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  predictiveMinAttended: 2,
  predictiveOfLastN: 3,
  miaConsecutiveMisses: 3,
  newVisitorWindowDays: 7,
  updatedAt: null,
  updatedBy: null,
};

/* -------------------------------------------------------------------------- */
/* Planning Center sync                                                        */
/* -------------------------------------------------------------------------- */

export type PcoSyncStatus = 'never' | 'running' | 'ok' | 'error';

/** How the youth roster is selected out of Planning Center. */
export type PcoRosterSource = 'list' | 'grade';

/** How much Tally is allowed to write back to Planning Center. */
export type PcoWriteBackMode = 'off' | 'create' | 'full';

export interface PcoSyncCounts {
  peopleScanned: number;
  studentsCreated: number;
  studentsUpdated: number;
  studentsDeactivated: number;
  teamMembersMapped: number;
  visitorsPushed: number;
  errors: number;
}

/** Stored as the single document `config/pcoSync`. Written only by Cloud Functions. */
export interface PcoSyncStateDoc {
  status: PcoSyncStatus;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  /** Max `Person.updated_at` observed, used as the incremental cursor. */
  cursor: Timestamp | null;
  /** Set when the last run needed a full sweep rather than an incremental one. */
  lastFullSyncAt: Timestamp | null;
  counts: PcoSyncCounts;
  lastError: string | null;
  /** Echo of the effective server config, so the UI can explain what it did. */
  rosterSource: PcoRosterSource;
  writeBack: PcoWriteBackMode;
  triggeredBy: string | null;
}

export interface PcoSyncState
  extends Omit<PcoSyncStateDoc, 'startedAt' | 'finishedAt' | 'cursor' | 'lastFullSyncAt'> {
  startedAt: Date | null;
  finishedAt: Date | null;
  cursor: Date | null;
  lastFullSyncAt: Date | null;
}

export const EMPTY_PCO_COUNTS: PcoSyncCounts = {
  peopleScanned: 0,
  studentsCreated: 0,
  studentsUpdated: 0,
  studentsDeactivated: 0,
  teamMembersMapped: 0,
  visitorsPushed: 0,
  errors: 0,
};

/**
 * The Planning-Center-derived allowlist, stored at `accessRoster/{emailKey}`
 * where `emailKey` is the lowercased email with `.` replaced by `,` (Firestore
 * document ids cannot contain `/`, and `.` is legal but awkward to read).
 *
 * A counselor signing in has no `users/{uid}` document yet. The `provisionAccess`
 * callable matches their verified email against this collection and creates one,
 * which is how "who may use Tally" stays governed by Planning Center rather than
 * by a separate list somebody has to remember to update.
 */
export interface AccessRosterEntryDoc {
  email: string;
  displayName: string | null;
  role: Role;
  pcoPersonId: string;
  /** Small group derived from the counselor's Planning Center data, if any. */
  assignedGroupId: string | null;
  active: boolean;
  syncedAt: Timestamp;
}

export interface AccessRosterEntry extends Omit<AccessRosterEntryDoc, 'syncedAt'> {
  id: string;
  syncedAt: Date;
}

/** `sam.smith@example.org` -> `sam,smith@example,org` */
export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ',');
}

/* -------------------------------------------------------------------------- */
/* Derived view models                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Which block of the check-in screen a student belongs to.
 * `recent` is the predictive block that sits at the top of a recurring roster.
 */
export type RosterSection = 'recent' | 'roster' | 'checkedIn';

/** Non-blocking flags rendered as badges on a roster row. */
export type RosterWarning =
  | 'missing-waiver'
  | 'missing-payment'
  | 'incomplete-profile'
  | 'allergy';

export interface RosterEntry {
  student: Student;
  section: RosterSection;
  /** Present when the student is already checked in to this event. */
  attendance: AttendanceRecord | null;
  /** Present for one-off events with an RSVP roster. */
  rsvp: Rsvp | null;
  warnings: RosterWarning[];
  /** How many of the last N instances of this series the student attended. */
  recentHits: number;
  /** Denominator for `recentHits` — how many past instances were considered. */
  recentWindow: number;
}

export interface MiaStudent {
  student: Student;
  consecutiveMisses: number;
  lastAttendedAt: Date | null;
  lastAttendedEventTitle: string | null;
}

export interface NewVisitor {
  student: Student;
  firstEventId: string;
  firstEventTitle: string;
  firstAttendedAt: Date;
}

/** One past instance of a series, with the set of students who attended it. */
export interface EventAttendanceSnapshot {
  event: TallyEvent;
  presentStudentIds: ReadonlySet<string>;
}
