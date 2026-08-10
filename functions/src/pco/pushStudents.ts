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
import { ABSOLUTE_MIN_GRADE, type PcoConfig } from '../config.js';
import { PcoApiError, type PcoClient } from '../pco/client.js';
import { followPersonLink, isPersonGoneError } from './personLink.js';
import {
  compareIds,
  mapPersonToStudent,
  nameGradeKey,
  splitFirstName,
} from '../pco/mapping.js';
import type { PcoPerson } from '../pco/types.js';
import { HELD_FOR_REVIEW_MESSAGE, isHeldForReview } from '../backends/pendingReview.js';
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

/**
 * Somebody the backend already has who could be this child, offered rather than
 * acted on.
 *
 * The child-side twin of `AdultCandidate`, and deliberately the same shape of
 * thing: `wouldMatch` is a fact about what an unattended push would do with
 * this list, not advice about what a reviewer should do with it. Backend-
 * independent — Attendees answers with these too — so the id is named for what
 * it is rather than for Planning Center.
 *
 * Mirrors `StudentCandidate` in src/services/functions.ts.
 */
export interface StudentCandidate {
  personId: string;
  name: string;
  grade: number | null;
  /** The one `pickExistingPerson` would link to if nobody were asked. */
  wouldMatch: boolean;
}

export interface PushStudentOptions {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  studentId: string;
  /**
   * The person a reviewer said this child already is.
   *
   * Set, it *is* the answer: no search runs, and a person the backend no longer
   * has is reported rather than quietly replaced with a fresh create. The
   * reviewer named *that* record, and inventing a different one is not a
   * smaller version of doing what they asked. Same contract as `createFamily`'s
   * `parentPersonId`.
   */
  personId?: string | null;
  /** A reviewer who saw the candidates and said this child is new. */
  createNew?: boolean;
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
 * Everyone this student could obviously already be, oldest id first.
 *
 * "Obviously" is deliberately strict: first name, last name *and* grade must all
 * match. `where[search_name]` is fuzzy on the server, so the result is filtered
 * again locally through the same normalisation the visitor-collapse uses.
 *
 * The *list*, rather than the winner, because two callers want different things
 * from it. A push with nobody watching takes the first and gets on with it —
 * see `pickExistingPerson`, which is the whole of the old behaviour. A reviewer
 * looking at a card wants to know there were two, which is the fact this
 * function used to compute and discard on its last line.
 */
export async function findExistingPeople(
  client: PcoClient,
  config: PcoConfig,
  firstName: string,
  lastName: string,
  grade: number | null,
): Promise<PcoPerson[]> {
  // The server's fuzzy `search_name` has never seen `Benson “蔡秉洲” Tsai` — it
  // indexes the halves — so it is asked for the plain name and the composite is
  // matched locally below.
  const plainFirstName = splitFirstName(firstName).firstName;
  const body = await client.get<PcoPerson[]>('/people', {
    // `where[grade]` takes one exact value and has no "is blank" form, so a
    // grade-less student is searched by name and filtered below.
    where: { search_name: `${plainFirstName} ${lastName}`, ...(grade === null ? {} : { grade }) },
    per_page: SEARCH_PAGE_SIZE,
  });

  const wanted = nameGradeKey(firstName, lastName, grade);
  const matches = (Array.isArray(body.data) ? body.data : []).filter((person) => {
    const held = person.attributes?.grade;

    if (grade === null) {
      /*
       * Name alone is all there is to match on, so `child` has to carry the
       * rest of the weight.
       *
       * The grade-less population upstream is two groups at once: children too
       * young for a grade, and every adult volunteer and leader. Matching a
       * nursery child onto a same-named adult would file a three-year-old as
       * that volunteer, silently, in the church's permanent database — so a
       * candidate has to be a child *and* hold no grade, and anything else is
       * left alone even at the cost of a duplicate somebody can merge later.
       */
      if (held !== null && held !== undefined) return false;
      if (person.attributes?.child !== true) return false;
    } else if (held !== grade) {
      // The *raw* grade, not the clamped one: a person whose grade is blank
      // would otherwise be normalised into the band and match by accident.
      return false;
    }

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

  return matches.sort((a, b) => compareIds(a.id, b.id));
}

/**
 * The one an unattended push links to, and a line in the log when it guessed.
 *
 * Several exact matches means the church database already has duplicates, and
 * adding a third is strictly worse than picking the oldest deterministically.
 * That reasoning holds precisely while nobody is there to ask — so the pick is
 * kept, and the fact that a pick was *made* stops being invisible. A reviewer
 * on the Review screen is asked instead; see `findStudentCandidates`.
 */
async function pickExistingPerson(
  client: PcoClient,
  config: PcoConfig,
  firstName: string,
  lastName: string,
  grade: number | null,
  logger: FunctionLogger,
): Promise<PcoPerson | null> {
  const matches = await findExistingPeople(client, config, firstName, lastName, grade);
  if (matches.length > 1) {
    logger.info('Several people in Planning Center match this student; linked the oldest', {
      matches: matches.length,
      chosen: matches[0]!.id,
    });
  }
  return matches[0] ?? null;
}

/**
 * The same search, answering with everyone it found instead of choosing.
 *
 * `pickExistingPerson` above is for a push with nobody watching, and its rule —
 * take the oldest, a duplicate is better than a third — is the right rule for
 * exactly that. This one is for the Review screen, where somebody is looking at
 * the card and can answer the question the rule is standing in for.
 *
 * The list is a list to show somebody, never a match to act on: `wouldMatch`
 * marks what would have happened unasked, so the card can pre-select it and say
 * so, and the reviewer can disagree.
 */
export async function findStudentCandidates(options: {
  client: PcoClient;
  config: PcoConfig;
  firstName: string;
  lastName: string;
  grade: number | null;
}): Promise<StudentCandidate[]> {
  const { client, config, grade } = options;
  const firstName = (options.firstName ?? '').trim();
  const lastName = (options.lastName ?? '').trim();
  if (!firstName && !lastName) return [];

  const matches = await findExistingPeople(client, config, firstName, lastName, grade);
  return matches.map((person, index) => {
    const mapped = mapPersonToStudent(person, {
      minGrade: config.minGrade,
      maxGrade: config.maxGrade,
    });
    const held = person.attributes?.grade;
    return {
      personId: person.id,
      name: `${mapped.firstName} ${mapped.lastName}`.trim(),
      // The *raw* grade, like the matcher compares on — the clamped one is
      // where the band landed, not a fact about the child.
      grade: typeof held === 'number' && Number.isFinite(held) ? held : null,
      wouldMatch: index === 0,
    };
  });
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
  /*
   * `>= ABSOLUTE_MIN_GRADE`, which is `-1`. It was `> 0` once and dropped every
   * kindergartener's grade on the way upstream; then `>= 0`, which did the same
   * to every Pre-K child. Both were the same mistake — a truthiness guard
   * standing in for "is there a grade here", on a scale whose bottom two values
   * are `0` and `-1`. "Is there one" is `grade !== null`, and it is the only
   * question this needs to ask; the bound is here to refuse a number the
   * upstream field cannot mean at all.
   */
  if (grade !== null && grade >= ABSOLUTE_MIN_GRADE) {
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

  // Before write-back, before names, before anything: a held student is not a
  // student anybody has agreed to create. See backends/pendingReview.ts.
  if (isHeldForReview(data)) {
    return { status: 'skipped', pcoPersonId, message: HELD_FOR_REVIEW_MESSAGE };
  }

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
    await ref.update({ pcoSyncedAt: nowTs, upstreamPushPending: false, updatedAt: nowTs });
    return {
      status: 'updated',
      pcoPersonId: linkedId,
      message: `Updated ${Object.keys(attributes).join(', ')} in Planning Center.`,
    };
  }

  /* ---- Not linked yet ---------------------------------------------------- */
  if (data.upstreamPushPending !== true) {
    return { status: 'skipped', pcoPersonId: null, message: 'Student is not queued for Planning Center.' };
  }

  /*
   * A create no longer needs a grade.
   *
   * It used to refuse one, on the reasoning that every student queued for a
   * create had a grade typed at quick-add. A nursery does not: a child too
   * young for a grade has none to type, and the refusal left them queued on
   * `upstreamPushPending` for ever — a queue that never drains rather than a visible
   * failure. `createAttributes` omits the field rather than sending a zero, and
   * the duplicate check above leans on `child` instead.
   */
  /*
   * A reviewer's answer, where there is one.
   *
   * Read back live rather than trusted, and refused rather than substituted —
   * the same posture as `createFamily`'s `loadChosenParent`, for the same
   * reason. The id came off a screen that may have been open while somebody
   * merged or deleted that person upstream, and quietly creating a fresh child
   * of the same name instead is not a smaller version of what was asked: it is
   * the duplicate the reviewer was answering the question to prevent.
   *
   * `createNew` is the other half — somebody saw the candidates and said none
   * of them is this child — and it means the search is not run at all.
   */
  const chosenId = (options.personId ?? '').trim();
  let existing: PcoPerson | null = null;
  if (chosenId) {
    try {
      const chosen = await client.get<PcoPerson>(`/people/${encodeURIComponent(chosenId)}`);
      existing = Array.isArray(chosen.data) ? (chosen.data[0] ?? null) : (chosen.data ?? null);
    } catch (error) {
      if (!isPersonGoneError(error)) throw error;
      existing = null;
    }
    if (!existing) {
      return {
        status: 'skipped',
        pcoPersonId: null,
        message:
          'Planning Center no longer has the person that was chosen for this child — they may have been merged or deleted. Review the family again.',
      };
    }
  } else if (options.createNew !== true) {
    existing = await pickExistingPerson(client, config, firstName, lastName, grade, logger);
  }

  if (existing) {
    await ref.update({
      pcoPersonId: existing.id,
      upstreamBackend: 'pco',
      upstreamPersonId: existing.id,
      upstreamPushPending: false,
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
    upstreamPushPending: false,
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
      // Filtered here as well as refused inside `pushStudent`, so that a held
      // family does not count as a skip against the limit and read back as a
      // queue somebody needs to unstick.
      //
      // `upstreamPersonId` is excluded alongside `pcoPersonId` — the Attendees
      // sweep has always checked both and this one checked only the legacy
      // field, so a student the other backend holds was, on paper, a candidate
      // for a second person over here. Reachable only through a stale
      // `upstreamPushPending`, but the asymmetry was the bug, not the odds.
      return (
        data.upstreamPushPending === true &&
        !readString(data, 'pcoPersonId') &&
        !readString(data, 'upstreamPersonId') &&
        !isHeldForReview(data)
      );
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
