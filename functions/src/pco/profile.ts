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
 *   - Tally holds no copy of a linked student's name, grade or allergies. A
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
 */
import { ABSOLUTE_MAX_GRADE, ABSOLUTE_MIN_GRADE, type PcoConfig } from '../config.js';
import type { PcoClient } from './client.js';
import { resolveStudentPerson } from './studentPerson.js';
import type { PcoPerson } from './types.js';
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
  /** The edit itself is not writable — a blank name, a grade outside 6-12. */
  | 'invalid';

export interface UpdateStudentProfileResult {
  status: UpdateStudentProfileStatus;
  /** Planning Center attribute names this call wrote. Empty unless `updated`. */
  wrote: string[];
  /** Plain language, for the leader who pressed Save. */
  message: string;
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
}

export interface UpdateStudentProfileOptions extends StudentProfilePatch {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  /** Tally student id — `pco_123` for a roster student. */
  studentId: string;
  logger?: FunctionLogger;
}

function result(
  status: UpdateStudentProfileStatus,
  message: string,
  wrote: string[] = [],
): UpdateStudentProfileResult {
  return { status, wrote, message };
}

function trimmed(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : null;
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
      return result('invalid', `Grade has to be between ${ABSOLUTE_MIN_GRADE} and ${ABSOLUTE_MAX_GRADE}.`);
    }
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

  const person = await client.get<PcoPerson>(`/people/${encodeURIComponent(target.personId)}`);
  if (!person.data?.id) {
    return result(
      'no-student',
      'Planning Center no longer has a record for this student — deleted or merged there.',
    );
  }

  const attributes = changedAttributes(options, person.data);
  const wrote = Object.keys(attributes);
  if (wrote.length === 0) {
    return result('unchanged', 'Planning Center already matches. Nothing was changed there.');
  }

  await client.patch(`/people/${encodeURIComponent(target.personId)}`, {
    data: { type: PCO_TYPES.person, id: target.personId, attributes },
  });

  // The field names, never the values: this line lands in a log a church admin
  // may read, and a minor's medical note has no business being in one.
  logger.info('Updated a Planning Center profile from Tally', {
    studentId,
    pcoPersonId: target.personId,
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
  );
}
