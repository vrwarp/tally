/**
 * Write-back: a parent's phone number or email, Tally -> Planning Center.
 *
 * The second thing Tally writes into a database it does not own, and by far the
 * more constrained of the two. `pushStudents.ts` may create a person; this may
 * not create anything except a PhoneNumber or an Email hanging off an adult who
 * is *already* in the student's household. That restriction is the whole design:
 *
 *   - No Person is created. An invented parent is a duplicate somebody merges by
 *     hand months later, and Tally has a first name and a phone number at best —
 *     nowhere near enough to say who this adult is.
 *   - No Household is created, and nobody is added to one. Household structure
 *     is a claim about a family, and getting it wrong puts a child in the wrong
 *     one.
 *   - Nothing is overwritten. A field already on file is left exactly as it is
 *     and reported back as skipped, because this runs from a screen whose whole
 *     premise is that there was nothing there — and if there is, that premise
 *     expired while somebody was typing.
 *
 * A student with no household therefore has no write path at all, on purpose.
 * The app links out to Planning Center for that, which is where the family has
 * to be built anyway.
 */
import type { PcoConfig } from '../config.js';
import type { PcoClient } from './client.js';
import { contactFieldsOnFile, findParentCandidate } from './mapping.js';
import { loadPersonWithHousehold, personIdFromStudentId } from './roster.js';
import { PATHS, SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import { PCO_TYPES } from './types.js';

/** Which of the two fields a call touched. */
export type ContactField = 'phone' | 'email';

export type SetParentContactStatus =
  /** At least one field was written. */
  | 'updated'
  /** Everything asked for was already on file upstream; nothing was written. */
  | 'already-set'
  /** `PCO_WRITE_BACK` is not `full`. */
  | 'disabled'
  /** No such student, or one who is not on the roster. */
  | 'no-student'
  /** A Tally-only visitor: there is no upstream person to hang a contact off. */
  | 'not-in-planning-center'
  /** Planning Center has the student but no adult in their household. */
  | 'no-household-adult'
  /** Neither a usable phone nor a usable email was supplied. */
  | 'nothing-to-write';

export interface SetParentContactResult {
  status: SetParentContactStatus;
  /** The adult the contact landed on, when there was one. */
  parentName: string | null;
  /** Fields this call created upstream. */
  wrote: ContactField[];
  /** Fields left alone because Planning Center already had one. */
  skipped: ContactField[];
  /** Plain language, for a leader who is looking at the result. */
  message: string;
}

export interface SetParentContactOptions {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  /** Tally student id — `pco_123` for a roster student. */
  studentId: string;
  phone?: string | null;
  email?: string | null;
  logger?: FunctionLogger;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A phone number worth sending upstream, or null.
 *
 * Deliberately permissive about *shape* and strict about *substance*. Planning
 * Center stores whatever it is given and formats on display, and a church with
 * international families has numbers this has no business rejecting — but a
 * four-digit extension typed into the wrong box is not a number anybody can
 * ring, and writing it makes the student look reachable when they are not.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return trimmed;
}

/**
 * An email worth sending upstream, or null.
 *
 * One `@`, something either side of it, and a dot in the domain. Anything
 * stricter rejects addresses that exist; anything looser writes a typo onto a
 * parent's permanent record.
 */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed)) return null;
  return trimmed;
}

/* -------------------------------------------------------------------------- */
/* The write                                                                   */
/* -------------------------------------------------------------------------- */

function result(
  status: SetParentContactStatus,
  message: string,
  extra: Partial<SetParentContactResult> = {},
): SetParentContactResult {
  return { status, parentName: null, wrote: [], skipped: [], message, ...extra };
}

/**
 * Resolves which Planning Center person this student is.
 *
 * Read from Tally's own record rather than taken from the caller, for the same
 * reason `scanRoster` does it: the id says whose personal record is about to be
 * written to, and a browser may not be the one choosing that.
 */
async function personIdFor(
  db: FirestoreLike,
  studentId: string,
): Promise<{ personId: string | null; exists: boolean; active: boolean }> {
  const snapshot = await db.doc(`${PATHS.students}/${studentId}`).get();
  if (!snapshot.exists) {
    // A roster student always has a document; there is nothing to write against
    // an id nobody put on the roster.
    return { personId: null, exists: false, active: false };
  }

  const data = snapshot.data() ?? {};
  const stored = typeof data.pcoPersonId === 'string' && data.pcoPersonId ? data.pcoPersonId : null;
  return {
    personId: personIdFromStudentId(studentId) ?? stored,
    exists: true,
    active: data.status !== 'inactive',
  };
}

/**
 * Adds a parent contact to the adult Planning Center already has in this
 * student's household.
 *
 * The adult is chosen by `findParentCandidate` — the same ranking the *read*
 * path uses to decide whose number to show. That is not a tidiness point: if the
 * two disagreed, a leader could add a number and watch the row go on saying
 * nobody can be reached, because the number landed on an adult the row does not
 * look at.
 */
export async function setParentContact(
  options: SetParentContactOptions,
): Promise<SetParentContactResult> {
  const { db, client, config, studentId } = options;
  const logger = options.logger ?? SILENT_LOGGER;

  if (config.writeBack !== 'full') {
    return result(
      'disabled',
      'Adding a parent contact from Tally is switched off. A leader can turn on full write-back in Settings, or add the number in Planning Center.',
    );
  }

  const phone = normalizePhone(options.phone);
  const email = normalizeEmail(options.email);
  if (!phone && !email) {
    return result('nothing-to-write', 'Enter a phone number or an email address.');
  }

  const target = await personIdFor(db, studentId);
  if (!target.exists || !target.active) {
    return result('no-student', 'That student is not on the roster.');
  }
  if (!target.personId) {
    return result(
      'not-in-planning-center',
      'This student is not in Planning Center yet, so there is no household to add a contact to.',
    );
  }

  const loaded = await loadPersonWithHousehold(client, target.personId);
  if (!loaded) {
    return result(
      'no-student',
      'Planning Center no longer has a record for this student — deleted or merged there.',
    );
  }

  const parent = findParentCandidate(loaded.person, loaded.index);
  if (!parent) {
    return result(
      'no-household-adult',
      'Planning Center has no adult in this household. Somebody has to add the parent there before a number can go on them.',
    );
  }

  /*
   * What the parent already has, from the same read that chose them.
   *
   * Checked rather than assumed because this is invoked from a screen that
   * decided the student was unreachable — possibly minutes ago, possibly while
   * somebody else was fixing it in Planning Center. Adding a second number in
   * that window is not a correction, it is a duplicate on a real person's
   * record.
   */
  const onFile = contactFieldsOnFile(
    parent.member ?? { id: parent.id, type: PCO_TYPES.person },
    loaded.index,
  );

  /*
   * Two independent writes, and no attempt to make them one.
   *
   * Planning Center has no transaction to enrol them in, so if the second fails
   * the first stays. That is survivable precisely because of the skip above: a
   * retry sees the phone already on file, skips it, and writes only the email.
   * The failure is reported rather than swallowed, and repeating it is safe —
   * which is a better property than a rollback nobody could implement.
   */
  const wrote: ContactField[] = [];
  const skipped: ContactField[] = [];

  if (phone) {
    if (onFile.phone) skipped.push('phone');
    else {
      await client.post(`/people/${encodeURIComponent(parent.id)}/phone_numbers`, {
        data: {
          type: PCO_TYPES.phoneNumber,
          attributes: { number: phone, location: 'Mobile', primary: true },
        },
      });
      wrote.push('phone');
    }
  }

  if (email) {
    if (onFile.email) skipped.push('email');
    else {
      await client.post(`/people/${encodeURIComponent(parent.id)}/emails`, {
        data: {
          type: PCO_TYPES.email,
          attributes: { address: email, location: 'Home', primary: true },
        },
      });
      wrote.push('email');
    }
  }

  if (wrote.length === 0) {
    return result(
      'already-set',
      `Planning Center already has contact details for ${parent.name ?? 'this parent'}. Nothing was changed.`,
      { parentName: parent.name, skipped },
    );
  }

  // The person id, never the number: this line ends up in a log a church admin
  // may read, and the contact detail itself has no business being in one.
  logger.info('Added a parent contact in Planning Center', {
    studentId,
    parentPersonId: parent.id,
    wrote,
    skipped,
  });

  return result(
    'updated',
    `Added ${wrote.join(' and ')} for ${parent.name ?? 'the parent'} in Planning Center.`,
    { parentName: parent.name, wrote, skipped },
  );
}
