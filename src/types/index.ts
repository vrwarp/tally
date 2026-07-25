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

  /**
   * Notes a counselor typed, about the ministry rather than about the child.
   * Parent contact and allergies are deliberately *not* here — see below.
   */
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
  /** A Tally-created student still waiting to be pushed to Planning Center. */
  pcoPushPending: boolean;

  /** Lowercased "first last", used for the substring search fallback. */
  searchName: string;

  firstAttendedAt: Timestamp | null;
  lastAttendedAt: Timestamp | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  /** Who last edited the record, or null for one Tally created on its own. */
  updatedBy: string | null;
}

/*
 * What is deliberately absent from `StudentDoc`
 * ---------------------------------------------
 * `parentName`, `parentPhone`, `parentEmail`, `allergies`.
 *
 * Tally used to mirror all four out of Planning Center and keep them in step
 * with a sweep every six hours. That meant a permanent second copy of several
 * hundred minors' medical notes and their parents' contact details, in a
 * database whose only real job is counting who turned up.
 *
 * They now live where they already lived — Planning Center — and are read one
 * person at a time, by a screen that shows them, through `getPersonDetails`.
 * The data minimisation the PRD asks for is structural rather than a policy:
 * a door volunteer's phone never receives a parent's phone number because
 * nothing it renders asks for one.
 */

export interface Student
  extends Omit<StudentDoc, 'firstAttendedAt' | 'lastAttendedAt' | 'createdAt' | 'updatedAt'> {
  id: string;
  firstAttendedAt: Date | null;
  lastAttendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /**
   * True when this student came from Planning Center rather than from a Tally
   * document. A roster is the union of the two, and the difference decides what
   * may be edited here.
   */
  fromPlanningCenter: boolean;
  /**
   * Whether Planning Center holds a way to reach a parent. Derived server-side
   * so the "Incomplete profiles" list works without shipping the contact
   * details themselves.
   */
  profileComplete: boolean;
  /** *That* there is an allergy, never what it is. See `PcoRosterPerson`. */
  hasAllergies: boolean;
}

/**
 * Fields Planning Center owns once a student is linked.
 *
 * Editing these in Tally would be pointless — the next read comes from Planning
 * Center and would show the old value — so the student editor shows them
 * read-only with a "managed in Planning Center" note unless write-back is on.
 */
export const PCO_MANAGED_STUDENT_FIELDS = [
  'firstName',
  'lastName',
  'grade',
  'gender',
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
/* Planning Center                                                             */
/* -------------------------------------------------------------------------- */

/** How the youth roster is selected out of Planning Center. */
export type PcoRosterSource = 'list' | 'grade';

/** How much Tally is allowed to write back to Planning Center. */
export type PcoWriteBackMode = 'off' | 'create' | 'full';

/**
 * One student, as Planning Center describes them.
 *
 * Returned by the `getRoster` callable. This is *not* a Firestore document —
 * there is no `students/{pcoPersonId}` mirror to read it back from, which is
 * the whole design. A roster is this list merged with the handful of Tally
 * documents that exist for visitors and for students somebody has annotated.
 */
export interface PcoRosterPerson {
  /** Already in Tally's student-id form: `pco_{personId}`. */
  id: string;
  pcoPersonId: string;
  firstName: string;
  lastName: string;
  grade: number;
  gender: Gender;
  status: StudentStatus;
  searchName: string;
  profileComplete: boolean;
  /**
   * *That* there is an allergy, never what it is.
   *
   * A counselor at a door needs to know to check; the note itself is medical
   * information about a minor and stays behind `getPersonDetails`. A boolean is
   * enough to render the badge that makes somebody look.
   */
  hasAllergies: boolean;
}

/** The fields the roster deliberately withholds, fetched one person at a time. */
export interface PcoPersonDetails {
  pcoPersonId: string;
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
  allergies: string | null;
}

/**
 * What the Settings screen shows about the connection.
 *
 * Asked for, not watched. There is no `config/pcoSync` document any more:
 * the old sweep wrote its progress into Firestore so a bar could follow it,
 * which lit up every core-team member's phone on a schedule. A read has no
 * progress to follow, and "is it working" is a question somebody asks.
 */
export interface PcoStatus {
  configured: boolean;
  reachable: boolean;
  /** Null when everything is fine; otherwise the reason, in plain language. */
  problem: string | null;
  rosterSource: PcoRosterSource;
  writeBack: PcoWriteBackMode;
  /** Seconds a read may be reused server-side. `0` means the cache is off. */
  cacheTtlSeconds: number;
  /** True when the API root is not the real Planning Center — a test rig. */
  baseUrlOverridden: boolean;
  peopleVisible: number | null;
}

/** The id Tally uses for a Planning Center person, everywhere. */
export const PCO_ID_PREFIX = 'pco_';

export function pcoStudentId(personId: string): string {
  return `${PCO_ID_PREFIX}${personId}`;
}

/** Null for a Tally-owned id — a visitor whose push has not landed. */
export function personIdFromStudentId(studentId: string): string | null {
  return studentId.startsWith(PCO_ID_PREFIX) ? studentId.slice(PCO_ID_PREFIX.length) : null;
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
