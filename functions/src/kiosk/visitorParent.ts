/**
 * The parent a counselor was told about at the door.
 *
 * Quick-add asks for three things — first name, last name, grade — and that is
 * still the whole of the fast path. But a leader who has just added somebody
 * else's child is often standing next to the adult who brought them, and until
 * now the only thing Tally could do with "07 — sorry, 555-0134, I'm Dara's
 * mum" was nothing: the number went on the back of a hand, and the profile
 * stayed in the incomplete list until somebody rang round on Tuesday.
 *
 * It cannot go on the student. `noMirroredPersonalData` in `firestore.rules`
 * forbids a parent's name, number or email on a student document, deliberately
 * and permanently — a door volunteer's phone must not receive a screenful of
 * parents' phone numbers, and the way that is guaranteed is that nothing it
 * renders holds one. So the number goes exactly where the kiosk's own guardian
 * goes: onto a registration record, which is functions-only in both
 * directions, read through a core-team callable, deleted the moment somebody
 * decides, and swept at thirty days whether or not anybody did.
 *
 * ## Why it is not written straight upstream
 *
 * Because the write nobody can take back is not "record a phone number", it is
 * "decide which David Kim this is". `addParent` — the core team's own path for
 * this — asks that question out loud, shows the adults the church already has
 * by that name, and makes a person answer it; creating a duplicate parent is a
 * merge somebody does by hand, and attaching a child to the wrong household
 * shows one family another family's number. That question cannot be asked at a
 * door with a queue behind it, and `addParent` is core team only for the same
 * reason. So the door *records* and the Review screen *decides*, which is the
 * shape the kiosk already has.
 *
 * ## What is different from a kiosk registration
 *
 * The child. A family at the lobby screen is a stranger's typing, so their
 * children are held (`pendingReview: true`) until somebody looks. A quick-added
 * visitor is a member of the team's typing, standing next to the child, and
 * they are on the roster and queued upstream before this module is called at
 * all. Nothing here holds them, nothing here pushes them, and a counselor who
 * types no parent details never reaches this file: the fast path is untouched,
 * to the keystroke.
 *
 * It lives beside the kiosk's registration code rather than in a folder of its
 * own because the record it writes, the callable that lists it and the screen
 * that clears it are all here, and a second module that knew this document's
 * shape would be a second module to keep in step with it.
 */
import { Timestamp } from 'firebase-admin/firestore';
import {
  PATHS,
  SILENT_LOGGER,
  type FirestoreLike,
  type FunctionLogger,
} from '../firestore.js';
import { patchPhonesNow, recordPendingLast4 } from './phoneIndex.js';
import { bumpPulse } from './pulse.js';
import {
  REGISTRATIONS_COLLECTION,
  RegistrationInputError,
  findRosterDuplicates,
  parseName,
  parseRegistrationPhone,
  sweepRegistrations,
  type RegistrationChild,
  type RegistrationGuardian,
} from './registration.js';

function refuse(message: string): never {
  throw new RegistrationInputError(message);
}

export interface ParsedVisitorParent {
  /** The student the counselor has just quick-added. */
  studentId: string;
  /**
   * Minted once per press of Save and re-sent on a retry, exactly as the
   * wizard's is: the record is claimed with `create()`, so a call whose answer
   * was lost cannot leave a second copy of one family's number behind.
   */
  registrationId: string;
  guardian: RegistrationGuardian;
  /** The gathering they were checked into, for the reviewer's context only. */
  eventId: string | null;
}

/**
 * The request, checked before anything is read from the database.
 *
 * The same name and phone rules the wizard uses, and for the same reasons:
 * digits in a name are somebody answering the wrong question, and a repdigit
 * phone number is somebody getting past a field they did not want to fill in.
 * A door is not a lower standard than a lobby.
 */
export function parseRecordVisitorParentRequest(data: unknown): ParsedVisitorParent {
  const body = (data ?? {}) as Record<string, unknown>;

  const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(studentId)) refuse('studentId is required.');

  const registrationId =
    typeof body.registrationId === 'string' ? body.registrationId.trim() : '';
  if (!/^[A-Za-z0-9-]{20,64}$/.test(registrationId)) refuse('registrationId is required.');

  const rawGuardian = (body.guardian ?? {}) as Record<string, unknown>;

  return {
    studentId,
    registrationId,
    guardian: {
      firstName: parseName(rawGuardian.firstName, "The parent's first name"),
      lastName: parseName(rawGuardian.lastName, "The parent's last name"),
      phone: parseRegistrationPhone(rawGuardian.phone),
    },
    eventId: typeof body.eventId === 'string' && body.eventId.trim().length > 0
      ? body.eventId.trim()
      : null,
  };
}

export interface RecordVisitorParentResult {
  status: 'recorded' | 'already-recorded';
  /** The digits the family can type at the lobby kiosk from now on. */
  last4: string;
  message: string;
}

export interface RecordVisitorParentOptions {
  db: FirestoreLike;
  request: ParsedVisitorParent;
  /** The counselor who typed it. */
  uid: string;
  now?: Date;
  logger?: FunctionLogger;
}

/**
 * Puts one parent in front of a reviewer, and makes their number work at the
 * kiosk on the way past.
 *
 * The child is read here rather than taken from the request — their name is on
 * the review card and the reviewer decides a household by it, so it had better
 * be the name on the roster and not the name a client asserted a second time.
 * A held child is refused outright: they already have a registration record of
 * their own with an adult on it, and a second record for one child is two
 * households waiting to happen.
 */
export async function recordVisitorParent(
  options: RecordVisitorParentOptions,
): Promise<RecordVisitorParentResult> {
  const { db, request, uid } = options;
  const now = options.now ?? new Date();
  const logger = options.logger ?? SILENT_LOGGER;

  const snapshot = await db.doc(`${PATHS.students}/${request.studentId}`).get();
  if (!snapshot.exists) refuse('That student is no longer on the roster.');
  const student = snapshot.data() ?? {};
  if (student.status === 'inactive') refuse('That student is no longer on the roster.');
  if (student.pendingReview === true) {
    refuse('That student is already waiting to be reviewed, with a parent on their record.');
  }

  const child: RegistrationChild = {
    firstName: typeof student.firstName === 'string' ? student.firstName : '',
    lastName: typeof student.lastName === 'string' ? student.lastName : '',
    grade: typeof student.grade === 'number' ? student.grade : null,
  };

  const last4 = request.guardian.phone.slice(-4);
  const ref = db.doc(`${REGISTRATIONS_COLLECTION}/${request.registrationId}`);

  /*
   * Whether the child is actually on tonight's register, read rather than
   * asserted. The reviewer's card says "at Friday Fellowship", and a card that
   * says so about a gathering the child was never marked at is a card that
   * misleads about the one fact a reviewer might use to place the family.
   */
  let checkedIn = false;
  if (request.eventId !== null) {
    try {
      const attendance = await db
        .doc(`events/${request.eventId}/attendance/${request.studentId}`)
        .get();
      checkedIn = attendance.exists;
    } catch (error) {
      logger.warn('Could not confirm the check-in behind a recorded parent', {
        studentId: request.studentId,
        error: String(error),
      });
    }
  }

  try {
    await ref.create({
      /*
       * Complete on arrival, unlike the wizard's. A registration is `pending`
       * while its own batch of children is still being written; here the child
       * was written by the counselor's own device before this call was made,
       * and the only thing outstanding is the decision a person makes on the
       * Review screen.
       */
      status: 'complete',
      source: 'counselor',
      eventId: request.eventId,
      studentIds: [request.studentId],
      childCount: 1,
      last4,
      checkedIn,
      createdAt: Timestamp.fromDate(now),
      createdBy: uid,
      guardian: request.guardian,
      children: [child],
      allergies: [null],
      anchorStudentIds: [],
      possibleDuplicateOf: {},
      lastError: null,
      lastErrorKind: null,
      completedAt: Timestamp.fromDate(now),
    });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code !== 6 && code !== 'already-exists' && code !== 'ALREADY_EXISTS') throw error;
    // The same press, arriving twice. Answering it is the whole reason the
    // client mints the id rather than the server.
    return {
      status: 'already-recorded',
      last4,
      message: 'That parent is already waiting to be reviewed.',
    };
  }

  /* ---- What a reviewer will want to know ---------------------------------- */

  /*
   * The same suspicion the kiosk records: a child of this name already on the
   * roster. It matters more here, not less — a counselor adding a visitor has
   * just searched the roster and not found them, and the commonest reason for
   * that is a spelling, which is exactly the case a reviewer should see before
   * they attach a household to the new row.
   */
  try {
    const possibleDuplicateOf = await findRosterDuplicates(db, [child], {
      excludeStudentIds: [request.studentId],
    });
    if (Object.keys(possibleDuplicateOf).length > 0) {
      await ref.set({ possibleDuplicateOf }, { merge: true });
    }
  } catch (error) {
    logger.warn('Could not scan for duplicates behind a recorded parent', {
      registrationId: request.registrationId,
      error: String(error),
    });
  }

  /* ---- Findable by phone, now --------------------------------------------- */

  /*
   * The immediate, visible payoff of having asked at all, and it lands before
   * anybody reviews anything: the family can find their own child at the lobby
   * kiosk next Sunday by typing the last four digits of the number they just
   * read out. Best effort, like the wizard's — the nightly rebuild folds the
   * overlay in either way, and a missed patch costs nothing that was promised.
   */
  try {
    await recordPendingLast4(
      db,
      { registrationId: request.registrationId, last4, studentIds: [request.studentId] },
      now,
    );
    await patchPhonesNow(db, last4, [request.studentId]);
    await bumpPulse(db, ['phones'], now, { logger });
  } catch (error) {
    logger.warn('Could not patch the kiosk phone index for a recorded parent', {
      registrationId: request.registrationId,
      error: String(error),
    });
  }

  await sweepRegistrations(db, now);

  // The child and the counselor, by id. The parent's name and number are on the
  // document this line is about; they are not going into a log as well.
  logger.info('Recorded a parent contact taken at a door; held for review', {
    registrationId: request.registrationId,
    studentId: request.studentId,
    checkedIn,
  });

  return {
    status: 'recorded',
    last4,
    message: 'Parent contact saved for the core team to add.',
  };
}
