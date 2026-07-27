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

/** The ministry serves 6th through 12th grade. */
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
/* Invitations — who may sign in at all                                        */
/* -------------------------------------------------------------------------- */

/**
 * An admin saying "this Google address may sign in, as this".
 *
 * Keyed by `emailKey` rather than by uid, because it is written before the
 * person has ever signed in and there is no uid until they do. Once they have,
 * `users/{uid}` is the live authorisation and this is only the record of how
 * they got in — which is why deleting an invitation does not evict anybody.
 *
 * This replaced a Planning Center List. A List is generated from filter rules,
 * so "these particular twelve adults" was only expressible by inventing a
 * custom field on every person in the church — an access decision living in a
 * system edited by a different set of people from the ones who should be
 * making it.
 */
export interface InvitationDoc {
  /** The address as typed, for display. The document id is its `emailKey`. */
  email: string;
  role: Role;
  active: boolean;
  invitedAt: Timestamp;
  invitedBy: string | null;
  /** Free text, for "Wednesday night volunteer" and the like. */
  note?: string;
}

export interface Invitation extends Omit<InvitationDoc, 'invitedAt'> {
  /** The `emailKey` document id. */
  id: string;
  invitedAt: Date | null;
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
   * Whether a parent can be reached — or `null` for "nobody has looked".
   *
   * Three states, not two, because the honest answer for most students is the
   * third. A roster read from Planning Center does not fetch households, so it
   * cannot tell an unreachable family from one it simply did not ask about.
   * Only `false` is a problem worth a badge.
   */
  profileComplete: boolean | null;
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
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Planning Center writes a person with both a first name and a nickname as
 * `Benson “蔡秉洲” Tsai` — the nickname adds to the first name rather than
 * replacing it. `Student.firstName` holds that composite, so a roster row reads
 * the same as the Planning Center profile and `searchName` carries both
 * spellings.
 *
 * The student editor is the one place that needs the halves back: it offers the
 * same two boxes Planning Center's own edit form does.
 */
const NICKNAME_OPEN = '“';
const NICKNAME_CLOSE = '”';

/**
 * The two halves, joined. A nickname equal to the first name is dropped rather
 * than repeated — `Ben “Ben”` is noise.
 *
 * Must stay identical to `composeFirstName` in functions/src/pco/mapping.ts.
 */
export function composeFirstName(firstName: string, nickname: string | null): string {
  const legal = firstName.trim();
  const nick = nickname?.trim() ?? '';

  if (nick.length === 0) return legal;
  if (legal.length === 0) return nick;
  // The first name is the canonical spelling of the two.
  if (legal.toLowerCase() === nick.toLowerCase()) return legal;
  return `${legal} ${NICKNAME_OPEN}${nick}${NICKNAME_CLOSE}`;
}

/**
 * The composite pulled apart again. Anything without the quoted section comes
 * back unchanged, which covers every hand-typed visitor name.
 *
 * Must stay identical to `splitFirstName` in functions/src/pco/mapping.ts.
 */
export function splitFirstName(value: string): { firstName: string; nickname: string | null } {
  const match = /^(.*?)\s*[“"]([^”"]*)[”"]\s*$/.exec(value.trim());
  if (!match) return { firstName: value.trim(), nickname: null };

  const legal = match[1]?.trim() ?? '';
  const nickname = match[2]?.trim() ?? '';
  if (nickname.length === 0) return { firstName: legal, nickname: null };
  // `“Benji”` with nothing in front of it is just a name in quotes.
  if (legal.length === 0) return { firstName: nickname, nickname: null };
  return { firstName: legal, nickname };
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
/* Recurrence                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * Defined in `lib/recurrenceCore.ts` rather than here, because that module is
 * shared verbatim with the Cloud Functions and this one imports `Timestamp`
 * from the *client* Firestore SDK, which the functions package does not have.
 * Re-exported so `@/types` stays the import site for app code.
 */
export type {
  MonthlyRecurrenceMode,
  RecurrenceFrequency,
  RecurrenceRule,
} from '@/lib/recurrenceCore';

// A re-export does not bring the name into this file's own scope, and
// `TallyEventDoc` below has a field of this type.
import type { RecurrenceRule } from '@/lib/recurrenceCore';

/* -------------------------------------------------------------------------- */
/* Events                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * `recurring` — Fridays/Sundays. Speed-first, roster = all active youth with a
 *               predictive "Recent" block on top.
 * `oneoff`    — retreats/outings. Does not repeat and never informs prediction,
 *               and its roster can be closed to the students who RSVP'd.
 */
export type EventMode = 'recurring' | 'oneoff';

export type EventStatus = 'scheduled' | 'cancelled';

export interface TallyEventDoc {
  title: string;
  mode: EventMode;
  /**
   * Optional link to an `eventSeries` template, on `recurring` events only.
   *
   * Not required for prediction: history is grouped by the repeat chain
   * (`chainKey` — this when set, the recurrence root otherwise), so a weekly
   * gathering created in the app predicts from its own past instances with no
   * series document anywhere.
   */
  seriesId: string | null;
  /**
   * How this gathering repeats, or null when it does not.
   *
   * `startAt`/`endAt` are the *next* occurrence, not the first one ever: a
   * weekly Friday that has been running since March still carries the coming
   * Friday here. Past instances are their own documents and keep the times
   * they were actually held at, which is why editing this event only ever
   * moves what is still ahead.
   */
  recurrence: RecurrenceRule | null;
  /**
   * The id of the hand-made event this chain of repeats grew from, or null when
   * this event *is* that root.
   *
   * Gives a recurrence chain an identity that survives being copied forward,
   * which is what lets an occurrence's document id be derived rather than
   * generated — see `lib/materialize.ts` — and what the predictive roster
   * groups history by. Redundant when `seriesId` is set, which is the more
   * readable key and wins; this covers everything else.
   */
  recurrenceRootId: string | null;
  startAt: Timestamp;
  endAt: Timestamp;
  /** Window during which this event is auto-selected as "active". */
  checkInOpensAt: Timestamp;
  checkInClosesAt: Timestamp;
  location: string | null;
  notes: string | null;

  /** Closes a one-off event's roster to the students who RSVP'd. */
  requiresRsvp: boolean;

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

/**
 * The `invitations/{emailKey}` document id.
 *
 * Dots become commas because the address is the key and the key is a path
 * segment. Must stay identical to `emailKey` in functions/src/pco/mapping.ts,
 * or an invitation an admin wrote would not be the one a sign-in looks up.
 */
export function emailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ',');
}

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
  /** `null` when the roster read did not look. See the server-side note. */
  profileComplete: boolean | null;
  /**
   * *That* there is an allergy, never what it is.
   *
   * A counselor at a door needs to know to check; the note itself is medical
   * information about a minor and stays behind `getPersonDetails`. A boolean is
   * enough to render the badge that makes somebody look.
   */
  hasAllergies: boolean;
}

/**
 * Somebody Planning Center knows, offered as a candidate for the roster.
 *
 * Deliberately not filtered by grade or by "is a child": those filters are
 * wrong at exactly the edges a hand-picked roster exists for. Both facts are
 * shown so the person choosing can see what they are picking.
 */
export interface PcoPersonSearchResult {
  pcoPersonId: string;
  /** Tally student id, so a caller can tell who is already on the roster. */
  id: string;
  firstName: string;
  lastName: string;
  /** Null when Planning Center holds no grade and no graduation year for them. */
  grade: number | null;
  child: boolean;
  status: StudentStatus;
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
  writeBack: PcoWriteBackMode;
  /** Seconds a read may be reused server-side. `0` means the cache is off. */
  cacheTtlSeconds: number;
  /** True when the API root is not Planning Center's own — a proxy, cache or test rig. */
  baseUrlOverridden: boolean;
  /** How many of Tally's roster entries Planning Center could actually name. */
  peopleVisible: number | null;
  /** How many it could not: deleted upstream, merged, or no longer readable. */
  unresolved: number;
  /** The settings actually in force, whatever their source. */
  settings: PcoEffectiveSettings;
}

/**
 * The non-secret settings the server is running on right now.
 *
 * "Effective" rather than "saved": these are the deploy-time parameters with
 * whatever the core team has saved layered over them, which is the only version
 * anybody should be shown. A form filled in from the *saved* document would
 * silently misrepresent a fresh install, where nothing is saved and everything
 * still has a value.
 */
export interface PcoEffectiveSettings {
  minGrade: number;
  maxGrade: number;
  writeBack: PcoWriteBackMode;
  cacheTtlSeconds: number;
  /** The API root. Non-secret: an address, not a credential. */
  baseUrl: string;
  /** True when `config/planningCenter` is what these came from. */
  managedInApp: boolean;
}

/**
 * `config/planningCenter` as stored.
 *
 * Every field is written, and cleared fields are written as `''` rather than
 * removed — the server treats an absent key as "no opinion, use the deployed
 * value" and an empty one as "the leader deliberately cleared this", and the
 * difference is the only way to *remove* a counselor list from Settings.
 *
 * The Personal Access Token is not here. It cannot be: this document is written
 * by a browser, and a credential a browser can write is a credential a browser
 * can read.
 */
export interface PcoRuntimeConfigDoc {
  minGrade: number;
  maxGrade: number;
  writeBack: PcoWriteBackMode;
  cacheTtlSeconds: number;
  /** Admin-only, and flagged everywhere it is not the real Planning Center. */
  baseUrl: string;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
}

/* -------------------------------------------------------------------------- */
/* When Planning Center will not answer                                        */
/* -------------------------------------------------------------------------- */

/**
 * The request that failed, as the server recorded it.
 *
 * Mirrors `PcoRequestTrace` in functions/src/pco/client.ts. `Authorization` is
 * replaced with `[redacted]` before it leaves the function, so this is safe to
 * put on a clipboard — which is the entire point of it existing.
 */
export interface PcoDebugRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Sends made, including the first. More than one means retries happened. */
  attempts: number;
}

/** The response that failed. Mirrors `PcoResponseTrace` in the functions. */
export interface PcoDebugResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyTruncated: boolean;
  durationMs: number;
}

export type PcoFailureKind = 'api' | 'network' | 'unknown';

/**
 * What the server attached to a failed Planning Center callable.
 *
 * Mirrors `PcoErrorDebug` in functions/src/pco/debug.ts, and arrives as the
 * `details` of a `FunctionsError`. Absent whenever the failure never reached
 * Planning Center at all — an expired session, a browser with no network — so
 * every reader of this treats it as optional.
 */
export interface PcoErrorDebug {
  kind: PcoFailureKind;
  operation: string;
  occurredAt: string;
  message: string;
  request: PcoDebugRequest | null;
  response: PcoDebugResponse | null;
  errors: string[];
}

/**
 * A failed Planning Center call as a screen holds it: the sentence to show,
 * and everything behind the sentence for the panel under it.
 *
 * Built by `pcoErrorReport` from whatever was thrown, so a screen has one shape
 * to render whether Planning Center returned a 500, the session expired, or the
 * phone is in a car park with no signal.
 */
export interface PcoErrorReport {
  /** The one line the banner shows. */
  message: string;
  /** The callable's error code — `functions/unavailable` — when there was one. */
  code: string | null;
  /** Noted by the browser, because a local failure has no server timestamp. */
  reportedAt: string;
  /** Null when the failure never got as far as Planning Center. */
  debug: PcoErrorDebug | null;
}

/**
 * One Planning Center list, as the roster picker shows it.
 *
 * `totalPeople` is what turns "list 1234567" into a decision somebody can make.
 * `invalid` and `refreshedAt` are here because they answer the question this
 * feature otherwise generates: a student missing from Tally is usually a list
 * whose rules broke, or one that has not been refreshed since the spring.
 */
export interface PcoList {
  id: string;
  name: string;
  description: string | null;
  /** Members as of the last refresh, or null when Planning Center did not say. */
  totalPeople: number | null;
  refreshedAt: Date | null;
  autoRefresh: boolean;
  invalid: boolean;
  starred: boolean;
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
 * Advisory flags rendered as badges on a roster row.
 *
 * All of them are "worth knowing", none of them stops a check-in: nothing in
 * Tally decides whether a student may be marked present.
 */
export type RosterWarning = 'incomplete-profile' | 'allergy';

export interface RosterEntry {
  student: Student;
  /**
   * True when the prediction expects this student tonight — they attended at
   * least `predictiveMinAttended` of the last `predictiveOfLastN` instances of
   * this series. Deliberately independent of `attendance`: checking someone in
   * must not change which slice of the roster they belong to.
   */
  isRecent: boolean;
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
