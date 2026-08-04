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
import { followPersonLink, isPersonGoneError } from './personLink.js';
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

/**
 * The grade on a student document, or null when it holds none.
 *
 * Null is a real case rather than a malformed document: `students/pco_…` is a
 * membership, and Tally deliberately writes no grade onto one for somebody
 * Planning Center holds no grade for — the number on their roster row is where
 * the clamp landed, not a fact. This used to read `Number(data.grade ?? 0)`,
 * which turned "no grade" into grade zero — a number finite enough to satisfy
 * the guard that was supposed to catch a missing grade, and to be sent to
 * Planning Center as the grade of a person it was about to create.
 */
function readGrade(data: Record<string, unknown>): number | null {
  const value = data.grade;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
  const grade = readGrade(data);
  // Tally holds Planning Center's *display* name, `Benson “蔡秉洲”`. Planning
  // Center holds the two halves separately and composes them itself, so they go
  // back the way they came.
  const name = splitFirstName(readString(data, 'firstName') ?? '');
  return {
    first_name: name.firstName,
    ...(name.nickname ? { nickname: name.nickname } : {}),
    last_name: readString(data, 'lastName') ?? '',
    // Omitted rather than sent as a zero when the document holds none. A person
    // created upstream with `grade: 0` is a claim about a real child that
    // nobody made, and it is the church's database that keeps it.
    ...(grade === null ? {} : { grade }),
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
  const grade = readGrade(data);

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

  /*
   * The grade is compared against what Planning Center *holds*, in two steps,
   * because "holds nothing" and "holds a different number" are different cases:
   *
   *  - A blank upstream grade is repaired from the document. `mapped.grade`
   *    clamps a blank into the band, so comparing against it alone made a blank
   *    look like agreement whenever the student happened to be in the landing
   *    grade — and every student this function touches had a grade typed by a
   *    human at quick-add.
   *  - A *different* number upstream is left alone unless the clamped views
   *    disagree, exactly as before: Planning Center owns the field, and a
   *    correction made there must not be stomped by an old copy here.
   *
   * A document holding no grade says nothing about the grade and patches
   * nothing — which is the whole of Tally's opinion about somebody Planning
   * Center holds no grade for.
   */
  const heldGrade = (person.attributes ?? {}).grade;
  // `>= 0`, not `> 0`: kindergarten is grade zero, and the old guard dropped
  // every kindergartener's grade on the way upstream.
  if (grade !== null && grade >= 0) {
    if (heldGrade === null || heldGrade === undefined) {
      attributes.grade = grade;
      /*
       * A blank grade next to a missing child flag is the signature of a
       * create Planning Center silently thinned (see `repairThinnedCreate`):
       * the student is filed as a grade-less adult — absent from the church's
       * own children views, absent from the roster's `where[child]=true`
       * sweep, and offered as a *parent* candidate by the adult search. Both
       * dropped fields are restored together, and only together: a person who
       * has a grade upstream and `child: false` may be Planning Center's own
       * child-to-adult promotion of a graduated senior, which is not Tally's
       * to reverse.
       */
      if (person.attributes?.child !== true) attributes.child = true;
    } else if (grade !== mapped.grade) attributes.grade = grade;
  }

  /*
   * Allergies are added by a push and never cleared by one, which is not the
   * symmetry the other fields have and is deliberate.
   *
   * Tally has kept no copy of this since the mirror was removed, so on every
   * linked student the document simply has no allergy note — and "Tally holds
   * none" read as "there are none" would send `medical_notes: ''` and wipe a
   * peanut allergy out of the church's database on the first reconcile. A note
   * that genuinely should go is removed in Planning Center, or from the student
   * editor, where somebody is looking at the value they are deleting.
   */
  const allergies = readString(data, 'allergies');
  if (allergies && allergies !== mapped.allergies) attributes.medical_notes = allergies;

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
  const grade = readGrade(data);
  if (!firstName || !lastName) {
    return { status: 'skipped', pcoPersonId, message: 'Student is missing a name.' };
  }

  /* ---- Already linked ---------------------------------------------------- */
  if (pcoPersonId) {
    if (config.writeBack !== 'full') {
      return { status: 'skipped', pcoPersonId, message: 'Already linked to Planning Center.' };
    }

    /*
     * The linked person may have been merged away since the push linked them —
     * an admin tidying duplicates is exactly who generates pushed visitors
     * with stale links. The mirror's 410 names the survivor; follow it, keep
     * the document pointed at somebody real, and sync against them. A trail
     * that ends dead is reported as a skip a leader can act on, not a push
     * that fails identically for ever.
     */
    let linkedId = pcoPersonId;
    let person;
    try {
      person = await client.get<PcoPerson>(`/people/${encodeURIComponent(linkedId)}`);
    } catch (error) {
      if (!isPersonGoneError(error)) throw error;
      const link = await followPersonLink(client, linkedId, error);
      if (link.outcome === 'gone') {
        return {
          status: 'skipped',
          pcoPersonId,
          message:
            'Planning Center no longer has this person — deleted or merged away there. ' +
            'Take the student off the roster, or clear the link to push them as new.',
        };
      }
      linkedId = link.personId;
      person = { data: link.person };
      await ref.update({
        pcoPersonId: linkedId,
        upstreamBackend: 'pco',
        upstreamPersonId: linkedId,
        updatedAt: nowTs,
      });
      logger.info('Followed a Planning Center merge while pushing', {
        studentId,
        pcoPersonId: linkedId,
        mergedFrom: pcoPersonId,
      });
    }
    const attributes = driftedAttributes(data, person.data, config);
    if (Object.keys(attributes).length === 0) {
      return { status: 'skipped', pcoPersonId: linkedId, message: 'Planning Center is already up to date.' };
    }

    await client.patch(`/people/${encodeURIComponent(linkedId)}`, {
      data: { type: 'Person', id: linkedId, attributes },
    });
    await ref.update({ pcoSyncedAt: nowTs, pcoPushPending: false, updatedAt: nowTs });
    return {
      status: 'updated',
      pcoPersonId: linkedId,
      message: `Updated ${Object.keys(attributes).join(', ')} in Planning Center.`,
    };
  }

  /* ---- Not linked yet ---------------------------------------------------- */
  if (data.pcoPushPending !== true) {
    return { status: 'skipped', pcoPersonId: null, message: 'Student is not queued for Planning Center.' };
  }

  /*
   * A create needs a real grade; an update does not.
   *
   * The duplicate check below matches on first name, last name *and* grade, and
   * the person this is about to add is filed as a child of that grade in the
   * church's permanent database. Neither can be done from a number nobody
   * supplied. Every student queued for a create has one — it is typed at
   * quick-add — so this is a refusal rather than a fallback: it is the linked
   * path above that has to cope with a document holding no grade, and it does,
   * by patching nothing.
   */
  if (grade === null) {
    return { status: 'skipped', pcoPersonId: null, message: 'Student is missing a grade.' };
  }

  const existing = await findExistingPerson(client, config, firstName, lastName, grade);
  if (existing) {
    await ref.update({
      pcoPersonId: existing.id,
      upstreamBackend: 'pco',
      upstreamPersonId: existing.id,
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

  const wanted = createAttributes(data);
  const created = await client.post<PcoPerson>('/people', {
    data: { type: 'Person', attributes: wanted },
  });
  const createdId = created.data?.id ?? null;
  if (!createdId) {
    return { status: 'skipped', pcoPersonId: null, message: 'Planning Center returned no person id.' };
  }

  await repairThinnedCreate(client, createdId, wanted, created.data, logger);

  await ref.update({
    pcoPersonId: createdId,
    upstreamBackend: 'pco',
    upstreamPersonId: createdId,
    pcoPushPending: false,
    pcoSyncedAt: nowTs,
    updatedAt: nowTs,
  });
  return { status: 'created', pcoPersonId: createdId, message: 'Created the person in Planning Center.' };
}

/**
 * Re-sends whatever the create silently lost.
 *
 * Planning Center can answer a write with success and keep less than it was
 * sent: measured on a live organization, a `POST /people` carrying
 * `child: true` and a numeric `grade` returned `201` — and the person it
 * created had `child: false` and no grade at all. The same API demonstrably
 * holds both fields when they arrive by `PATCH`. A student filed that way is a
 * grade-less *adult* in the church's permanent database: invisible to its
 * children views, invisible to the roster's `where[child]=true` sweep, never
 * again matched by the duplicate check above (which requires the exact grade),
 * and offered as a parent candidate by the adult search.
 *
 * So the `201` body is read as a report, not a receipt, and the difference is
 * sent again the one way that is known to stick. When the create kept
 * everything — the response echoes every attribute — this costs nothing.
 */
async function repairThinnedCreate(
  client: PcoClient,
  personId: string,
  wanted: Record<string, unknown>,
  held: PcoPerson | undefined,
  logger: FunctionLogger,
): Promise<void> {
  const kept = held?.attributes ?? {};
  const dropped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(wanted)) {
    // Strict equality is right for everything sent: names and notes are
    // strings, `child` a boolean, `grade` a number — and `undefined` (the
    // response not carrying the attribute at all) must count as dropped.
    if ((kept as Record<string, unknown>)[name] !== value) dropped[name] = value;
  }
  if (Object.keys(dropped).length === 0) return;

  await client.patch(`/people/${encodeURIComponent(personId)}`, {
    data: { type: 'Person', id: personId, attributes: dropped },
  });
  // Field names only, never values — this lands in a log an admin may read.
  logger.warn('Planning Center dropped attributes from a create; sent them again as a patch', {
    pcoPersonId: personId,
    repaired: Object.keys(dropped),
  });
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
