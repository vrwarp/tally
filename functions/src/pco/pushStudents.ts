/**
 * Write-back: Tally -> Planning Center People.
 *
 * This is the only code in Tally that changes a system Tally does not own. A
 * bug here does not show up as a broken screen; it shows up as a duplicate
 * child in the church's permanent people database, which somebody has to merge
 * by hand months later. Everything below is therefore biased toward doing
 * nothing:
 *
 *   - `PCO_WRITE_BACK=off` is a real, supported mode that leaves the flag set.
 *   - Before creating a person, an exact first + last + grade match in Planning
 *     Center is linked to instead. Ambiguity links to the lowest id rather than
 *     adding yet another record.
 *   - `full` mode only ever patches the fields Planning Center already manages.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { PcoConfig } from '../config.js';
import { PcoApiError, type PcoClient } from '../pco/client.js';
import {
  compareIds,
  mapPersonToStudent,
  nameGradeKey,
  splitFirstName,
} from '../pco/mapping.js';
import type { PcoPerson } from '../pco/types.js';
import {
  PATHS,
  SILENT_LOGGER,
  type DocumentSnapshotLike,
  type FirestoreLike,
  type FunctionLogger,
} from '../firestore.js';

/** Mirrors `PushStudentResult` in src/services/functions.ts. */
export interface PushStudentResult {
  status: 'created' | 'updated' | 'skipped';
  pcoPersonId: string | null;
  message: string;
}

export interface PushStudentOptions {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  studentId: string;
  now?: Date;
  logger?: FunctionLogger;
}

/** How many search hits to consider before giving up on an exact match. */
const SEARCH_PAGE_SIZE = 25;

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Looks for the person this student obviously already is.
 *
 * "Obviously" is deliberately strict: first name, last name *and* grade must all
 * match. `where[search_name]` is fuzzy on the server, so the result is filtered
 * again locally through the same normalisation the visitor-collapse uses.
 */
async function findExistingPerson(
  client: PcoClient,
  config: PcoConfig,
  firstName: string,
  lastName: string,
  grade: number,
): Promise<PcoPerson | null> {
  // The server's fuzzy `search_name` has never seen `Benson “蔡秉洲” Tsai` — it
  // indexes the halves — so it is asked for the plain name and the composite is
  // matched locally below.
  const plainFirstName = splitFirstName(firstName).firstName;
  const body = await client.get<PcoPerson[]>('/people', {
    where: { search_name: `${plainFirstName} ${lastName}`, grade },
    per_page: SEARCH_PAGE_SIZE,
  });

  const wanted = nameGradeKey(firstName, lastName, grade);
  const matches = (Array.isArray(body.data) ? body.data : []).filter((person) => {
    // The *raw* grade, not the clamped one: a person whose grade is blank would
    // otherwise be normalised into the band and match by accident.
    if (person.attributes?.grade !== grade) return false;

    const mapped = mapPersonToStudent(person, {
      minGrade: config.minGrade,
      maxGrade: config.maxGrade,
    });
    // Compare against the raw first name too: Planning Center may hold the legal
    // name while the nickname is what the counselor typed at the door.
    const candidates = new Set([
      nameGradeKey(mapped.firstName, mapped.lastName, grade),
      nameGradeKey(person.attributes?.first_name ?? '', mapped.lastName, grade),
    ]);
    return candidates.has(wanted);
  });

  if (matches.length === 0) return null;
  // Several exact matches means the church database already has duplicates.
  // Adding a third is strictly worse than picking the oldest deterministically.
  return matches.sort((a, b) => compareIds(a.id, b.id))[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Push                                                                        */
/* -------------------------------------------------------------------------- */

function createAttributes(data: Record<string, unknown>): Record<string, unknown> {
  const allergies = readString(data, 'allergies');
  // Tally holds Planning Center's *display* name, `Benson “蔡秉洲”`. Planning
  // Center holds the two halves separately and composes them itself, so they go
  // back the way they came.
  const name = splitFirstName(readString(data, 'firstName') ?? '');
  return {
    first_name: name.firstName,
    ...(name.nickname ? { nickname: name.nickname } : {}),
    last_name: readString(data, 'lastName') ?? '',
    grade: Number(data.grade ?? 0),
    // Every student on the roster is a minor; the flag is what puts them in the
    // church's children/students views rather than the adult directory.
    child: true,
    ...(allergies ? { medical_notes: allergies } : {}),
  };
}

/** Managed fields whose Tally value differs from what Planning Center holds. */
function driftedAttributes(
  data: Record<string, unknown>,
  person: PcoPerson,
  config: PcoConfig,
): Record<string, unknown> {
  const mapped = mapPersonToStudent(person, {
    minGrade: config.minGrade,
    maxGrade: config.maxGrade,
  });
  const attributes: Record<string, unknown> = {};

  const firstName = readString(data, 'firstName');
  const lastName = readString(data, 'lastName');
  const allergies = readString(data, 'allergies');
  const grade = Number(data.grade ?? 0);

  // Both sides are compared as display names — `mapped.firstName` is composed
  // the same way Planning Center composes it — and only then split apart again
  // for the patch, so an unedited nickname is never rewritten.
  if (firstName && firstName !== mapped.firstName) {
    const wanted = splitFirstName(firstName);
    attributes.first_name = wanted.firstName;
    const held = readString(person.attributes ?? {}, 'nickname');
    if ((wanted.nickname ?? null) !== held) attributes.nickname = wanted.nickname ?? '';
  }
  if (lastName && lastName !== mapped.lastName) attributes.last_name = lastName;
  if (Number.isFinite(grade) && grade > 0 && grade !== mapped.grade) attributes.grade = grade;
  if ((allergies ?? null) !== mapped.allergies) attributes.medical_notes = allergies ?? '';

  return attributes;
}

/**
 * Pushes one student. Used both by the callable (a core-team member finishing a
 * visitor's profile mid-event) and by the `onStudentCreated` trigger.
 */
export async function pushStudent(options: PushStudentOptions): Promise<PushStudentResult> {
  const { db, client, config, studentId } = options;
  const logger = options.logger ?? SILENT_LOGGER;
  const now = options.now ?? new Date();
  const nowTs = Timestamp.fromDate(now);

  const ref = db.collection(PATHS.students).doc(studentId);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return { status: 'skipped', pcoPersonId: null, message: 'Student not found.' };
  }

  const data = snapshot.data() ?? {};
  const pcoPersonId = readString(data, 'pcoPersonId');

  if (config.writeBack === 'off') {
    // The flag stays set on purpose: turning write-back on later must pick these
    // students up without anybody re-editing them.
    return {
      status: 'skipped',
      pcoPersonId,
      message: 'Planning Center write-back is disabled; the student stays queued.',
    };
  }

  const firstName = readString(data, 'firstName');
  const lastName = readString(data, 'lastName');
  const grade = Number(data.grade ?? 0);
  if (!firstName || !lastName || !Number.isFinite(grade)) {
    return { status: 'skipped', pcoPersonId, message: 'Student is missing a name or grade.' };
  }

  /* ---- Already linked ---------------------------------------------------- */
  if (pcoPersonId) {
    if (config.writeBack !== 'full') {
      return { status: 'skipped', pcoPersonId, message: 'Already linked to Planning Center.' };
    }

    const person = await client.get<PcoPerson>(`/people/${encodeURIComponent(pcoPersonId)}`);
    const attributes = driftedAttributes(data, person.data, config);
    if (Object.keys(attributes).length === 0) {
      return { status: 'skipped', pcoPersonId, message: 'Planning Center is already up to date.' };
    }

    await client.patch(`/people/${encodeURIComponent(pcoPersonId)}`, {
      data: { type: 'Person', id: pcoPersonId, attributes },
    });
    await ref.update({ pcoSyncedAt: nowTs, pcoPushPending: false, updatedAt: nowTs });
    return {
      status: 'updated',
      pcoPersonId,
      message: `Updated ${Object.keys(attributes).join(', ')} in Planning Center.`,
    };
  }

  /* ---- Not linked yet ---------------------------------------------------- */
  if (data.pcoPushPending !== true) {
    return { status: 'skipped', pcoPersonId: null, message: 'Student is not queued for Planning Center.' };
  }

  const existing = await findExistingPerson(client, config, firstName, lastName, grade);
  if (existing) {
    await ref.update({
      pcoPersonId: existing.id,
      pcoPushPending: false,
      pcoSyncedAt: nowTs,
      updatedAt: nowTs,
    });
    logger.info('Linked student to an existing Planning Center person', {
      studentId,
      pcoPersonId: existing.id,
    });
    return {
      status: 'updated',
      pcoPersonId: existing.id,
      message: 'Matched an existing person in Planning Center; no duplicate was created.',
    };
  }

  const created = await client.post<PcoPerson>('/people', {
    data: { type: 'Person', attributes: createAttributes(data) },
  });
  const createdId = created.data?.id ?? null;
  if (!createdId) {
    return { status: 'skipped', pcoPersonId: null, message: 'Planning Center returned no person id.' };
  }

  await ref.update({
    pcoPersonId: createdId,
    pcoPushPending: false,
    pcoSyncedAt: nowTs,
    updatedAt: nowTs,
  });
  return { status: 'created', pcoPersonId: createdId, message: 'Created the person in Planning Center.' };
}

/* -------------------------------------------------------------------------- */
/* Reconcile sweep                                                             */
/* -------------------------------------------------------------------------- */

export interface PushPendingResult {
  pushed: number;
  skipped: number;
  errors: number;
}

/**
 * Catches up every student the immediate push missed — the visitor added while
 * the church wifi was down, or one created while write-back was off.
 * Runs after the pull so a student Planning Center just told us about is
 * already linked and no longer pending.
 */
export async function pushPendingStudents(options: {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  now?: Date;
  logger?: FunctionLogger;
  limit?: number;
}): Promise<PushPendingResult> {
  const logger = options.logger ?? SILENT_LOGGER;
  const result: PushPendingResult = { pushed: 0, skipped: 0, errors: 0 };

  if (options.config.writeBack === 'off') return result;

  const snapshot = await options.db.collection(PATHS.students).get();
  const pending = snapshot.docs
    .filter((doc: DocumentSnapshotLike) => {
      const data = doc.data() ?? {};
      return data.pcoPushPending === true && !readString(data, 'pcoPersonId');
    })
    .slice(0, options.limit ?? 100);

  for (const doc of pending) {
    try {
      const outcome = await pushStudent({
        db: options.db,
        client: options.client,
        config: options.config,
        studentId: doc.id,
        now: options.now,
        logger,
      });
      if (outcome.status === 'skipped') result.skipped += 1;
      else result.pushed += 1;
    } catch (error) {
      result.errors += 1;
      const detail = error instanceof PcoApiError ? error.message : String(error);
      // One rejected person must not abandon the rest of the queue.
      logger.warn('Failed to push a student to Planning Center', { studentId: doc.id, detail });
    }
  }

  return result;
}
