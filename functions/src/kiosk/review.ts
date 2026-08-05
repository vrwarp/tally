/**
 * What happens to a self-registered family after the event.
 *
 * The lobby kiosk records and this decides. A family who registered themselves
 * is on Tally's roster, checked in, wearing a sticker — and held
 * (`backends/pendingReview.ts`), so nothing about them has reached Planning
 * Center or Attendees. This module is the other end of that: a core-team screen
 * on a Tuesday, with the form the family filled in, the roster rows that share
 * a name with their children, and three buttons.
 *
 * ## Approving is a replay, and the order matters
 *
 * Every child first, then **one** call to `createFamily` for the whole set.
 * Approving child-by-child would mint one household per sibling, which is the
 * exact failure `createFamily` was written to avoid — and the children have to
 * exist upstream before the household can hold them, so the two halves cannot
 * be interleaved either.
 *
 * The hold is cleared *before* the push rather than after it. That looks like
 * the risky order and is the safe one: a push that fails after approval leaves
 * a student who is queued in the ordinary way, which `pushPendingVisitors`
 * already sweeps and a leader already understands. Clearing afterwards would
 * mean a network blip left the family both approved and invisible, with the
 * only record of that in a log.
 *
 * ## The record's lifetime
 *
 * The registration document is the only place the guardian's name and phone
 * exist — `firestore.rules` forbids them on a student, deliberately — so it is
 * deleted exactly when it stops being able to help: when the guardian reached
 * the backend, or when there was never anywhere for them to go (write-back off,
 * no backend configured), or when a reviewer discards the family outright. An
 * approval whose family write *failed* keeps the record, with the reason on it,
 * so pressing the button again can still finish the job.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { BackendRegistry } from '../backends/registry.js';
import type { CreateFamilyResult } from '../backends/types.js';
import { PATHS, SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import {
  REGISTRATIONS_COLLECTION,
  REGISTRATION_DOC_TTL_MS,
  readRegistration,
  type RegistrationChild,
} from './registration.js';

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

/** A roster row a reviewer might be looking at, named enough to judge by. */
export interface ReviewStudentSummary {
  studentId: string;
  firstName: string;
  lastName: string;
  grade: number | null;
  /** Absent for a student whose name lives in a backend rather than here. */
  known: boolean;
  status: 'active' | 'inactive';
}

/** One child of one registration, as typed and as it landed. */
export interface PendingRegistrationChild extends RegistrationChild {
  /** Null when the batch never committed — a registration that died mid-write. */
  studentId: string | null;
  /** Whether the student document is still held. */
  pendingReview: boolean;
  /** Set once a reviewer folded this child into a row that was already there. */
  mergedIntoStudentId: string | null;
  /** Only ever set from the QR form; the kiosk does not ask. */
  allergies: string | null;
  /** Active students who already have this name. Suspicion, not a verdict. */
  possibleDuplicates: ReviewStudentSummary[];
}

export interface PendingRegistration {
  registrationId: string;
  source: 'kiosk' | 'qr';
  /** The gathering they were checked into, when there was one. */
  eventId: string | null;
  registeredAt: number | null;
  /** Milliseconds until the sweep deletes this record. Negative means overdue. */
  expiresInMs: number | null;
  guardian: { firstName: string; lastName: string; phone: string } | null;
  /** The four digits the family types at the kiosk. */
  last4: string;
  children: PendingRegistrationChild[];
  /** Siblings the family named, already verified as real active students. */
  anchors: ReviewStudentSummary[];
  /** Whether every child has already been approved and pushed. */
  settled: boolean;
  /** Why the last approval did not finish, if one did not. */
  lastError: string | null;
}

async function summarise(db: FirestoreLike, studentId: string): Promise<ReviewStudentSummary> {
  const snapshot = await db.doc(`${PATHS.students}/${studentId}`).get();
  const data = snapshot.exists ? (snapshot.data() ?? {}) : {};
  const firstName = typeof data.firstName === 'string' ? data.firstName : '';
  const lastName = typeof data.lastName === 'string' ? data.lastName : '';
  return {
    studentId,
    firstName,
    lastName,
    grade: typeof data.grade === 'number' ? data.grade : null,
    /*
     * A student linked to a backend keeps their name there, not here — so an
     * empty name is not a broken row, it is a row whose name this callable
     * deliberately does not fetch. Saying so lets the screen render "a student
     * on the roster" rather than an empty line, without this module growing a
     * dependency on every backend to answer a duplicate hint.
     */
    known: firstName.length > 0 || lastName.length > 0,
    status: data.status === 'inactive' ? 'inactive' : 'active',
  };
}

/**
 * Every family waiting to be reviewed, newest first.
 *
 * Reads the whole collection, which is bounded by how many families register in
 * a month — the same reasoning as the sweep it shares a TTL with. Registrations
 * whose children have all been pushed already are still returned, marked
 * `settled`, because the record surviving means something did not finish and
 * hiding it would hide exactly that.
 */
export async function listPendingRegistrations(
  db: FirestoreLike,
  now: Date = new Date(),
): Promise<PendingRegistration[]> {
  const snapshot = await db.collection(REGISTRATIONS_COLLECTION).get();
  const rows: PendingRegistration[] = [];

  for (const doc of snapshot.docs) {
    const record = readRegistration(doc.data() ?? {});

    const students = await Promise.all(
      record.studentIds.map(async (studentId) => {
        const held = await db.doc(`${PATHS.students}/${studentId}`).get();
        return { studentId, exists: held.exists, data: held.data() ?? {} };
      }),
    );

    const children: PendingRegistrationChild[] = await Promise.all(
      record.children.map(async (child, index) => {
        const student = students[index];
        return {
          ...child,
          studentId: student?.exists ? student.studentId : null,
          pendingReview: student?.data.pendingReview === true,
          mergedIntoStudentId:
            typeof student?.data.mergedIntoStudentId === 'string'
              ? student.data.mergedIntoStudentId
              : null,
          allergies: record.allergies[index] ?? null,
          possibleDuplicates: await Promise.all(
            (record.possibleDuplicateOf[String(index)] ?? []).map((id) => summarise(db, id)),
          ),
        };
      }),
    );

    const createdAt = record.createdAt;
    rows.push({
      registrationId: doc.id,
      source: record.source,
      eventId: record.eventId,
      registeredAt: createdAt?.getTime() ?? null,
      expiresInMs:
        createdAt === null
          ? null
          : createdAt.getTime() + REGISTRATION_DOC_TTL_MS - now.getTime(),
      guardian: record.guardian,
      last4: record.last4,
      children,
      anchors: await Promise.all(record.anchorStudentIds.map((id) => summarise(db, id))),
      settled: children.length > 0 && children.every((child) => !child.pendingReview),
      lastError: record.lastError,
    });
  }

  return rows.sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
}

/* -------------------------------------------------------------------------- */
/* Approving                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The student a document stands for after any merges — itself, usually.
 *
 * Bounded rather than recursive-until-done: a pointer cycle would otherwise
 * hang a callable, and four hops is more merges than one registration's child
 * will ever be through. Null when the trail ends somewhere inactive, which is
 * a row nobody meant to keep.
 */
async function followMerges(db: FirestoreLike, studentId: string): Promise<string | null> {
  let current = studentId;
  for (let hop = 0; hop < 4; hop += 1) {
    const snapshot = await db.doc(`${PATHS.students}/${current}`).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? {};
    const next = data.mergedIntoStudentId;
    if (typeof next !== 'string' || next.length === 0) {
      return data.status === 'inactive' ? null : current;
    }
    current = next;
  }
  return null;
}

export interface ApproveRegistrationResult {
  status: 'approved' | 'partial' | 'not-found';
  /** Children that reached the backend on this attempt or an earlier one. */
  pushed: number;
  /** Children the backend refused or could not take. */
  failed: number;
  guardian: CreateFamilyResult['status'] | 'skipped';
  message: string;
}

/**
 * Releases one registration into the church's people database.
 *
 * Idempotent by construction: clearing a hold that is already clear is a no-op,
 * `pushStudent` skips a child it has already linked, and `createFamily` refuses
 * to invent a second adult for a family that has one. Pressing the button twice
 * is a supported way to finish a job that half-finished.
 */
export async function approveRegistration(options: {
  db: FirestoreLike;
  registry: BackendRegistry;
  registrationId: string;
  uid: string;
  now?: Date;
  logger?: FunctionLogger;
}): Promise<ApproveRegistrationResult> {
  const { db, registry, registrationId, uid } = options;
  const now = options.now ?? new Date();
  const logger = options.logger ?? SILENT_LOGGER;

  const ref = db.doc(`${REGISTRATIONS_COLLECTION}/${registrationId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return {
      status: 'not-found',
      pushed: 0,
      failed: 0,
      guardian: 'skipped',
      message: 'That registration has already been dealt with.',
    };
  }
  const record = readRegistration(snapshot.data() ?? {});

  /* ---- The hold comes off first ------------------------------------------- */

  const at = Timestamp.fromDate(now);
  const live: string[] = [];
  for (const studentId of record.studentIds) {
    const student = await db.doc(`${PATHS.students}/${studentId}`).get();
    if (!student.exists) continue;

    await db.doc(`${PATHS.students}/${studentId}`).set(
      {
        pendingReview: false,
        reviewedAt: at,
        reviewedBy: uid,
        updatedAt: at,
        updatedBy: uid,
      },
      { merge: true },
    );

    /*
     * A child a reviewer already merged is pushed as the row that survived, not
     * as the row that lost.
     *
     * Getting this wrong is invisible and expensive: the fold document is still
     * named on this registration, and pushing it would create upstream exactly
     * the duplicate the merge was performed to avoid — permanently, since there
     * is no delete. Following the pointer instead also does something useful,
     * because the guardian's household is built around whoever comes back from
     * here: the adult ends up attached to the family that was already on file.
     */
    const survivor = await followMerges(db, studentId);
    if (survivor !== null && !live.includes(survivor)) live.push(survivor);
  }

  /* ---- Where they are going ----------------------------------------------- */

  const target = registry.defaultPush();
  if ('error' in target || target.backend.capabilities.writeBack === 'off') {
    /*
     * Nowhere, and that is a finished state rather than a failure. The children
     * are approved and queued; `pushPendingVisitors` will take them the moment
     * a backend is connected. The record goes because it cannot help — there is
     * no upstream adult for the guardian's number to land on, and holding a
     * phone number against a maybe is exactly what the TTL exists to stop.
     */
    await ref.delete();
    logger.info('Approved a registration with nowhere to push it', {
      registrationId,
      children: live.length,
    });
    return {
      status: 'approved',
      pushed: 0,
      failed: 0,
      guardian: 'disabled',
      message:
        'Approved. No people backend is taking writes, so they stay queued in Tally until one is.',
    };
  }
  const backend = target.backend;

  /* ---- Every child, then one household ------------------------------------ */

  let pushed = 0;
  let failed = 0;
  for (const studentId of live) {
    try {
      const result = await backend.pushStudent({ studentId, logger });
      if (result.status === 'skipped') failed += 1;
      else pushed += 1;
    } catch (error) {
      failed += 1;
      logger.warn('Could not push an approved child upstream; it stays queued', {
        registrationId,
        studentId,
        error: String(error),
      });
    }
  }
  if (pushed > 0) backend.resetCache();

  /* ---- Allergies, where they belong --------------------------------------- */

  if (backend.capabilities.writeBack === 'full') {
    for (const [index, allergies] of record.allergies.entries()) {
      const named = record.studentIds[index];
      if (!allergies || !named) continue;
      // Onto the row that survived a merge, for the same reason the push goes
      // there: a peanut allergy on a document nobody reads is not recorded.
      const studentId = await followMerges(db, named);
      if (studentId === null || !live.includes(studentId)) continue;
      try {
        await backend.updateStudentProfile({ studentId, allergies, logger });
      } catch (error) {
        logger.warn('Could not record allergies upstream', { studentId, error: String(error) });
      }
    }
  }

  /* ---- The adult ---------------------------------------------------------- */

  let guardian: CreateFamilyResult['status'] | 'skipped' = 'skipped';
  let guardianMessage = '';

  /*
   * `parentCreatable` says the *adapter* knows how, not that the deployment
   * allows it — both backends hardcode it true, and the write-back mode is only
   * discovered inside the call, which answers `disabled`. So the capability is
   * what decides whether to ask, and the answer is what decides whether asking
   * again could ever help. See the note below.
   */
  const buildFamily = backend.capabilities.parentCreatable ? backend.createFamily : undefined;

  if (record.guardian && buildFamily === undefined) {
    guardian = 'disabled';
    guardianMessage = `${backend.displayName} cannot take a parent's details from Tally, so ${record.guardian.firstName}'s name and number were not recorded there.`;
  } else if (record.guardian && buildFamily !== undefined) {
    try {
      const family = await buildFamily.call(backend, {
        studentIds: live,
        anchorStudentIds: record.anchorStudentIds,
        firstName: record.guardian.firstName,
        lastName: record.guardian.lastName,
        phone: record.guardian.phone,
        logger,
      });
      backend.invalidateReachability();
      guardian = family.status;
      guardianMessage = family.message;
    } catch (error) {
      guardian = 'skipped';
      guardianMessage = String(error);
      logger.warn('Could not build the family upstream for an approved registration', {
        registrationId,
        error: String(error),
      });
    }
  }

  /* ---- Does the record still have a job to do? ---------------------------- */

  /*
   * It does exactly when pressing the button again could still improve things:
   * a child that has not landed, or a guardian who has not *and could*.
   *
   * `created`, `joined` and `already-has-family` are the successes. `disabled`
   * is the interesting one, and it is finished too: under `create` write-back
   * there is no household to build and never will be, so the guardian's details
   * can never reach the backend — not now, not on a retry, not next week. That
   * is a configuration fact, and calling it an unfinished push would leave the
   * record on the Review screen offering a button that cannot do anything,
   * holding a phone number for thirty days to no purpose. The message says
   * plainly where the details did not go.
   *
   * What is left is a real failure: the backend was asked and refused, or the
   * network did.
   */
  const guardianSettled =
    guardian === 'created' ||
    guardian === 'joined' ||
    guardian === 'already-has-family' ||
    guardian === 'disabled';
  const unfinished = failed > 0 || (record.guardian !== null && !guardianSettled);

  if (unfinished) {
    await ref.set(
      {
        lastError:
          guardianMessage ||
          `${failed} of ${live.length} children could not be added to ${backend.displayName}.`,
        lastAttemptAt: at,
      },
      { merge: true },
    );
  } else {
    await ref.delete();
  }

  logger.info('Reviewed a self-registration', {
    registrationId,
    children: live.length,
    pushed,
    failed,
    guardian,
  });

  return {
    status: unfinished ? 'partial' : 'approved',
    pushed,
    failed,
    guardian,
    message: unfinished
      ? guardianMessage ||
        `${pushed} of ${live.length} added to ${backend.displayName}. Try again, or finish it there.`
      : `Added to ${backend.displayName}.${guardianMessage ? ` ${guardianMessage}` : ''}`,
  };
}

/* -------------------------------------------------------------------------- */
/* Discarding                                                                  */
/* -------------------------------------------------------------------------- */

export interface DiscardRegistrationResult {
  status: 'discarded' | 'not-found';
  /** Students taken off the roster. */
  deactivated: number;
  message: string;
}

/**
 * Says no.
 *
 * The children are taken off the roster the way every other removal works —
 * `status: 'inactive'`, never a delete, because attendance records point at
 * these documents and deleting one would silently drop a head count that has
 * already been reported. The registration document goes, and with it the
 * guardian's phone number, which is the point of discarding rather than
 * ignoring.
 *
 * A child who has already been approved and pushed is left alone: they are in
 * the church's database now, and taking them off Tally's roster while leaving
 * them upstream is a different decision, made on the Students screen, by
 * somebody looking at that student.
 */
export async function discardRegistration(options: {
  db: FirestoreLike;
  registrationId: string;
  uid: string;
  now?: Date;
  logger?: FunctionLogger;
}): Promise<DiscardRegistrationResult> {
  const { db, registrationId, uid } = options;
  const now = options.now ?? new Date();
  const logger = options.logger ?? SILENT_LOGGER;

  const ref = db.doc(`${REGISTRATIONS_COLLECTION}/${registrationId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return {
      status: 'not-found',
      deactivated: 0,
      message: 'That registration has already been dealt with.',
    };
  }
  const record = readRegistration(snapshot.data() ?? {});

  const at = Timestamp.fromDate(now);
  let deactivated = 0;
  for (const studentId of record.studentIds) {
    const student = await db.doc(`${PATHS.students}/${studentId}`).get();
    if (!student.exists) continue;
    if ((student.data() ?? {}).pendingReview !== true) continue;
    await db.doc(`${PATHS.students}/${studentId}`).set(
      {
        status: 'inactive',
        pendingReview: false,
        pcoPushPending: false,
        reviewedAt: at,
        reviewedBy: uid,
        updatedAt: at,
        updatedBy: uid,
      },
      { merge: true },
    );
    deactivated += 1;
  }

  await ref.delete();
  logger.info('Discarded a self-registration', { registrationId, deactivated });

  return {
    status: 'discarded',
    deactivated,
    message:
      deactivated === 1
        ? 'Taken off the roster. Their check-in history is kept.'
        : `${deactivated} students taken off the roster. Their check-in history is kept.`,
  };
}
