/**
 * Write-back: a student's own profile, Tally -> Planning Center.
 *
 * The third and last thing Tally writes into a database it does not own, and
 * the one a leader reaches most often — it is what the Edit profile form saves
 * once write-back is `full`. `pushStudents.ts` covers the same fields for a
 * student Tally created and is reconciling; this covers the ordinary case of
 * somebody correcting a misspelt name on a student Planning Center has always
 * had.
 *
 * The edit goes *straight* upstream rather than into Firestore and out again.
 * That is the whole reason this module exists rather than the form writing a
 * student document and letting the reconcile sweep notice the drift:
 *
 *   - Tally holds no copy of a linked student's name, grade, birthday or
 *     allergies — of the birthday it holds only the day, never the year. A
 *     form that wrote one would put the church's own data back in Firestore,
 *     which is exactly what removing the mirror got rid of — and `mergeRoster`
 *     would ignore it anyway, so the edit would not even show.
 *   - A copy left behind is a copy that gets pushed again later. A name
 *     corrected in Planning Center next month would be silently overwritten by
 *     whatever Tally still had on file.
 *
 * Restraint, as everywhere on this side of the line: only the attributes that
 * actually changed are sent, nothing else on the person is touched, and a
 * student with no upstream record is refused rather than created.
 *
 * The birthday is the awkward one, because it is the only field Tally is shown
 * *less* of than it can write — see the Birthdays section below.
 */
import { ABSOLUTE_MAX_GRADE, ABSOLUTE_MIN_GRADE, type PcoConfig } from '../config.js';
import type { PcoClient } from './client.js';
import { UNKNOWN_BIRTH_YEAR } from './mapping.js';
import { rosterPersonFrom, type RosterPerson } from './roster.js';
import { readThroughMerges, resolveStudentPerson } from './studentPerson.js';
import type { PcoPerson, PcoPersonAttributes } from './types.js';
import { PCO_TYPES } from './types.js';
import { SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';

export type UpdateStudentProfileStatus =
  /** At least one attribute was written upstream. */
  | 'updated'
  /** Everything asked for already matched Planning Center; nothing was sent. */
  | 'unchanged'
  /** `PCO_WRITE_BACK` is not `full`. */
  | 'disabled'
  /** No such student, or one who is not on the roster. */
  | 'no-student'
  /** A Tally-only visitor: there is no upstream person to edit. */
  | 'not-in-planning-center'
  /** The edit itself is not writable — a blank name, a grade outside K-12. */
  | 'invalid';

export interface UpdateStudentProfileResult {
  status: UpdateStudentProfileStatus;
  /** Planning Center attribute names this call wrote. Empty unless `updated`. */
  wrote: string[];
  /** Plain language, for the leader who pressed Save. */
  message: string;
  /**
   * This student's roster row, as Planning Center holds it now that the write
   * has landed. Null when there was no person to read — every refusal above the
   * upstream read.
   *
   * Here so that saving a profile does not cost a roster read. The row is the
   * only thing on screen the edit changed, and the caller used to get it by
   * asking for the whole roster again with `force` — a sweep of every child in
   * the church, paged, side-loaded and uncached, which the leader watched a
   * spinner through to see one date appear. This is the same row that sweep
   * would have produced, built by the same function, from the person this call
   * already had in its hand.
   *
   * Carried on `unchanged` as well as `updated`, and that case is the one worth
   * keeping: "Planning Center already matches" often means somebody else filled
   * the field in and *this* browser is the stale one. Sending the row is what
   * corrects it.
   */
  person: RosterPerson | null;
}

/**
 * The edit, as the form holds it.
 *
 * Every field is optional and `undefined` means "not part of this edit" — a
 * form that only touched the grade must not restate a name it never showed.
 * `null` on `nickname` and `allergies` is a real value: clear what is there.
 *
 * `firstName` is the plain first name, never the `Benson “蔡秉洲”` composite the
 * rest of Tally passes around. Planning Center holds the two halves separately
 * and the editor has a box for each, so they arrive that way and no splitting
 * has to be guessed at here.
 */
export interface StudentProfilePatch {
  firstName?: string;
  nickname?: string | null;
  lastName?: string;
  grade?: number;
  allergies?: string | null;
  /**
   * `MM-DD`, or `YYYY-MM-DD` when the year is being set too.
   *
   * Two shapes because Tally is never *told* the year — the roster carries the
   * day only, deliberately, so a leader correcting the day on a birthday already
   * on file cannot retype a year they have not been shown. `MM-DD` therefore
   * means "this day, keeping whatever year Planning Center holds", and on a
   * person with no birthdate at all it means "this day, with no year", which
   * Planning Center stores as 1885 — see `UNKNOWN_BIRTH_YEAR`.
   *
   * No `null`. Every other field here can be cleared; this one cannot, because
   * deleting a date of birth is not a correction anybody makes from a roster
   * badge, and Tally not holding the value means a blank box has never been
   * evidence that somebody meant to empty it.
   */
  birthday?: string;
}

export interface UpdateStudentProfileOptions extends StudentProfilePatch {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  /** Tally student id — `pco_123` for a roster student. */
  studentId: string;
  /** Defaults to the real clock. Only read to refuse a year of birth in the future. */
  now?: Date;
  logger?: FunctionLogger;
}

function result(
  status: UpdateStudentProfileStatus,
  message: string,
  wrote: string[] = [],
  person: RosterPerson | null = null,
): UpdateStudentProfileResult {
  return { status, wrote, message, person };
}

function trimmed(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : null;
}

/* -------------------------------------------------------------------------- */
/* Birthdays                                                                   */
/* -------------------------------------------------------------------------- */

/*
 * A birthday is the one field here that arrives incomplete on purpose.
 *
 * Planning Center stores `birthdate` as a whole date and Tally is never sent the
 * year — the roster carries `MM-DD` and nothing else, so that a browser holding
 * eighty-five children does not hold eighty-five dates of birth. That makes the
 * edit asymmetric: a leader can see and correct the day, and cannot see the year
 * to retype it.
 *
 * So `MM-DD` means "this day, keeping the year already upstream" and is resolved
 * against a fresh read of the person.
 *
 * When there is no birthdate at all there is no year to keep — and none is
 * invented, because Planning Center shows an age computed from this field and a
 * guessed year is a wrong age on a child's permanent record that nobody would
 * ever think to check. Planning Center has its own answer for this and Tally
 * uses it: a birthday whose year nobody knows is stored as 1885, which its own
 * documentation asks people to type and which makes it show no age at all.
 */

/** Days in each month, taking February at its leap-year length. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The earliest year of birth this will accept from a caller. */
const EARLIEST_BIRTH_YEAR = 1900;

/*
 * `UNKNOWN_BIRTH_YEAR` — Planning Center's 1885 — lives in `mapping.js` with
 * the rest of the birthday vocabulary, because both directions need it: this
 * file writes it, and the one-person read refuses to show it.
 */

/**
 * Whether a date somebody typed is a date that exists.
 *
 * A month and a day alone are checked against the longest February, because 29
 * February is a birthday people have and the year is optional here. Given a
 * year, the same date is checked against that year's real February, so
 * "29 February 2011" is refused rather than written and silently moved to 1
 * March by the far end.
 *
 * Must stay in step with `isRealBirthday` in src/lib/birthday.ts.
 */
export function isRealBirthday(month: number, day: number, year: number | null): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;

  if (year === null) return day <= DAYS_IN_MONTH[month - 1];

  if (!Number.isInteger(year) || year < EARLIEST_BIRTH_YEAR) return false;
  const limit = month === 2 && !isLeapYear(year) ? 28 : DAYS_IN_MONTH[month - 1];
  return day <= limit;
}

export interface BirthdayPatch {
  month: number;
  day: number;
  /** Null when the caller is changing the day and leaving the year alone. */
  year: number | null;
}

/**
 * `MM-DD` or `YYYY-MM-DD` as the two numbers or three that it is, or null when
 * it is neither.
 *
 * A year in the future is not a year of birth, and one in the past century that
 * belongs to a grandparent typed into the wrong box is not either — but only the
 * first of those is knowable, so only the first is refused.
 *
 * Must stay in step with `composeBirthday` in src/lib/birthday.ts.
 */
export function parseBirthdayPatch(raw: string, now: Date): BirthdayPatch | null {
  const text = raw.trim();

  const match = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;

  const year = match[1] === undefined ? null : Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year !== null && year > now.getFullYear()) return null;
  if (!isRealBirthday(month, day, year)) return null;

  return { month, day, year };
}

/** The year Planning Center already holds on this person, or null. */
function heldBirthYear(birthdate: string | null): number | null {
  const match = /^(\d{4})-\d{2}-\d{2}/.exec(birthdate ?? '');
  return match ? Number(match[1]) : null;
}

export type BirthdateResolution =
  /** The whole date to send, or null when it already matches what is upstream. */
  | { ok: true; birthdate: string | null }
  /** 29 February kept against a year — held or unknown — that does not have one. */
  | { ok: false; reason: 'not-in-that-year' };

/**
 * The `YYYY-MM-DD` this edit means, given what Planning Center currently holds.
 *
 * Three ways the year is settled, in order: the one the caller gave, the one
 * already on the person, and — for a day typed against a person with no
 * birthdate at all — `UNKNOWN_BIRTH_YEAR`, which is Planning Center's own way of
 * holding a birthday with no year rather than a guess at this child's.
 *
 * A 29 February day kept against a year with no 29 February in it is refused
 * rather than moved to 1 March: the year on file belongs to a person, and if it
 * makes the date impossible then one of the two is wrong and a leader should say
 * which. 1885 is not a leap year either, which is the one date this cannot store
 * without being told the year.
 */
export function resolveBirthdate(
  wanted: BirthdayPatch,
  heldBirthdate: string | null,
): BirthdateResolution {
  const year = wanted.year ?? heldBirthYear(heldBirthdate) ?? UNKNOWN_BIRTH_YEAR;
  // `isRealBirthday` has a floor of 1900, which 1885 is deliberately under.
  const real =
    year === UNKNOWN_BIRTH_YEAR
      ? isRealBirthday(wanted.month, wanted.day, null) && !(wanted.month === 2 && wanted.day === 29)
      : isRealBirthday(wanted.month, wanted.day, year);
  if (!real) {
    return { ok: false, reason: 'not-in-that-year' };
  }

  const pad = (value: number) => String(value).padStart(2, '0');
  const birthdate = `${year}-${pad(wanted.month)}-${pad(wanted.day)}`;
  return { ok: true, birthdate: birthdate === trimmed(heldBirthdate) ? null : birthdate };
}

/**
 * The attributes that differ from what Planning Center currently holds.
 *
 * Compared field by field against a fresh read rather than against whatever the
 * browser was showing, because the form may have been open for a while and the
 * value it started from may have been corrected upstream since. Sending an
 * attribute that already matches would make Tally the last writer on a value
 * nobody changed here.
 */
function changedAttributes(
  patch: StudentProfilePatch,
  person: PcoPerson,
): Record<string, unknown> {
  const held = person.attributes ?? {};
  const attributes: Record<string, unknown> = {};

  if (patch.firstName !== undefined && patch.firstName.trim() !== trimmed(held.first_name)) {
    attributes.first_name = patch.firstName.trim();
  }
  if (patch.lastName !== undefined && patch.lastName.trim() !== trimmed(held.last_name)) {
    attributes.last_name = patch.lastName.trim();
  }
  if (patch.nickname !== undefined && trimmed(patch.nickname) !== trimmed(held.nickname)) {
    // Cleared as an empty string, not omitted: `undefined` is how this function
    // says "not part of the edit", so a nickname somebody deleted has to be
    // sent as something.
    attributes.nickname = trimmed(patch.nickname) ?? '';
  }
  if (patch.grade !== undefined && patch.grade !== held.grade) {
    attributes.grade = patch.grade;
  }
  if (patch.allergies !== undefined && trimmed(patch.allergies) !== trimmed(held.medical_notes)) {
    attributes.medical_notes = trimmed(patch.allergies) ?? '';
  }

  return attributes;
}

/** Planning Center's attribute names, as a sentence a leader would recognise. */
const FIELD_LABELS: Record<string, string> = {
  first_name: 'first name',
  last_name: 'last name',
  nickname: 'nickname',
  grade: 'grade',
  medical_notes: 'allergies',
  birthdate: 'birthday',
};

function describe(wrote: readonly string[]): string {
  const labels = wrote.map((field) => FIELD_LABELS[field] ?? field);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Applies a profile edit to the linked Planning Center person.
 *
 * Refuses rather than half-succeeds: the whole edit is one PATCH, so a grade
 * Planning Center rejects does not leave a half-renamed person behind.
 */
export async function updateStudentProfile(
  options: UpdateStudentProfileOptions,
): Promise<UpdateStudentProfileResult> {
  const { db, client, config, studentId } = options;
  const logger = options.logger ?? SILENT_LOGGER;

  if (config.writeBack !== 'full') {
    return result(
      'disabled',
      'Editing a Planning Center profile from Tally is switched off. A leader can turn on full write-back in Settings, or make the change in Planning Center.',
    );
  }

  if (options.firstName !== undefined && !options.firstName.trim()) {
    return result('invalid', 'A first name is required.');
  }
  if (options.lastName !== undefined && !options.lastName.trim()) {
    return result('invalid', 'A last name is required.');
  }
  if (options.grade !== undefined) {
    const grade = options.grade;
    if (
      !Number.isInteger(grade) ||
      grade < ABSOLUTE_MIN_GRADE ||
      grade > ABSOLUTE_MAX_GRADE
    ) {
      // 0 is kindergarten, and "between 0 and 12" reads like a bug report.
      const floor = ABSOLUTE_MIN_GRADE === 0 ? 'K' : String(ABSOLUTE_MIN_GRADE);
      return result('invalid', `Grade has to be between ${floor} and ${ABSOLUTE_MAX_GRADE}.`);
    }
  }
  /*
   * The shape of the date now; the year it resolves to only once the person has
   * been read. Refusing "31 February" before a network round trip is worth the
   * split, and the year genuinely cannot be settled until we know what is on
   * file.
   */
  const wantedBirthday =
    options.birthday === undefined
      ? null
      : parseBirthdayPatch(options.birthday, options.now ?? new Date());
  if (options.birthday !== undefined && wantedBirthday === null) {
    return result('invalid', 'That is not a date. Give a day and a month, and a year if you have it.');
  }

  const target = await resolveStudentPerson(db, studentId);
  if (!target.exists || !target.active) {
    return result('no-student', 'That student is not on the roster.');
  }
  if (!target.personId) {
    return result(
      'not-in-planning-center',
      'This student is not in Planning Center yet, so there is nothing to edit there. Their details stay in Tally until the next sync creates them.',
    );
  }

  /*
   * `readThroughMerges`, not a bare get: a merged student answers 410 with a
   * forwarding address, and the right response to "this record is now that
   * one" is to follow it, repoint the roster document, and save the edit onto
   * the person the church actually kept.
   */
  const read = await readThroughMerges(
    { db, client },
    studentId,
    target.personId,
    (personId) => client.get<PcoPerson>(`/people/${encodeURIComponent(personId)}`),
  );
  if (read.outcome === 'gone' || !read.value.data?.id) {
    return result(
      'no-student',
      'Planning Center no longer has a record for this student — deleted or merged there.',
    );
  }
  const person = read.value;
  const personId = read.personId;

  const attributes = changedAttributes(options, person.data);

  if (wantedBirthday) {
    const resolved = resolveBirthdate(
      wantedBirthday,
      trimmed((person.data.attributes ?? {}).birthdate),
    );
    if (!resolved.ok) {
      return result(
        'invalid',
        'The year this day would be kept against has no 29 February in it. Give the year as well, so the whole date is one somebody decided on.',
      );
    }
    if (resolved.birthdate !== null) attributes.birthdate = resolved.birthdate;
  }

  /*
   * The row as it will stand once this call is done, for the caller's screen.
   *
   * Composed rather than re-read: the person was read a moment ago and these
   * are the only attributes about to change on them, so applying the patch to
   * what came back says exactly what a fresh read would — without a second
   * round trip on the path somebody is watching a spinner on. Anything the
   * PATCH goes on to refuse never gets this far; the throw is the answer.
   */
  const rowAfter = (): RosterPerson =>
    rosterPersonFrom(
      {
        ...person.data,
        attributes: {
          ...(person.data.attributes ?? {}),
          ...(attributes as PcoPersonAttributes),
        },
      },
      config,
      options.now ?? new Date(),
    );

  const wrote = Object.keys(attributes);
  if (wrote.length === 0) {
    return result(
      'unchanged',
      'Planning Center already matches. Nothing was changed there.',
      [],
      rowAfter(),
    );
  }

  await client.patch(`/people/${encodeURIComponent(personId)}`, {
    data: { type: PCO_TYPES.person, id: personId, attributes },
  });

  // The field names, never the values: this line lands in a log a church admin
  // may read, and neither a minor's medical note nor their date of birth has any
  // business being in one.
  logger.info('Updated a Planning Center profile from Tally', {
    studentId,
    pcoPersonId: personId,
    ...(read.grafted ? { mergedFrom: target.personId } : {}),
    wrote,
  });

  /*
   * A grade outside the configured band is a legitimate edit with a
   * consequence nobody would guess: the roster is built by grade, so the
   * student is about to vanish from every screen. Said here, once, rather than
   * left for somebody to discover on Friday.
   */
  const grade = attributes.grade;
  const outOfBand =
    typeof grade === 'number' && (grade < config.minGrade || grade > config.maxGrade);

  return result(
    'updated',
    outOfBand
      ? `Saved ${describe(wrote)} in Planning Center. That grade is outside the ${config.minGrade}-${config.maxGrade} band Tally reads, so they will drop off the roster.`
      : `Saved ${describe(wrote)} in Planning Center.`,
    wrote,
    rowAfter(),
  );
}
