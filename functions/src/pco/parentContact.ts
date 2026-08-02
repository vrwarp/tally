/**
 * Write-back: a parent's phone number or email, Tally -> Planning Center.
 *
 * The narrowest of the write paths. This one adds a PhoneNumber or an Email to
 * an adult who is *already* in the student's household, and does nothing else:
 *
 *   - No Person is created and no household structure is touched. Building a
 *     family is a bigger claim and lives in `household.ts`, behind its own
 *     confirmation; this path is for the household that is already right and
 *     merely has no number on it.
 *   - Nothing is overwritten. A field already on file is left exactly as it is
 *     and reported back as skipped, because this runs from a screen whose whole
 *     premise is that there was nothing there — and if there is, that premise
 *     expired while somebody was typing.
 *
 * The two paths are deliberately separate rather than one call that figures it
 * out: "put a number on this child's mother" and "this child has no family on
 * file, make one" are different decisions, and only one of them should be
 * reachable by filling in a phone box.
 */
import type { PcoConfig } from '../config.js';
import type { PcoClient } from './client.js';
import { contactFieldsOnFile, findParentCandidate } from './mapping.js';
import { loadPersonWithHousehold } from './roster.js';
import { readThroughMerges, resolveStudentPerson } from './studentPerson.js';
import { SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';
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
 * Adds a phone number, an email, or both, to one adult already in Planning
 * Center — skipping whatever they already have on file.
 *
 * Shared with `household.ts`, which reaches this point by a longer road: it may
 * have had to create the adult first. The rule is the same either way, and it
 * is the one rule this whole area turns on — a field on file is left exactly as
 * it is and reported back as skipped, because every screen that calls this was
 * opened on the premise that there was nothing there, and that premise expires
 * while somebody is typing.
 *
 * Two independent writes, and no attempt to make them one. Planning Center has
 * no transaction to enrol them in, so if the second fails the first stays. That
 * is survivable precisely because of the skip: a retry sees the phone already on
 * file, skips it, and writes only the email. The failure is reported rather than
 * swallowed, and repeating it is safe — a better property than a rollback nobody
 * could implement.
 */
export async function writeContactOnto(
  client: PcoClient,
  personId: string,
  wanted: { phone?: string | null; email?: string | null },
  onFile: { phone: boolean; email: boolean },
): Promise<{ wrote: ContactField[]; skipped: ContactField[] }> {
  const wrote: ContactField[] = [];
  const skipped: ContactField[] = [];

  if (wanted.phone) {
    if (onFile.phone) skipped.push('phone');
    else {
      await client.post(`/people/${encodeURIComponent(personId)}/phone_numbers`, {
        data: {
          type: PCO_TYPES.phoneNumber,
          attributes: { number: wanted.phone, location: 'Mobile', primary: true },
        },
      });
      wrote.push('phone');
    }
  }

  if (wanted.email) {
    if (onFile.email) skipped.push('email');
    else {
      await client.post(`/people/${encodeURIComponent(personId)}/emails`, {
        data: {
          type: PCO_TYPES.email,
          attributes: { address: wanted.email, location: 'Home', primary: true },
        },
      });
      wrote.push('email');
    }
  }

  return { wrote, skipped };
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

  const target = await resolveStudentPerson(db, studentId);
  if (!target.exists || !target.active) {
    return result('no-student', 'That student is not on the roster.');
  }
  if (!target.personId) {
    return result(
      'not-in-planning-center',
      'This student is not in Planning Center yet, so there is no household to add a contact to.',
    );
  }

  const read = await readThroughMerges(
    { db, client },
    studentId,
    target.personId,
    (personId) => loadPersonWithHousehold(client, personId),
  );
  if (read.outcome === 'gone' || !read.value) {
    return result(
      'no-student',
      'Planning Center no longer has a record for this student — deleted or merged there.',
    );
  }
  const loaded = read.value;

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

  const { wrote, skipped } = await writeContactOnto(client, parent.id, { phone, email }, onFile);

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
