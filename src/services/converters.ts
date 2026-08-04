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
import { findEventIcon } from '@/lib/eventIcons';
import { sanitizeLabelTemplate } from '@/lib/labelTemplate';
import {
  EVERY_WEEKDAY,
  fromDateOnlyValue,
  isRecurrenceFrequency,
  normalizeRecurrence,
} from '@/lib/recurrence';
import {
  isBackendId,
  parseStudentId,
  DEFAULT_SETTINGS,
  buildSearchName,
  isGrade,
  type AppSettings,
  type AppSettingsDoc,
  type AttendanceRecord,
  type EventSeries,
  type Grade,
  type PcoRosterPerson,
  type RecurrenceFrequency,
  type RecurrenceRule,
  type Rsvp,
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

/**
 * A real Date, not merely something that answers to `instanceof`.
 *
 * `instanceof` walks the prototype chain, so any object whose `__proto__` was
 * assigned a Date passes it — and then `getTime()` throws `TypeError: this is
 * not a Date object`, from inside a converter, on the check-in screen. The brand
 * check is the only test that actually asks "was this constructed as a Date".
 *
 * Exotic, and this is exactly the boundary where exotic input arrives: every
 * value here was written by something else. Found by the fuzz suite.
 */
function isDate(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
}

export function toDate(value: unknown, fallback: Date): Date {
  return toDateOrNull(value) ?? fallback;
}

export function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Timestamp) return usable(value.toDate());
  if (isDate(value)) return usable(value);
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

/**
 * The grade on a document, or null when there is not one.
 *
 * No invented fallback. This used to answer 6 for anything unrecognised and
 * pair that with a `gradeOnFile: false` flag, which meant every screen had to
 * remember to ask the flag before printing the number — and a value outside
 * the range Tally understands came back as a confident lie rather than an
 * absence.
 */
function grade(value: unknown): Grade | null {
  return isGrade(value) ? value : null;
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
  const pcoPersonId = strOrNull(data.pcoPersonId);

  return {
    id: snapshot.id,
    firstName,
    lastName,
    // Null for a document that holds no grade at all — an annotation written
    // against somebody the backend has no grade for, which `updateStudent`
    // deliberately declines to invent one for.
    grade: grade(data.grade),
    notes: strOrNull(data.notes),
    status: data.status === 'inactive' ? 'inactive' : 'active',
    isVisitor: bool(data.isVisitor),
    pcoPersonId,
    pcoPushPending: bool(data.pcoPushPending),
    pcoRecordMissing: bool(data.pcoRecordMissing),
    // The generic linkage pair, server-written; `backendOfStudent` reads it.
    upstreamBackend: isBackendId(data.upstreamBackend) ? data.upstreamBackend : null,
    upstreamPersonId: strOrNull(data.upstreamPersonId),
    // A Tally document describes somebody Planning Center has not told us
    // about, so this is false by construction. When Planning Center *does* know
    // them, the roster entry wins and carries the real value.
    fromPlanningCenter: false,
    /*
     * `false` — "nobody can be reached about them" — is only true while there
     * is nowhere upstream for a parent to live. Tally stores no contact details
     * and never will, so a document of its own is the whole answer for a
     * visitor who exists nowhere else.
     *
     * The moment their push lands, it stops being the answer and starts being
     * an accusation about a household nobody has looked at. This used to say
     * `false` regardless, on the reasoning that the roster entry wins once
     * Planning Center knows them — which holds only while the roster is
     * carrying them. It does not in the gap after a push, nor for anyone the
     * roster read could not resolve, and in that gap the flag outranks
     * Planning Center's own answer: a contact typed into Tally and written
     * upstream left the student on the "incomplete profiles" list for good,
     * because the list was reading a boolean that could never change.
     */
    profileComplete: pcoPersonId ? null : false,
    hasAllergies: false,
    // Planning Center's, like the two above it. A quick-added visitor genuinely
    // has no birthday on file until their push lands and the roster answers.
    birthday: null,
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

/**
 * A stored recurrence, or null.
 *
 * Nothing downstream may see a half-formed rule: `describeRecurrence` would
 * phrase a nonsense sentence on the event page, and the expander would loop
 * over a frequency it has no case for. `normalizeRecurrence` repairs the
 * *values* — this decides whether there is a rule at all, which it can only do
 * once the shape is known to be a rule.
 */
function toRecurrence(value: unknown, anchor: Date): RecurrenceRule | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;

  // `daily` was once a frequency of its own. It is every weekday of a weekly
  // rule, which is the same schedule and the only one the editor can now
  // produce — so an older document, or a write from a stale cached bundle,
  // reads back as what it always meant rather than as no rule at all.
  const legacyDaily = raw.frequency === 'daily';
  if (!legacyDaily && !isRecurrenceFrequency(raw.frequency)) return null;
  const frequency = legacyDaily ? 'weekly' : (raw.frequency as RecurrenceFrequency);

  return normalizeRecurrence(
    {
      frequency,
      interval: legacyDaily ? 1 : num(raw.interval, 1),
      weekdays: legacyDaily
        ? [...EVERY_WEEKDAY]
        : Array.isArray(raw.weekdays)
          ? (raw.weekdays as number[])
          : [],
      monthlyMode: raw.monthlyMode === 'dayOfWeek' ? 'dayOfWeek' : 'dayOfMonth',
      // A malformed `until` reads as "no end date" rather than as "ended", so a
      // corrupt field never makes a live weekly gathering look finished.
      until: typeof raw.until === 'string' && fromDateOnlyValue(raw.until) ? raw.until : null,
      count: numOrNull(raw.count),
    },
    anchor,
  );
}

export function toEvent(snapshot: DocumentSnapshot<DocumentData>): TallyEvent {
  const data = snapshot.data() ?? {};
  const fallback = pendingFallback(snapshot);
  const startAt = toDate(data.startAt, fallback);
  const endAt = toDate(data.endAt, startAt);
  const mode: TallyEvent['mode'] = data.mode === 'oneoff' ? 'oneoff' : 'recurring';

  return {
    id: snapshot.id,
    title: str(data.title, 'Untitled event'),
    description: strOrNull(data.description),
    // Checked against the bundled catalogue rather than trusted: a name that is
    // no longer shipped, or one that was never a Material symbol, would leave
    // an empty tile in a list of full ones.
    icon: findEventIcon(strOrNull(data.icon))?.name ?? null,
    mode,
    seriesId: strOrNull(data.seriesId),
    // A one-off does not repeat by definition, so a stray rule on one is
    // dropped rather than rendered.
    recurrence: mode === 'recurring' ? toRecurrence(data.recurrence, startAt) : null,
    recurrenceRootId: strOrNull(data.recurrenceRootId),
    // Only a trip borrows a prediction. A recurring gathering reads its own
    // chain, and a stray value here would silently redirect it to another one.
    predictFromChain: mode === 'oneoff' ? strOrNull(data.predictFromChain) : null,
    startAt,
    endAt,
    checkInOpensAt: toDate(data.checkInOpensAt, startAt),
    checkInClosesAt: toDate(data.checkInClosesAt, endAt),
    location: strOrNull(data.location),
    notes: strOrNull(data.notes),
    // A one-off without an explicit flag still defaults to an RSVP roster: a
    // trip with a fixed list is the reason one-offs have a roster story at all.
    requiresRsvp: bool(data.requiresRsvp, mode === 'oneoff'),
    // No default from `mode`: a nursery is a thing somebody turns on, not
    // something a gathering's shape implies.
    requiresCheckOut: bool(data.requiresCheckOut, false),
    // Null for "prints nothing", which is also what a malformed template reads
    // as — the sanitizer's docblock explains why that is the safe direction.
    labelTemplate: sanitizeLabelTemplate(data.labelTemplate),
    status: data.status === 'cancelled' ? 'cancelled' : 'scheduled',
    createdAt: toDate(data.createdAt, fallback),
    updatedAt: toDate(data.updatedAt, fallback),
    createdBy: str(data.createdBy),
    // It came out of Firestore, so a document is exactly what it is. The other
    // half of the calendar is built in `lib/eventProjection.ts`.
    materialized: true,
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
      method === 'search' ||
      method === 'quick-add' ||
      method === 'manual' ||
      method === 'import' ||
      method === 'kiosk'
        ? method
        : 'tap',
    isFirstEver: bool(data.isFirstEver),
    /*
     * Four cases, and they have to stay apart.
     *
     * The key being *absent* is the whole "still in the room" state, so it
     * cannot share an encoding with anything else. A key that is present but
     * null is a pending `serverTimestamp()` — the same substitution
     * `checkedInAt` makes above — unless nothing is pending, in which case it
     * is a document somebody hand-wrote in the console and means no more than
     * an absent key would.
     */
    checkedOutAt:
      'checkedOutAt' in data
        ? (toDateOrNull(data.checkedOutAt) ??
          (snapshot.metadata.hasPendingWrites ? new Date() : null))
        : null,
    checkedOutBy: strOrNull(data.checkedOutBy),
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
    notes: strOrNull(data.notes),
    updatedAt: toDate(data.updatedAt, pendingFallback(snapshot)),
    updatedBy: str(data.updatedBy),
  };
}

/* -------------------------------------------------------------------------- */
/* Users, series, settings                                                     */
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
    active: bool(data.active, false),
    createdAt: toDate(data.createdAt, pendingFallback(snapshot)),
    lastSeenAt: toDateOrNull(data.lastSeenAt),
    pcoPersonId: strOrNull(data.pcoPersonId),
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
    active: bool(data.active, true),
    order: num(data.order, 0),
  };
}

export function toSettings(snapshot: DocumentSnapshot<DocumentData>): AppSettings {
  if (!snapshot.exists()) return DEFAULT_SETTINGS;
  const data = (snapshot.data() ?? {}) as Partial<AppSettingsDoc>;

  // Clamp to sane ranges: a misconfigured `predictiveOfLastN` of 0 would make
  // the Recent filter silently vanish, which reads as a bug to a counselor.
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

/* -------------------------------------------------------------------------- */
/* Planning Center -> Student                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A roster row from Planning Center, in the shape the rest of the app already
 * speaks.
 *
 * The fields Tally owns and Planning Center knows nothing about — notes, when
 * this student first turned up — are absent here and merged in from the
 * student's Firestore document if one exists. Most students never get one:
 * a document is written only when Tally has something of its own to record.
 */
/** See the note on `createdAt` in `fromRosterPerson`. */
const EPOCH = new Date(0);

export function fromRosterPerson(person: PcoRosterPerson, now: Date): Student {
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    grade: grade(person.grade),
    notes: null,
    status: person.status,
    isVisitor: false,
    pcoPersonId: person.pcoPersonId,
    pcoPushPending: false,
    /*
     * The linkage travels on the row itself, so screens can name the right
     * backend even after `mergeRoster` moves this row under a visitor
     * document's id — where the prefix stops answering. An older stored
     * roster without `backendId` is Planning Center's: it predates anything
     * else existing.
     */
    upstreamBackend: person.backendId ?? parseStudentId(person.id)?.backendId ?? 'pco',
    upstreamPersonId: person.pcoPersonId,
    fromPlanningCenter: true,
    profileComplete: person.profileComplete,
    hasAllergies: person.hasAllergies,
    // `?? null` rather than a bare read: a roster parked in local storage by a
    // build that predates this field comes back without it, and `undefined`
    // would reach the badge as "not missing" and quietly say nothing.
    birthday: person.birthday ?? null,
    searchName: person.searchName,
    firstAttendedAt: null,
    lastAttendedAt: null,
    /*
     * Deliberately the epoch, not "now".
     *
     * `createdAt` has exactly one job in Tally: deciding whether a student could
     * plausibly have attended a past gathering, so a visitor entered last Friday
     * is not reported as having missed the three Fridays before they existed.
     * Stamping a Planning Center student with the time we happened to read them
     * would make *every* past event predate *every* student, and the MIA list —
     * the whole point of the dashboard — would silently be empty forever.
     *
     * Somebody the church already had on file counts as having been around.
     */
    createdAt: EPOCH,
    updatedAt: now,
    // The same sentinels the server's imports write: the row's true source.
    createdBy: person.backendId === 'a32' ? 'attendees32' : 'planning-center',
    updatedBy: null,
  };
}
