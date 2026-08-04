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
import { parseStudentId, type BackendId } from '@/lib/backendIds';

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Kindergarten through 12th grade, with `0` meaning kindergarten.
 *
 * Wider than the 6–12 the youth ministry runs on, because a nursery or a
 * children's ministry is the same app with a different band — and which band a
 * church actually reads is configuration (`minGrade`/`maxGrade`), not this
 * type. Widening here only decides what Tally can *represent*; an existing
 * deployment's band stays 6–12 until somebody changes it in Settings.
 *
 * Below kindergarten there is no grade at all, and that is `null` rather than a
 * negative sentinel: `grade` is pushed into Planning Center's own attribute and
 * an Attendees `infos.fixed.grade`, where a `-2` would be a lie in somebody
 * else's system.
 */
export type Grade = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export const GRADES: readonly Grade[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export function isGrade(value: unknown): value is Grade {
  return typeof value === 'number' && GRADES.includes(value as Grade);
}

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
/* Students                                                                    */
/* -------------------------------------------------------------------------- */

export interface StudentDoc {
  firstName: string;
  lastName: string;
  /**
   * Optional, and absent — never null — when nobody holds one.
   *
   * A nursery child has no grade, and neither does an adult on a hand-picked
   * roster. This used to be a required number paired with a `gradeOnFile`
   * boolean, which is a nullable field spelled as a sentinel plus a flag: every
   * reader had to remember to consult the flag, and the mapper that set it
   * tracked only whether the upstream value was *blank*, so a real 3rd grader
   * arrived asserting they were in 6th.
   *
   * Absent rather than `null` because `validStudent` in firestore.rules reads
   * `!('grade' in d.keys()) || d.grade is int` — a stored null fails it.
   */
  grade?: Grade;

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
  /**
   * True while the linked upstream record is known gone — deleted, or merged
   * with the trail ending dead. Written only by the server, from what the
   * backend actually answered; the rules refuse it from a client and refuse
   * check-ins while it stands. A leader thaws the student by removing them
   * from the roster or re-creating the record. Named for the first backend
   * Tally had; it freezes for every backend.
   */
  pcoRecordMissing?: boolean;

  /**
   * The generic linkage pair, written by the server alongside (or instead of)
   * `pcoPersonId` above: which people-backend holds this student, and as
   * whom. Planning Center pushes write both fields for compatibility;
   * Attendees pushes write only these. `pcoPersonId` keeps meaning Planning
   * Center and only Planning Center.
   */
  upstreamBackend?: BackendId | null;
  upstreamPersonId?: string | null;

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
  extends Omit<
    StudentDoc,
    'firstAttendedAt' | 'lastAttendedAt' | 'createdAt' | 'updatedAt' | 'grade'
  > {
  id: string;
  /** Null when nobody holds a grade for them. See `StudentDoc.grade`. */
  grade: Grade | null;
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
  /**
   * The day of the year they have a birthday on, as `MM-DD`, or null when
   * Planning Center holds no birthdate. Never the year — see `PcoRosterPerson`.
   */
  birthday: string | null;
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

export interface EventSeriesDoc {
  title: string;
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** Local wall-clock "HH:mm". */
  startTime: string;
  endTime: string;
  checkInOpensMinutesBefore: number;
  checkInClosesMinutesAfter: number;
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
 *               though it may borrow one (see `predictFromChain`), and its
 *               roster can be closed to the students who RSVP'd.
 */
export type EventMode = 'recurring' | 'oneoff';

export type EventStatus = 'scheduled' | 'cancelled';

export interface TallyEventDoc {
  title: string;
  /**
   * A sentence or two about what this gathering is, for the students and
   * counselors reading the check-in screen — "Games, a talk and pizza".
   *
   * Distinct from `notes`, which is the logistics a leader leaves for the other
   * leaders ("bring a jacket, meet at the car park"). The description is the
   * one the hero card shows, because it is the one that reads as an invitation
   * rather than as a memo.
   */
  description: string | null;
  /**
   * A Material Symbols name from `lib/eventIcons`, or null.
   *
   * Stored as the name rather than as a glyph so the drawing can be improved
   * without rewriting anybody's events, and validated on read against the
   * bundled catalogue — an event carrying a name Tally no longer ships renders
   * as one with no icon rather than as an empty box.
   */
  icon: string | null;
  mode: EventMode;
  /**
   * Optional link to an `eventSeries` template, on `recurring` events only.
   *
   * What it does is join this gathering to that template's chain — the Fridays
   * under `friday-fellowship` are one gathering because they share this. It is
   * not what turns prediction on: history is grouped by the repeat chain
   * (`chainKey` — this when set, the recurrence root otherwise), so a weekly
   * gathering created in the app predicts from its own past instances with no
   * series document anywhere.
   */
  seriesId: string | null;
  /**
   * The gathering a one-off borrows its regulars from — a `chainKey`, or null.
   *
   * A trip has no history of its own and never will: it happens once. But the
   * students on the coach are the students who come on Friday nights, and at
   * the door of a coach that is a prediction worth having. Point this at a
   * weekly gathering and the trip's "Recent" filter reads that gathering's last
   * few instances instead of reading nothing.
   *
   * A chain rather than a `seriesId`, for the same reason `chainKey` exists: a
   * weekly gathering created in the app has a recurrence root and no series
   * document, and it is exactly as good a thing to predict from.
   *
   * One-off events only, and it only ever points *at* a recurring chain. A
   * recurring gathering has its own past and reads that; a trip is never
   * evidence about who turns up to anything, so nothing predicts from one.
   */
  predictFromChain: string | null;
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
  /**
   * Window during which this event counts as live.
   *
   * Advisory rather than decisive since the check-in screen started asking
   * which gathering somebody is at: it rings the card in the chooser and sorts
   * it first, and it decides whether the roster header warns that the window
   * has closed. It no longer picks anything on a counselor's behalf.
   */
  checkInOpensAt: Timestamp;
  checkInClosesAt: Timestamp;
  location: string | null;
  notes: string | null;

  /** Closes a one-off event's roster to the students who RSVP'd. */
  requiresRsvp: boolean;

  /**
   * Turns the roster ternary: a student can be checked in, and then checked out.
   *
   * For a room somebody is collected from rather than simply attends — a
   * nursery, where the number a volunteer needs mid-service is not how many
   * came but how many are still here. Off by default and unconditionally:
   * unlike `requiresRsvp`, which follows from `mode`, nothing about a
   * gathering's shape implies that children get handed back.
   */
  requiresCheckOut: boolean;

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
  /**
   * Whether a document stands behind this gathering.
   *
   * False for one the recurrence rules describe but nothing has been done about
   * yet — see `lib/eventProjection.ts`. Not a stored field: it is how the
   * gathering reached the app, not something about the gathering.
   *
   * It reads exactly like a real event and can be listed, opened and predicted
   * from. What it cannot be is *written to*, because `id` names a document that
   * does not exist. Every write path calls `ensureMaterialized` first, which is
   * a no-op when this is already true.
   */
  materialized: boolean;
}

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How the counselor found the student. Purely diagnostic — it tells the core
 * team whether the predictive roster is actually earning its keep.
 *
 * `import` marks a row that came from Planning Center Check-Ins history
 * rather than from anybody's thumb; those rows also carry
 * `checkedInBy: 'planning-center'` instead of a uid. `kiosk` marks a
 * self-serve check-in from the lobby kiosk, written under the staff session
 * that paired the device.
 */
export type CheckInMethod = 'tap' | 'search' | 'quick-add' | 'manual' | 'import' | 'kiosk';

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
  /**
   * When somebody collected them, on an event that tracks check-out.
   *
   * The key is *absent* while they are still in the room — not null. A
   * `serverTimestamp()` sentinel reads back as null locally until the write
   * round-trips, and null is the state that means "still here", so an undo
   * writes `deleteField()` rather than null and the two stay distinguishable.
   * See `toAttendance`.
   */
  checkedOutAt?: Timestamp;
  /**
   * Who recorded the pickup — not necessarily who checked them in. The
   * volunteer who takes a child in is rarely the one who hands them back.
   */
  checkedOutBy?: string;
}

export interface AttendanceRecord
  extends Omit<AttendanceRecordDoc, 'checkedInAt' | 'checkedOutAt' | 'checkedOutBy'> {
  /** Equal to `studentId`. */
  id: string;
  checkedInAt: Date;
  /** Null while they are still in the room. */
  checkedOutAt: Date | null;
  checkedOutBy: string | null;
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
  /** Already in Tally's student-id form: `pco_{personId}`, `a32_{uuid}`. */
  id: string;
  /** The backend's own id for this person — named for the first backend. */
  pcoPersonId: string;
  /** Which backend `pcoPersonId` belongs to. Absent from older servers = pco. */
  backendId?: BackendId;
  firstName: string;
  lastName: string;
  /** Null when the backend holds no grade and no graduation year for them. */
  grade: number | null;
  status: StudentStatus;
  searchName: string;
  /** `null` when the roster read did not look. See the server-side note. */
  profileComplete: boolean | null;
  /**
   * *That* there is an allergy, never what it is.
   *
   * A roster is read for everybody at once, and the note is medical information
   * about a minor — so it is not carried here for four hundred students on the
   * chance that four of them are looked at. The flag is what a badge needs; the
   * note behind it is asked for separately, for the flagged rows only, through
   * `getAllergyNotes`.
   */
  hasAllergies: boolean;
  /**
   * `MM-DD` — the day, never the year.
   *
   * A roster row asks two things of a birthday: is there cake this week, and
   * has anybody ever filled this in. Neither needs a child's age or year of
   * birth, which is the identifying half of a date of birth, so the year is
   * dropped on the server rather than carried to every browser holding a
   * roster. Null means Planning Center has no birthdate on file.
   */
  birthday: string | null;
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
  /** Which backend found them — the search fans out once two are connected. */
  backendId?: BackendId;
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
  /** Which backend answered — and whose write-back the flags below describe. */
  backendId?: BackendId;
  parentName: string | null;
  parentPhone: string | null;
  parentEmail: string | null;
  allergies: string | null;
  /**
   * The birthday with its year — `YYYY-MM-DD` — or `MM-DD` when Planning
   * Center's year for them is the 1885 it keeps for a birthday nobody knows the
   * year of. Null when there is no birthdate at all.
   *
   * The one field here that `Student.birthday` also carries, in a shorter form:
   * the roster drops the year for every row, and this read restores it for one
   * student at a time — which is the same bargain as the allergy note and the
   * parent's phone number, both of which are far more than a year of birth.
   *
   * The two shapes are the two Tally *writes* (`composeBirthday`), so a form
   * opens on exactly what it would send back, and a leader who can see the year
   * can correct it.
   */
  birthdate: string | null;
  /**
   * Whether Planning Center has an adult in this student's household at all,
   * irrespective of whether anybody has put a number on them.
   *
   * The two ways a student ends up unreachable are fixed in different places: a
   * parent with no phone number is a number somebody can add, while a student
   * with no household is a family that has to be built in Planning Center
   * first. A screen that offered the same action for both would send half of
   * the people using it somewhere that cannot help them.
   */
  householdAdult: boolean;
  /**
   * Whether Tally may add that contact itself right now — an adult to hang it
   * off, *and* `PCO_WRITE_BACK=full`.
   *
   * Answered by the server because the browser can see neither half. False is
   * the ordinary case: write-back defaults to `create`, which permits pushing a
   * new visitor upstream and nothing else.
   */
  contactWritable: boolean;
  /**
   * Whether this student's managed fields — name, grade, allergies — may be
   * edited from Tally, which is `PCO_WRITE_BACK=full` and nothing else.
   *
   * Not the same gate as `contactWritable`, which also needs an adult in the
   * household to write onto. The student editor reads this one: a name is
   * perfectly editable on a student whose family is not on file.
   */
  profileWritable: boolean;
  /**
   * Whether Tally may build this student a family — create the parent, and the
   * household if Planning Center has none for them — which is `full` *and*
   * nobody on file yet.
   *
   * The mirror image of `contactWritable`: exactly one of the two is ever true
   * on a `full` install, because a household either has an adult to put a
   * number on or it does not. That is what lets one screen offer "add a number"
   * and "add a parent" from the same place without deciding which it is.
   */
  parentCreatable: boolean;
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
  /**
   * Active students with no Planning Center person yet — the rows the Students
   * screen marks "Queued". Reported even when the connection is broken, because
   * a queue that is not moving is the thing worth seeing.
   */
  queued: number;
  /** The settings actually in force, whatever their source. */
  settings: PcoEffectiveSettings;
}

/**
 * One backend's connection report, from `getBackendStatuses` — every backend
 * Tally knows, connected or not, which is what lets the Settings screen show
 * Attendees before it is configured with the problem named.
 */
export interface BackendStatus {
  backendId: BackendId;
  displayName: string;
  /** Switched on and fully configured. */
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  problem: string | null;
  writeBack: PcoWriteBackMode;
  cacheTtlSeconds: number;
  peopleVisible: number | null;
  unresolved: number;
  /** Present only on an enabled backend. */
  capabilities: {
    writeBack: PcoWriteBackMode;
    parentCreatable: boolean;
    mergeAware: boolean;
    listsSupported: boolean;
    historyImportSupported: boolean;
    attendancePushSupported: boolean;
  } | null;
  /** The effective settings, shaped per backend. */
  settings: Record<string, unknown>;
}

export interface BackendStatuses {
  backends: BackendStatus[];
  /** Where a student Tally creates gets pushed. */
  defaultPushBackend: BackendId;
  /** Active students no backend holds yet — a deployment-wide count. */
  queued: number;
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

/**
 * The browser-writable half of the Attendees configuration —
 * `config/attendees32`, the `PcoRuntimeConfigDoc` reasoning applied to the
 * second backend. The DRF token is not here and cannot be: this document is
 * written by a browser, and a credential a browser can write is a credential
 * a browser can read.
 */
export interface A32RuntimeConfigDoc {
  /** The off switch. Absent counts as on — being configured is the real gate. */
  enabled: boolean;
  /** Admin-only: every Attendees request carries the token to this address. */
  baseUrl: string;
  divisionId: string;
  meetSlug: string;
  characterSlug: string;
  assemblySlug: string;
  minGrade: number;
  maxGrade: number;
  writeBack: PcoWriteBackMode;
  cacheTtlSeconds: number;
  updatedAt: Timestamp | null;
  updatedBy: string | null;
}

/** Cross-backend settings — `config/backends`. */
export interface BackendsConfigDoc {
  /** Which backend receives the students Tally creates. Absent means `pco`. */
  defaultPushBackend: BackendId;
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

/**
 * One Check-Ins event, as the import picker shows it.
 *
 * Check-Ins is the other Planning Center product: the door kiosk that has been
 * counting the church's gatherings since before Tally. Each row carries enough
 * history — how many nights, how many check-ins, since when — to recognise the
 * right event before anything is written, which is the whole job of a picker.
 */
export interface CheckInsEventSummary {
  id: string;
  name: string;
  /** As Planning Center spells it: "Weekly", "Daily", "None". */
  frequency: string | null;
  /** Gatherings on record upstream. */
  gatheringCount: number;
  /** Attendee check-ins across the event's whole history. */
  checkInCount: number;
  /** ISO instant of the first recorded gathering, or null for none yet. */
  firstGatheringAt: string | null;
  /** True when this event's chain already exists in Tally. */
  alreadyImported: boolean;
}

/**
 * What one Check-Ins import did — every count a leader needs to believe the
 * history arrived whole, including what was deliberately skipped and why it
 * is not missing. Mirrors `CheckInsImportSummary` in functions/src/pco.
 */
export interface CheckInsImportSummary {
  pcoEventId: string;
  eventName: string;
  /** The chain's root document id — also its `chainKey`. */
  rootEventId: string;
  gatherings: {
    found: number;
    created: number;
    existing: number;
    /** Nights nobody attended — holiday weeks. Not imported, by design. */
    skippedEmpty: number;
  };
  students: { found: number; added: number; existing: number };
  checkIns: {
    found: number;
    written: number;
    /** Rows left alone because a counselor wrote them in Tally itself. */
    kept: number;
    skippedVolunteers: number;
    skippedOneTimeGuests: number;
    duplicatesCollapsed: number;
  };
  warnings: string[];
}

/**
 * The backend id scheme lives in src/lib/backendIds.ts — shared verbatim with
 * the Cloud Functions — and is re-exported here because this module is where
 * every screen already looks for it.
 */
export {
  BACKEND_IDS,
  BACKEND_PREFIXES,
  PCO_ID_PREFIX,
  isBackendId,
  pcoStudentId,
  personIdFromStudentId,
  studentIdFor,
} from '@/lib/backendIds';
export { parseStudentId };
export type { BackendId };

/** What screens call each backend. Sentences build around these. */
export const BACKEND_LABELS: Record<BackendId, string> = {
  pco: 'Planning Center',
  a32: 'Attendees',
};

/**
 * Which backend holds a student, or null for a visitor no push has landed on.
 * The id prefix is the claim when there is one; the server-written linkage
 * fields answer for a visitor document, with the legacy `pcoPersonId` still
 * meaning Planning Center.
 */
export function backendOfStudent(
  student: Pick<Student, 'id' | 'pcoPersonId'> & {
    upstreamBackend?: BackendId | null;
    upstreamPersonId?: string | null;
  },
): BackendId | null {
  const parsed = parseStudentId(student.id);
  if (parsed) return parsed.backendId;
  if (student.upstreamBackend && student.upstreamPersonId) return student.upstreamBackend;
  return student.pcoPersonId ? 'pco' : null;
}

/**
 * The name a sentence about this student's backend should use.
 *
 * Falls back to Planning Center for a student no backend holds, because that
 * is where an unlinked student has always been said to be going — the queued
 * badge, the push button — and where the server still sends them unless a
 * leader has picked otherwise.
 */
export function backendLabelOf(student: Parameters<typeof backendOfStudent>[0]): string {
  return BACKEND_LABELS[backendOfStudent(student) ?? 'pco'];
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
export type RosterWarning = 'incomplete-profile' | 'allergy' | 'record-missing';

export interface RosterEntry {
  student: Student;
  /**
   * True when the prediction expects this student tonight — they attended at
   * least `predictiveMinAttended` of the last `predictiveOfLastN` instances of
   * this series. Deliberately independent of `attendance`: checking someone in
   * must not change which slice of the roster they belong to.
   */
  isRecent: boolean;
  /**
   * True when this student has been to this gathering before — or, for an event
   * with no history of its own to read, to anything Tally has counted. Unlike
   * `isRecent` this *does* include being checked in right now: it answers "does
   * this student belong to this gathering at all", and a visitor at the door
   * does as of tonight. Always false when there is nothing to measure against;
   * see `ParticipationSource`.
   */
  hasParticipated: boolean;
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
  /** Consecutive misses of `gatheringKey`, never pooled across the calendar. */
  consecutiveMisses: number;
  /** When they were last at *this* gathering. */
  lastAttendedAt: Date | null;
  lastAttendedEventTitle: string | null;
  /**
   * The chain of repeats they have drifted from — `chainKey` — or null for a
   * student the window has not seen at anything, who belongs to none of them.
   */
  gatheringKey: string | null;
  /** That chain's name, for a row that has to say which one it means. */
  gatheringTitle: string | null;
  /**
   * How many *other* gatherings they are also missing from. Zero in a
   * single-gathering view; only the merged list can count above it.
   */
  alsoMissingCount: number;
}

export interface NewVisitor {
  student: Student;
  firstEventId: string;
  firstEventTitle: string;
  firstAttendedAt: Date;
  /**
   * The gathering they first walked into, or null when that was a one-off (or
   * when the loaded window cannot say).
   */
  gatheringKey: string | null;
  /** True when we met them at a one-off rather than at a regular gathering. */
  viaOneOff: boolean;
}

/**
 * One past instance of a series, with what is known about who attended it.
 *
 * `presentStudentIds` is usually the whole register, but it is not promised to
 * be. A screen that only cares about one student — the profile, which answers
 * "was *this* student here?" for a year of nights — is allowed to build these
 * from that student's own attendance records, in which case the set holds at
 * most them and says nothing about anybody else.
 *
 * `held` exists because of that. "Did this gathering happen?" cannot be answered
 * by asking whether the set is empty once the set might be a projection: a night
 * the student missed and a night nobody came to both look like `{}`, and the
 * difference between them is a phone call to a family that has missed nothing.
 * Build it from the register when reading the whole register, and from the
 * skipped-nights registry when reading one student's own. `wasHeld` reads this
 * and never the set.
 */
export interface EventAttendanceSnapshot {
  event: TallyEvent;
  /**
   * Everybody who was checked in. This is the head count, and check-out does
   * not touch it — every metric built on attendance reads this and only this.
   */
  presentStudentIds: ReadonlySet<string>;
  /** The subset who were collected. Always a subset of the above. */
  checkedOutStudentIds: ReadonlySet<string>;
  /** Whether anybody at all was checked in. Never inferred from the set above. */
  held: boolean;
}
