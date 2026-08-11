/**
 * Re-creating a student's Planning Center person after theirs was deleted.
 *
 * The situation this exists for: an admin deletes (or merges away, with the
 * trail ending dead) the person behind a roster student. The student is then
 * frozen — `upstreamRecordMissing` on their document blocks check-ins at the rules
 * — and a leader has exactly two ways out: take them off the roster, or put a
 * person back in Planning Center. This is the second way.
 *
 * It is deliberately careful about what "re-create" means:
 *
 *  - If the person is actually still there, nothing is created — the flag was
 *    stale, and clearing it is the whole fix.
 *  - If the person was *merged* and the survivor lives, nothing is created —
 *    the student is grafted onto the survivor, the same move every read path
 *    makes. Creating a fresh record here would manufacture the duplicate the
 *    admin just cleaned up.
 *  - Only a genuinely dead trail creates, and **both branches search before
 *    they create**. A visitor document goes through `pushStudent`, which
 *    already matched, verified and linked; a `pco_…` document does the same
 *    search here. It used to not, and the gap was the dangerous one: the
 *    commonest reason a person is *deleted* rather than merged is an office
 *    admin clearing a duplicate by hand, which is exactly the case where
 *    another record of that child is sitting upstream — and the screen offering
 *    this button promises that a second copy will not be made.
 *  - A `pco_…` document holds no name (names are Planning Center's), so the
 *    caller must supply one; the membership then moves to a document named
 *    after the new person, pointered both ways, exactly like a merge graft —
 *    attendance history stays anchored to the old document.
 */
import { HELD_FOR_REVIEW_MESSAGE, isHeldForReview } from '../backends/pendingReview.js';
import type { PcoConfig } from '../config.js';
import { PATHS, SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import type { PcoClient } from './client.js';
import { followPersonLink, isPersonGoneError } from './personLink.js';
import { findExistingPeople, pushStudent } from './pushStudents.js';
import { pcoStudentId, personIdFromStudentId } from './roster.js';
import { graftMergedStudent } from './studentPerson.js';
import { PCO_TYPES, type PcoPerson } from './types.js';

export interface RecreateStudentOptions {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  studentId: string;
  /** Required for a `pco_…` student, whose document holds no name. */
  firstName?: string;
  lastName?: string;
  grade?: number;
  logger?: FunctionLogger;
}

export interface RecreateStudentResult {
  status:
    | 'no-student'
    | 'not-linked'
    | 'disabled'
    | 'still-there'
    | 'relinked'
    | 'needs-details'
    | 'recreated';
  message: string;
  /** The person the student now points at, where one exists. */
  pcoPersonId?: string;
  /** The student id to carry on with — changes when the membership migrated. */
  studentId?: string;
}

function result(
  status: RecreateStudentResult['status'],
  message: string,
  rest: Partial<RecreateStudentResult> = {},
): RecreateStudentResult {
  return { status, message, ...rest };
}

export async function recreateStudent(
  options: RecreateStudentOptions,
): Promise<RecreateStudentResult> {
  const { db, client, config, studentId } = options;
  const logger = options.logger ?? SILENT_LOGGER;

  if (config.writeBack === 'off') {
    return result(
      'disabled',
      'Creating people in Planning Center from Tally is switched off. A leader can turn write-back on in Settings, or re-create them in Planning Center directly.',
    );
  }

  const ref = db.doc(`${PATHS.students}/${studentId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return result('no-student', 'That student is not on the roster.');
  }
  const data = snapshot.data() ?? {};
  if (data.status === 'inactive') {
    return result('no-student', 'That student is not on the roster.');
  }
  /*
   * A held student would fall through to `not-linked` and be told "the ordinary
   * push will create them", which is exactly what will not happen — and the
   * visitor branch below clears the link and pushes, which is the one thing a
   * hold exists to prevent. See backends/pendingReview.ts.
   */
  if (isHeldForReview(data)) {
    return result('not-linked', HELD_FOR_REVIEW_MESSAGE);
  }

  const linkedId =
    personIdFromStudentId(studentId) ??
    (typeof data.pcoPersonId === 'string' && data.pcoPersonId ? data.pcoPersonId : null);
  if (!linkedId) {
    return result(
      'not-linked',
      'This student was never in Planning Center — there is nothing to re-create. The ordinary push will create them.',
    );
  }

  /* ---- Is the record actually gone? -------------------------------------- */
  try {
    const body = await client.get<PcoPerson>(`/people/${encodeURIComponent(linkedId)}`);
    const person = Array.isArray(body.data) ? body.data[0] : body.data;
    if (person?.id) {
      await ref.set({ upstreamRecordMissing: false }, { merge: true });
      return result(
        'still-there',
        'Planning Center still has this person — nothing needed re-creating. Check-ins are unfrozen.',
        { pcoPersonId: person.id, studentId },
      );
    }
  } catch (error) {
    if (!isPersonGoneError(error)) throw error;
    const link = await followPersonLink(client, linkedId, error);
    if (link.outcome === 'live') {
      // A merge with a living survivor is a relink, never a re-create.
      const grafted = await graftMergedStudent(db, studentId, link.personId);
      logger.info('Relinked a student to a merge survivor instead of re-creating', {
        studentId,
        pcoPersonId: link.personId,
      });
      return result(
        'relinked',
        'Their record was merged, not deleted — the student now points at the person Planning Center kept. Nothing was created.',
        { pcoPersonId: link.personId, studentId: grafted.studentId },
      );
    }
  }

  /* ---- Genuinely gone: create -------------------------------------------- */
  const isVisitorDocument = personIdFromStudentId(studentId) === null;

  if (isVisitorDocument) {
    // The document holds the name a human typed at the door; clearing the dead
    // link and queueing the push re-creates through the path that already
    // matches duplicates, verifies attributes, and links the document.
    await ref.set({ pcoPersonId: null, upstreamPushPending: true }, { merge: true });
    const pushed = await pushStudent({ db, client, config, studentId, logger });
    if (!pushed.pcoPersonId) {
      return result('no-student', pushed.message, { studentId });
    }
    await ref.set({ upstreamRecordMissing: false }, { merge: true });
    logger.info('Re-created a Planning Center person for a visitor student', {
      studentId,
      pcoPersonId: pushed.pcoPersonId,
    });
    return result(
      'recreated',
      'Planning Center has a record for them again. Check-ins are unfrozen.',
      { pcoPersonId: pushed.pcoPersonId, studentId },
    );
  }

  const firstName = options.firstName?.trim();
  const lastName = options.lastName?.trim();
  if (!firstName || !lastName) {
    // Names are Planning Center's and were never stored here, so once the
    // record died the name died with it. The caller has to say who this is.
    return result(
      'needs-details',
      "Tally doesn't hold this student's name — enter their name to re-create them in Planning Center.",
    );
  }

  /*
   * Search before creating, on the same terms the visitor push uses.
   *
   * The match is the strict one — first name, last name and grade, re-filtered
   * locally through the same accent- and punctuation-insensitive normalisation
   * that collapses duplicate visitors, with `child: true` required when there
   * is no grade to match on — so this cannot graft a child onto a same-named
   * adult volunteer. Several exact matches means the church database already
   * has duplicates, and linking to the oldest is strictly better than adding a
   * third.
   */
  const existing = await findExistingPeople(
    client,
    config,
    firstName,
    lastName,
    typeof options.grade === 'number' ? options.grade : null,
  );
  const match = existing[0] ?? null;
  if (match) {
    logger.info('Found an existing Planning Center person while re-creating; linked instead', {
      studentId,
      pcoPersonId: match.id,
      matches: existing.length,
    });
  }

  let createdId = match?.id ?? null;
  if (!createdId) {
    const created = await client.post<PcoPerson>('/people', {
      data: {
        type: PCO_TYPES.person,
        attributes: {
          first_name: firstName,
          last_name: lastName,
          child: true,
          ...(typeof options.grade === 'number' ? { grade: options.grade } : {}),
        },
      },
    });
    createdId = created.data?.id ?? null;
  }
  if (!createdId) {
    return result('no-student', 'Planning Center returned no person id for the new record.');
  }

  // The membership moves to a document named after the new person, pointered
  // both ways — the same shape as a merge graft, so attendance history stays
  // anchored and nothing renders under a dead id.
  const newStudentId = pcoStudentId(createdId);
  await db.doc(`${PATHS.students}/${newStudentId}`).set(
    {
      pcoPersonId: createdId,
      status: 'active',
      upstreamRecordMissing: false,
      recreatedFromStudentId: studentId,
      ...(data.addedToRosterAt !== undefined ? { addedToRosterAt: data.addedToRosterAt } : {}),
      ...(data.createdAt !== undefined ? { createdAt: data.createdAt } : {}),
    },
    { merge: true },
  );
  await ref.set({ status: 'inactive', recreatedAsStudentId: newStudentId }, { merge: true });

  logger.info(
    match
      ? 'Linked a roster student to a matching Planning Center person instead of creating one'
      : 'Re-created a Planning Center person for a roster student',
    { studentId, newStudentId, pcoPersonId: createdId, matched: match !== null },
  );
  return result(
    match ? 'relinked' : 'recreated',
    match
      ? 'Planning Center already had a record matching them, so Tally linked to it rather than adding a second. Check-ins are unfrozen.'
      : 'Planning Center has a record for them again. Check-ins are unfrozen.',
    { pcoPersonId: createdId, studentId: newStudentId },
  );
}
