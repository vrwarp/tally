/**
 * Correcting what a family typed, before it becomes permanent.
 *
 * The lobby kiosk takes a stranger's typing on a touchscreen with a queue
 * behind them, and `review.ts` is where somebody decides what to do with it.
 * Until this module there were three answers — approve it, fold a child into a
 * roster row, or take the whole family off — and none of them was the one a
 * reviewer most often wanted, which is *fix the spelling and then approve*.
 *
 * The absence had a cost that only ever landed downstream. "Micheal Okonkwo"
 * either went into Planning Center as Micheal, for ever, in a database with no
 * delete; or the family was discarded and lost their phone number with the
 * record. A wrong digit in a phone number was worse than either: those four
 * digits are the key the family types at the kiosk next week, so a typo left
 * them unfindable at the door *and* left somebody else's children answering to
 * digits a stranger might type.
 *
 * ## Why this is a callable and not a client write
 *
 * Three reasons, and the first is the one that matters.
 *
 * **A name is not a display string; it is what the duplicate scan ran on.**
 * `possibleDuplicateOf` was computed at the door from the name as typed, and a
 * misspelling is exactly why the roster's real Michael was not offered. Correct
 * the spelling without re-running the scan and the screen now shows a name that
 * collides with the roster next to no collision warning at all, with the
 * approve button released — which is a duplicate manufactured by the very act
 * of fixing a typo. So a rename re-scans, here, in the same call.
 *
 * **The phone number is an index, not a field.** Changing it moves the family
 * between buckets in `kioskIndex/phones`, adds to the overlay, and changes
 * which adults `findAdultCandidates` will offer. Only the server can do any of
 * that, and doing half of it is worse than doing none.
 *
 * **The registration document has no client read path at all**, in either
 * direction — `firestore.rules` denies it, because it is the one place in Tally
 * a parent's phone number lives. See `registration.ts` and docs/data-model.md.
 *
 * ## What may be corrected, and when
 *
 * **A child**, only while still held. One already pushed upstream, or already
 * folded into another roster row, is not editable here: renaming the first
 * would change Tally's copy and not the church's, and renaming the second
 * edits a document that is not the one approval will push.
 *
 * **The adult**, for as long as the adult has not been written — and the
 * record's own survival is the evidence for that, since it is deleted the
 * moment the guardian lands. Deliberately not keyed on whether the children
 * are held, which two real cards make wrong: a counselor's parent contact is a
 * record whose child was never held and whose adult is the whole point, and a
 * kiosk family whose guardian was refused is kept precisely so somebody can
 * try the adult again.
 *
 * Every refusal carries its reason rather than being accepted and quietly
 * ignored.
 *
 * ## What the record keeps
 *
 * The children as the family typed them, from the first correction onwards, so
 * a second reviewer can see that the card is no longer the form. The adult's
 * *name* on the same terms. Never the adult's original *number*: a mistyped one
 * belongs to a stranger, and holding a stranger's number for thirty days to
 * caption a correction is the exact retention this collection's TTL exists to
 * prevent.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { buildSearchName, nameKey } from '../backends/mappingShared.js';
import {
  PATHS,
  SILENT_LOGGER,
  type DocumentRefLike,
  type FirestoreLike,
  type FunctionLogger,
} from '../firestore.js';
import { dropFromPhonesNow, patchPhonesNow, recordPendingLast4 } from './phoneIndex.js';
import { bumpPulse, type PulseChannel } from './pulse.js';
import {
  REGISTRATIONS_COLLECTION,
  RegistrationInputError,
  findRosterDuplicates,
  parseAllergyNote,
  parseGrade,
  parseName,
  parseRegistrationPhone,
  readRegistration,
  type RegistrationChild,
  type RegistrationRecord,
} from './registration.js';

/**
 * One child, whole.
 *
 * Every field, every time, rather than a patch of the ones that changed. A
 * sparse patch has to answer "what does an absent field mean?" beside two
 * fields whose *empty* value is meaningful — a child with no grade has none,
 * and a cleared allergy note means nothing was recorded — and the answer would
 * be a rule the form and the server could disagree about. The editor holds the
 * whole person on screen; it sends the whole person.
 */
export interface AmendChild {
  index: number;
  firstName: string;
  lastName: string;
  grade: number | null;
  allergies: string | null;
}

/** The adult, whole, on the same reasoning. */
export interface AmendGuardian {
  firstName: string;
  lastName: string;
  phone: string;
}

export interface AmendRegistrationResult {
  status: 'amended' | 'unchanged' | 'not-found' | 'refused';
  /**
   * How many roster rows the corrected name now collides with.
   *
   * The point of saying it out loud: a correction can *create* the collision
   * the screen is there to catch, and the reviewer who just typed it is the one
   * person who will not be expecting that. Null for a guardian amendment, which
   * cannot change any child's collisions.
   */
  possibleDuplicates: number | null;
  /** Whether the four digits the family types at the kiosk moved. */
  last4Changed: boolean;
  message: string;
}

function refused(message: string): AmendRegistrationResult {
  return { status: 'refused', possibleDuplicates: null, last4Changed: false, message };
}

/** Reads back the same fields the door would have written for this person. */
function sameChild(a: RegistrationChild, b: RegistrationChild): boolean {
  return a.firstName === b.firstName && a.lastName === b.lastName && a.grade === b.grade;
}

/**
 * Corrects one person on one held registration.
 *
 * Exactly one of `child` and `guardian`, because the editor on screen opens on
 * one person at a time and a failure that spans two of them has nowhere honest
 * to report itself.
 */
export async function amendRegistration(options: {
  db: FirestoreLike;
  registrationId: string;
  uid: string;
  child?: AmendChild;
  guardian?: AmendGuardian;
  now?: Date;
  logger?: FunctionLogger;
}): Promise<AmendRegistrationResult> {
  const { db, registrationId, uid } = options;
  const now = options.now ?? new Date();
  const logger = options.logger ?? SILENT_LOGGER;

  if ((options.child === undefined) === (options.guardian === undefined)) {
    throw new RegistrationInputError('Correct one person at a time.');
  }

  const ref = db.doc(`${REGISTRATIONS_COLLECTION}/${registrationId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return {
      status: 'not-found',
      possibleDuplicates: null,
      last4Changed: false,
      message: 'That registration has already been dealt with.',
    };
  }
  const record = readRegistration(snapshot.data() ?? {});

  return options.child
    ? amendChild({ db, ref, record, registrationId, uid, now, logger, child: options.child })
    : amendGuardian({
        db,
        ref,
        record,
        registrationId,
        uid,
        now,
        logger,
        guardian: options.guardian!,
      });
}

/* -------------------------------------------------------------------------- */
/* A child                                                                     */
/* -------------------------------------------------------------------------- */

async function amendChild(context: {
  db: FirestoreLike;
  ref: DocumentRefLike;
  record: RegistrationRecord;
  registrationId: string;
  uid: string;
  now: Date;
  logger: FunctionLogger;
  child: AmendChild;
}): Promise<AmendRegistrationResult> {
  const { db, ref, record, registrationId, uid, now, logger, child } = context;

  const index = child.index;
  if (!Number.isInteger(index) || index < 0 || index >= record.children.length) {
    throw new RegistrationInputError('That child is not on this registration.');
  }

  const corrected: RegistrationChild = {
    firstName: parseName(child.firstName, "The child's first name"),
    lastName: parseName(child.lastName, "The child's last name"),
    grade: parseGrade(child.grade),
  };
  const allergies = parseAllergyNote(child.allergies);

  /*
   * The door's own rule, applied to the corrected form: two children of one
   * registration may not end up with the same name. Correcting the second Ade
   * into the first one's exact name is not a merge, it is a form that now says
   * the same child twice — and approving it would push one child and one
   * duplicate of them.
   */
  const key = nameKey(corrected.firstName, corrected.lastName);
  const clash = record.children.findIndex(
    (other, at) => at !== index && nameKey(other.firstName, other.lastName) === key,
  );
  if (clash !== -1) {
    return refused(
      `${corrected.firstName} ${corrected.lastName} is already on this registration. Correct the other row instead, or leave them as they are.`,
    );
  }

  /* ---- Is this child still ours to correct? ------------------------------- */

  const studentId = record.studentIds[index] ?? null;
  if (studentId === null) {
    return refused('That child never reached the roster, so there is nothing to correct.');
  }
  const student = await db.doc(`${PATHS.students}/${studentId}`).get();
  if (!student.exists) {
    return refused('That child is no longer on the roster.');
  }
  const held = student.data() ?? {};
  if (typeof held.mergedIntoStudentId === 'string' && held.mergedIntoStudentId.length > 0) {
    /*
     * Editing the row that lost a merge changes nothing anybody will read:
     * approval pushes the row that survived. Undoing the merge is the move, and
     * the card offers it two lines above.
     */
    return refused(
      'This child has been merged into another row. Undo the merge first, then correct whichever row is right.',
    );
  }
  if (held.pendingReview !== true) {
    /*
     * Already approved and pushed. Tally could rename its own copy, and that is
     * precisely the problem: the church's database would keep the old spelling,
     * and the two would disagree with nothing to say which is right. A rename
     * after the push belongs on the student's own page, which knows how to
     * carry it upstream.
     */
    return refused(
      'This child is not waiting on this review — they are already on their way to the church’s database. Correct them on their student page, so the change carries upstream.',
    );
  }

  const before = record.children[index]!;
  const unchanged = sameChild(before, corrected) && (record.allergies[index] ?? null) === allergies;
  if (unchanged) {
    return {
      status: 'unchanged',
      possibleDuplicates: (record.possibleDuplicateOf[String(index)] ?? []).length,
      last4Changed: false,
      message: 'Nothing changed.',
    };
  }

  /* ---- The roster row ----------------------------------------------------- */

  const at = Timestamp.fromDate(now);
  const patch: Record<string, unknown> = {
    firstName: corrected.firstName,
    lastName: corrected.lastName,
    // The kiosk searches on this, so it has to move with the name or a family
    // corrected on Tuesday stops being findable on Friday.
    searchName: buildSearchName(corrected.firstName, corrected.lastName),
    updatedAt: at,
    updatedBy: uid,
  };

  if (corrected.grade === null && held.grade !== undefined) {
    /*
     * A grade being *removed* is the one edit a merged write cannot express.
     * `firestore.rules` asserts `!('grade' in d.keys()) || d.grade is int`, so
     * writing a null would leave a document no client could ever have written,
     * and `FieldValue.delete` is not used anywhere in `functions/src` — the
     * in-memory Firestore the tests run against does not implement it. So the
     * document is rewritten whole, without the key. Read one line above and
     * written here, on a row that is held on a review screen: the window is a
     * few milliseconds wide and nothing else writes a held student.
     */
    const { grade: _dropped, ...rest } = held;
    await db.doc(`${PATHS.students}/${studentId}`).set({ ...rest, ...patch });
  } else {
    await db
      .doc(`${PATHS.students}/${studentId}`)
      .set(
        { ...patch, ...(corrected.grade === null ? {} : { grade: corrected.grade }) },
        { merge: true },
      );
  }

  /* ---- The record, and the suspicion it carries --------------------------- */

  const children = record.children.map((entry, at_) => (at_ === index ? corrected : entry));
  const allergyNotes = Array.from(
    { length: children.length },
    (_, at_) => (at_ === index ? allergies : (record.allergies[at_] ?? null)),
  );

  /*
   * The whole reason this is a server call. `possibleDuplicateOf` is the answer
   * to a question asked about the name as typed; the name has changed, so the
   * answer has to be asked again — for every child, because a rescan is one
   * roster read either way and a stale entry on a sibling is the same defect.
   *
   * A scan that fails leaves the old hints rather than clearing them. Wrong
   * hints are a reviewer looking at one extra candidate; absent hints are the
   * approve button released on a collision nobody was shown.
   */
  let possibleDuplicateOf = record.possibleDuplicateOf;
  let rescanned = true;
  try {
    const found = await findRosterDuplicates(db, children, {
      excludeStudentIds: record.studentIds,
    });
    /*
     * Dense, with an empty list for every child the rescan cleared.
     *
     * A merged write cannot remove a key — `{}` merged over `{'0': ['pco_9']}`
     * leaves the hint exactly where it was — so a correction that *unmakes* a
     * collision would have silently kept the warning it just disproved, and
     * gone on holding the approve button on it. An explicit `[]` is an array,
     * and arrays are replaced wholesale.
     */
    possibleDuplicateOf = Object.fromEntries(
      children.map((_child, at_) => [String(at_), found[String(at_)] ?? []]),
    );
  } catch (error) {
    rescanned = false;
    logger.warn('Could not rescan for duplicates after a correction; the old hints stand', {
      registrationId,
      error: String(error),
    });
  }

  await ref.set(
    {
      children,
      allergies: allergyNotes,
      possibleDuplicateOf,
      // Written once, on the first correction, and never overwritten after: the
      // point is what the *family* typed, not what the last reviewer saw.
      ...(record.typedChildren === null ? { typedChildren: record.children } : {}),
      amendedAt: at,
      amendedBy: uid,
    },
    { merge: true },
  );

  // The name moved on a roster every kiosk in the building holds a copy of.
  await bumpPulse(db, ['roster'], now, { logger });

  const collisions = (possibleDuplicateOf[String(index)] ?? []).length;
  logger.info('Corrected a child on a held registration', {
    registrationId,
    index,
    renamed: !sameChild(before, corrected),
    rescanned,
    collisions,
  });

  return {
    status: 'amended',
    possibleDuplicates: collisions,
    last4Changed: false,
    message: collisionMessage(corrected.firstName, collisions, rescanned),
  };
}

/**
 * What the reviewer is told, and the only interesting case is the third.
 *
 * A correction that reveals a collision has changed the card underneath them —
 * the approve button they were reaching for is held again — and the sentence
 * has to say so before they wonder why it stopped working.
 */
function collisionMessage(firstName: string, collisions: number, rescanned: boolean): string {
  if (!rescanned) {
    return `Saved. The roster could not be re-checked just now, so the duplicate warnings below may be about the old spelling.`;
  }
  if (collisions === 0) return `Saved. Nobody on the roster shares ${firstName}’s name.`;
  return collisions === 1
    ? `Saved — and one student on the roster now shares ${firstName}’s name. Settle their row before approving.`
    : `Saved — and ${collisions} students on the roster now share ${firstName}’s name. Settle their row before approving.`;
}

/* -------------------------------------------------------------------------- */
/* The adult                                                                   */
/* -------------------------------------------------------------------------- */

async function amendGuardian(context: {
  db: FirestoreLike;
  ref: DocumentRefLike;
  record: RegistrationRecord;
  registrationId: string;
  uid: string;
  now: Date;
  logger: FunctionLogger;
  guardian: AmendGuardian;
}): Promise<AmendRegistrationResult> {
  const { db, ref, record, registrationId, uid, now, logger, guardian } = context;

  if (record.guardian === null) {
    /*
     * The sibling journey: a parent adding a second child to a household the
     * church already has was never asked for an adult, because the household
     * upstream already holds one. Inventing one here would attach a brand new
     * person to a family that has a parent on file — the exact duplicate the
     * anchors exist to avoid.
     */
    return refused(
      'This registration has no adult on it — the children were added alongside a family the church already has. There is nothing to correct.',
    );
  }
  /*
   * The adult may be corrected for exactly as long as the adult has not been
   * written, and the record itself is the evidence: it is deleted the moment
   * the guardian lands upstream, or is deliberately skipped, or the family is
   * discarded. So its survival *is* the licence — with one exception.
   *
   * `lastErrorKind: 'children'` is that exception, and it is the only state
   * where this record outlives its own adult: approval wrote the guardian
   * successfully and then failed on a child, so the record is being kept to
   * retry the children. Correcting the name or number here would change a copy
   * that is about to be deleted and nothing the church can see.
   *
   * This deliberately does *not* key on whether the children are held, which is
   * what it used to do and what two real cards make wrong. A counselor's parent
   * contact (`source: 'counselor'`) is a record whose child was never held —
   * they were quick-added at a door and queued in the ordinary way — and whose
   * adult is the entire point of it. And a kiosk family whose children landed
   * but whose guardian was refused is kept precisely so somebody can try the
   * adult again; a mistyped number is the likeliest reason that refusal
   * happened, and fixing it is the move that ends the job.
   */
  if (record.lastErrorKind === 'children') {
    return refused(
      'The parent on this registration has already been added to the church’s database — what is left to retry is the children. Correct their details there.',
    );
  }

  const corrected = {
    firstName: parseName(guardian.firstName, "The parent's first name"),
    lastName: parseName(guardian.lastName, "The parent's last name"),
    phone: parseRegistrationPhone(guardian.phone),
  };

  const before = record.guardian;
  if (
    before.firstName === corrected.firstName &&
    before.lastName === corrected.lastName &&
    before.phone === corrected.phone
  ) {
    return {
      status: 'unchanged',
      possibleDuplicates: null,
      last4Changed: false,
      message: 'Nothing changed.',
    };
  }

  const oldLast4 = record.last4;
  const newLast4 = corrected.phone.slice(-4);
  const last4Changed = newLast4 !== oldLast4;
  const at = Timestamp.fromDate(now);

  await ref.set(
    {
      guardian: corrected,
      ...(last4Changed ? { last4: newLast4 } : {}),
      ...(record.typedGuardianName === null
        ? {
            typedGuardianName: { firstName: before.firstName, lastName: before.lastName },
          }
        : {}),
      ...(before.phone !== corrected.phone ? { phoneCorrected: true } : {}),
      amendedAt: at,
      amendedBy: uid,
    },
    { merge: true },
  );

  /* ---- The digits the family will type next week -------------------------- */

  /*
   * Both halves, in this order, and neither is optional.
   *
   * Adding the new bucket without dropping the old one leaves the children
   * answering to digits that are now a *stranger's* — which is how a newcomer
   * types their own last four at the lobby and is handed somebody else's
   * child, correctly spelled, which is the one failure the kiosk's search
   * screen is built around. Dropping without adding leaves the family unable to
   * find themselves at all.
   *
   * A failure here does not fail the correction: the record is already right,
   * the nightly rebuild folds the overlay in, and the alternative is telling a
   * reviewer their save did not happen when it did.
   */
  if (last4Changed && record.studentIds.length > 0) {
    try {
      await recordPendingLast4(
        db,
        { registrationId, last4: newLast4, studentIds: record.studentIds },
        now,
      );
      await patchPhonesNow(db, newLast4, record.studentIds);
      if (oldLast4) await dropFromPhonesNow(db, oldLast4, record.studentIds);
    } catch (error) {
      logger.warn('Could not move a corrected family between phone buckets', {
        registrationId,
        error: String(error),
      });
    }
  }

  const channels: PulseChannel[] = last4Changed ? ['phones'] : [];
  if (channels.length > 0) await bumpPulse(db, channels, now, { logger });

  // Counts and ids only. The number this line is about is on the document it
  // names; it is not going into a log as well.
  logger.info('Corrected the adult on a held registration', {
    registrationId,
    renamed: before.firstName !== corrected.firstName || before.lastName !== corrected.lastName,
    last4Changed,
  });

  return {
    status: 'amended',
    possibleDuplicates: null,
    last4Changed,
    message: last4Changed
      ? `Saved. ${corrected.firstName}’s family now finds themselves at the kiosk with ${newLast4}, and no longer with ${oldLast4 || 'the old digits'}.`
      : 'Saved.',
  };
}
