/**
 * A family nobody has met, registering themselves.
 *
 * The kiosk's search screen answers one question — "which of these is your
 * child" — and for a family arriving for the first time the answer was "none of
 * them, please see a leader". This is the other door: a parent types their
 * children in, one adult and one phone number, and walks away with everybody
 * checked in and stickers printed.
 *
 * Why a callable rather than a write from the shelf. A kiosk session is the
 * approver's, narrowed: `firestore.rules` pins the student keys it may write to
 * the eight the check-in date patch touches, so a browser in a lobby cannot
 * create a student carrying `status`, `isVisitor` or `upstreamPushPending` — and a
 * document without those is invisible to the kiosk's own roster query and never
 * pushed upstream. Widening the pin would hand a public screen the ability to
 * write arbitrary roster documents; the pin stays and the registration comes
 * through here, where the server decides every field.
 *
 * Two callers, one algorithm:
 *
 *   - **the kiosk itself** (`source: 'kiosk'`), holding a paired session. It
 *     names an event, and everybody registered is checked in against it.
 *   - **a phone** (`source: 'qr'`), holding nothing but a short-lived code the
 *     kiosk minted and put in a QR. It creates the family and checks nobody in:
 *     the parent walks to the kiosk and taps their own children through.
 *
 * Two journeys through it. A family nobody has met answers six questions. A
 * family the church already has, whose second child is finally old enough,
 * answers two: they found themselves by phone first, so the request carries
 * `anchorStudentIds` — their existing children — and needs no adult at all. The
 * anchors are what make the difference at approval, where the new child joins
 * the household the family already has instead of founding a second one.
 *
 * ## What the door does not decide
 *
 * Nothing that cannot be taken back. This used to create people, an adult and a
 * household in the church's database while the parent stood there, and to
 * *refuse* a registration whose child's name already matched the roster. Both
 * were the same mistake: asking a lobby screen with a queue behind it to settle
 * identity, on evidence a stranger typed, against a system with no undo —
 * there is no delete anywhere in `functions/src`, and Attendees has no merges
 * at all.
 *
 * So: every registration succeeds, every child is checked in, every sticker
 * prints, and every child is written with `pendingReview: true`
 * (`backends/pendingReview.ts`), which is what keeps them out of Planning
 * Center until somebody approves them on the Review screen. A name that
 * already matches the roster is *recorded* as a suspicion on the registration
 * document rather than turned into a refusal — the old refusal steered a family
 * toward checking in some other family's Jacob Smith, which is a worse outcome
 * than a duplicate a reviewer merges on Tuesday.
 *
 * The registration document is therefore no longer only an idempotency claim.
 * It is the review record: the guardian's name and phone live on it, TTL'd and
 * deleted when the review happens, because there is nowhere else in Tally they
 * may go — `noMirroredPersonalData` in `firestore.rules` forbids them on a
 * student, deliberately. It is functions-only in both directions and read
 * through a core-team callable. See `docs/data-model.md`.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { buildSearchName, nameKey } from '../backends/mappingShared.js';
import {
  PATHS,
  SILENT_LOGGER,
  toDateOrNull,
  type DocumentRefLike,
  type FirestoreLike,
  type FunctionLogger,
} from '../firestore.js';
import { last4ForStudents, patchPhonesNow, recordPendingLast4 } from './phoneIndex.js';
import { bumpPulse, type PulseChannel } from './pulse.js';

export const REGISTRATIONS_COLLECTION = 'kioskRegistrations';

/**
 * How many children one registration may carry.
 *
 * Six is past the largest family anybody has brought and well short of a number
 * that makes a single call expensive. A seventh child is not a refusal to
 * register — it is a second run through the wizard, which the last-4 the first
 * run taught them already makes short.
 */
export const MAX_REGISTRATION_CHILDREN = 6;

/** Long enough for any real name, short enough that nothing is a paragraph. */
export const NAME_MAX_LENGTH = 40;

/** Held for the reviewer on the registration record, then sent upstream. */
export const ALLERGIES_MAX_LENGTH = 200;

/**
 * How long a registration document is kept before the sweep takes it.
 *
 * It used to be a day, because the document existed only to make a retry
 * idempotent and a retry happens within seconds. It is the review record now,
 * and the review happens on a weekday when somebody has time — so the window
 * has to cover a long weekend, a holiday, and the volunteer who was away. A
 * month is that with room to spare, and it is still a *deletion date* rather
 * than an archive: the guardian's phone number leaves Tally whether or not
 * anybody got to it.
 *
 * The Review screen ages rows toward this, so a family about to be swept is
 * visible as one before they vanish.
 */
export const REGISTRATION_DOC_TTL_MS = 30 * 24 * 60 * 60_000;

export interface RegistrationChild {
  firstName: string;
  lastName: string;
  grade: number | null;
}

export interface RegistrationGuardian {
  firstName: string;
  lastName: string;
  /** Exactly ten digits. Held for the length of one invocation and never stored. */
  phone: string;
}

export interface ParsedRegistration {
  registrationId: string;
  children: RegistrationChild[];
  /**
   * Null on the sibling journey, and only there. A parent adding a second child
   * to a family the church already has is not a new adult: the household
   * upstream already holds them, the phone index already answers for their
   * digits, and asking again would be three questions to learn nothing.
   */
  guardian: RegistrationGuardian | null;
  /** Index-aligned with `children`. Empty outside code mode. */
  allergies: (string | null)[];
  /**
   * Students this family already has on the roster, when a parent adding a
   * sibling reached this through "add a brother or sister" rather than through
   * the first-time wizard. Claimed by the client from the last-4 it searched
   * with, and verified server-side before it is trusted — see `verifyAnchors`.
   *
   * What it buys is the whole point of that journey: at approval the household
   * is derived from an existing sibling, so the new child joins the family the
   * church already has instead of founding a second one.
   */
  anchorStudentIds: string[];
}

/**
 * Where a registration record came from.
 *
 * `'qr'` is legacy: the phone form that wrote it was retired in Aug 2026, and
 * nothing writes it any more — but records live 30 days, and the read side
 * (this union, `readRegistration`, the review card's "from their own phone"
 * subtitle, the allergy push on approval) stays tolerant for as long as any
 * exist. Tolerant reads of old shapes are this codebase's standing posture;
 * the union costs three lines.
 */
export type RegistrationSource = 'kiosk' | 'qr';

export interface RegisteredChild {
  studentId: string;
  firstName: string;
  lastName: string;
  grade: number | null;
  searchName: string;
  /**
   * Whether an allergy note was recorded with this registration.
   *
   * The boolean, never the note: the kiosk shows a marker so a leader glances
   * at the right child, and the note itself stays on the registration record
   * for the reviewer. Echoed here because the kiosk otherwise could not know —
   * the roster read reports `false` for every Tally-owned student by rule
   * (student documents refuse an allergies key), so until approval pushes the
   * note upstream, this echo is the only source.
   */
  hasAllergies: boolean;
}

/**
 * What the door tells the family.
 *
 * One arm, on purpose. The `duplicate` refusal that used to live here is gone:
 * it made a screen with no leader at it decide whether two children with the
 * same name are one child, and it answered the family with "search for their
 * name instead" — which is an instruction to check in somebody else's child.
 * A registration either succeeds or throws.
 */
export interface RegisterFamilyResult {
  status: 'created';
  children: RegisteredChild[];
  /** The digits the family types at the kiosk from now on. */
  last4: string;
  checkedIn: boolean;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Refusals carry a `reason` rather than an `HttpsError`, so this module stays
 * free of the functions framework and testable against the in-memory double.
 * The entry point turns them into `invalid-argument`.
 */
export class RegistrationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistrationInputError';
  }
}

function refuse(message: string): never {
  throw new RegistrationInputError(message);
}

/**
 * A name as a person typed it on a lobby keyboard.
 *
 * Digits are refused rather than stripped: "Room 3" and "555-0123" in a name
 * field are somebody misreading the question, and silently keeping "Room"
 * would put that on a sticker. Apostrophes and hyphens are kept — O'Brien and
 * Anne-Marie are names, and the kiosk keyboard has both keys for this reason.
 */
function parseName(raw: unknown, field: string): string {
  if (typeof raw !== 'string') refuse(`${field} is required.`);
  const value = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (value.length === 0) refuse(`${field} is required.`);
  if (value.length > NAME_MAX_LENGTH) refuse(`${field} is too long.`);
  if (/\d/.test(value)) refuse(`${field} cannot contain numbers.`);
  if (!/\p{L}/u.test(value)) refuse(`${field} needs at least one letter.`);
  return value;
}

function parseGrade(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 12) {
    refuse('grade must be a whole number from 0 to 12, or null.');
  }
  return raw;
}

/**
 * Ten digits, however they were punctuated.
 *
 * A repdigit — 0000000000, 5555555555 — is refused because it is what somebody
 * types to get past a field they do not want to answer, and the whole point of
 * the number is that four of its digits are a key their family will use next
 * week. A leading US country code is dropped rather than refused: 1 followed by
 * ten digits is the same number written longer.
 */
export function parseRegistrationPhone(raw: unknown): string {
  if (typeof raw !== 'string') refuse('A phone number is required.');
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) refuse('Enter a 10-digit phone number.');
  if (/^(\d)\1{9}$/.test(digits)) refuse('That does not look like a phone number.');
  return digits;
}

function parseAllergies(raw: unknown, childCount: number): (string | null)[] {
  if (raw === undefined || raw === null) return new Array<string | null>(childCount).fill(null);
  if (!Array.isArray(raw) || raw.length !== childCount) {
    refuse('allergies must line up with children.');
  }
  return raw.map((entry) => {
    if (entry === null || entry === undefined) return null;
    if (typeof entry !== 'string') refuse('allergies must be text.');
    const value = entry.trim();
    if (value.length === 0) return null;
    if (value.length > ALLERGIES_MAX_LENGTH) refuse('That allergy note is too long.');
    return value;
  });
}

/**
 * The whole request, checked before anything is read from the database.
 *
 * One caller now: the kiosk wizard, under the kiosk's own token. The retired
 * phone form used to arrive here too, which is why the record still reads a
 * `source` back (see readRegistration) — records it wrote outlive it by up to
 * the 30-day TTL.
 */
export function parseRegisterFamilyRequest(data: unknown): ParsedRegistration {
  const body = (data ?? {}) as Record<string, unknown>;

  const registrationId = typeof body.registrationId === 'string' ? body.registrationId.trim() : '';
  if (!/^[A-Za-z0-9-]{20,64}$/.test(registrationId)) {
    refuse('registrationId is required.');
  }

  const rawChildren = body.children;
  if (!Array.isArray(rawChildren) || rawChildren.length === 0) {
    refuse('Add at least one child.');
  }
  if (rawChildren.length > MAX_REGISTRATION_CHILDREN) {
    refuse(`Up to ${MAX_REGISTRATION_CHILDREN} children at a time.`);
  }

  const children = rawChildren.map((entry): RegistrationChild => {
    const child = (entry ?? {}) as Record<string, unknown>;
    return {
      firstName: parseName(child.firstName, "The child's first name"),
      lastName: parseName(child.lastName, "The child's last name"),
      grade: parseGrade(child.grade),
    };
  });

  /*
   * The same child twice, in one submission.
   *
   * Nothing compared the children to *each other* before — the roster guard
   * looked outward and this looked nowhere — so a parent who tapped "add
   * another" and retyped the child they had just entered registered them
   * twice, checked them in twice, and printed two stickers. Unlike a roster
   * collision this one is not a judgement anybody has to make later: the family
   * is standing here and can fix it in two taps, and there is no reading of two
   * identical rows in one form that is not a mistake.
   *
   * Grade is deliberately not part of the comparison. Two children of the same
   * name in different grades are still not something a parent means to type.
   */
  const seen = new Map<string, number>();
  children.forEach((child, index) => {
    const key = nameKey(child.firstName, child.lastName);
    const first = seen.get(key);
    if (first !== undefined) {
      refuse(
        `${child.firstName} ${child.lastName} is on this form twice. Remove one of them, or correct the name.`,
      );
    }
    seen.set(key, index);
  });

  // Sibling ids from the last-4 search the kiosk ran. Verified server-side
  // before anything is done with them, as ever.
  const anchorStudentIds = parseAnchors(body.anchorStudentIds);

  /*
   * The adult, unless siblings already say who this family is.
   *
   * Not "optional": exactly one of the two has to be there. A registration with
   * neither is a set of children nobody can be reached about and no household
   * to put them in — which is the state the whole review pipeline exists to
   * avoid arriving at silently.
   */
  const rawGuardian = (body.guardian ?? null) as Record<string, unknown> | null;
  const guardian: RegistrationGuardian | null =
    rawGuardian === null && anchorStudentIds.length > 0
      ? null
      : {
          firstName: parseName(rawGuardian?.firstName, "The parent's first name"),
          lastName: parseName(rawGuardian?.lastName, "The parent's last name"),
          phone: parseRegistrationPhone(rawGuardian?.phone),
        };

  return {
    registrationId,
    children,
    guardian,
    allergies: parseAllergies(body.allergies, children.length),
    anchorStudentIds,
  };
}

/**
 * The sibling ids a client claims this family already has.
 *
 * Shape only — that these are real, active students is checked against the
 * database in `verifyAnchors`, because a client that could name any student id
 * and have it believed would be a client that can attach its own child to a
 * stranger's household.
 */
function parseAnchors(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) refuse('anchorStudentIds must be a list.');
  if (raw.length > MAX_REGISTRATION_CHILDREN) refuse('Too many siblings named.');
  const ids = raw.map((entry) => {
    if (typeof entry !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(entry)) {
      refuse('anchorStudentIds must be student ids.');
    }
    return entry;
  });
  return [...new Set(ids)];
}

/* -------------------------------------------------------------------------- */
/* The registration document — the claim, and the review record                */
/* -------------------------------------------------------------------------- */

/**
 * What survives a request: enough to make a retry idempotent, and enough for
 * somebody to review this family later.
 *
 * It used to be only the first half, and to hold deliberately *nothing* a
 * person typed — on the reasoning that a collection of half-finished
 * registrations is not a place to accumulate what the rest of the database
 * refuses to hold. That reasoning was right about the destination and wrong
 * about the alternative, which turned out to be losing the guardian's name and
 * number entirely: they were only ever written straight through to Planning
 * Center, and the push is exactly what is being deferred now.
 *
 * So the guardian waits here. It is a staging buffer, not a mirror, and the
 * difference is enforced rather than asserted: no client can read this
 * collection (`firestore.rules` denies both directions), the only way to see it
 * is a core-team callable, the document is deleted the moment a reviewer acts,
 * and it is swept at `REGISTRATION_DOC_TTL_MS` whether anybody acted or not.
 * `docs/data-model.md` names this as the one exception to "Tally does not store
 * parent contact details", because an undocumented exception is just a mirror
 * with a good excuse.
 */
export interface RegistrationRecord {
  status: 'pending' | 'complete';
  source: RegistrationSource;
  eventId: string | null;
  studentIds: string[];
  childCount: number;
  last4: string;
  checkedIn: boolean;
  createdAt: Date | null;
  /** The adult who registered, as they typed themselves. */
  guardian: RegistrationGuardian | null;
  /** The children as typed, so a reviewer sees the form and not just the roster. */
  children: RegistrationChild[];
  /** Index-aligned with `children`; only ever non-empty from the QR form. */
  allergies: (string | null)[];
  /**
   * Child index -> the active students whose name already matched. Recorded,
   * never acted on: it is what puts "this might be the Jacob Smith we have"
   * in front of a human, and nothing else reads it.
   */
  possibleDuplicateOf: Record<string, string[]>;
  /** Verified siblings, when this was an "add a brother or sister". */
  anchorStudentIds: string[];
  /** Why the last approval attempt did not finish, if one did not. */
  lastError: string | null;
  /** Which half of the last approval failed — see `PendingRegistration`. */
  lastErrorKind: 'children' | 'guardian' | 'both' | null;
}

function readStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function readRegistration(data: Record<string, unknown>): RegistrationRecord {
  const ids = readStringArray(data.studentIds);
  const rawGuardian = (data.guardian ?? null) as Record<string, unknown> | null;
  const rawChildren = Array.isArray(data.children) ? data.children : [];
  const rawDuplicates = (data.possibleDuplicateOf ?? {}) as Record<string, unknown>;
  return {
    status: data.status === 'complete' ? 'complete' : 'pending',
    source: data.source === 'qr' ? 'qr' : 'kiosk',
    eventId: typeof data.eventId === 'string' ? data.eventId : null,
    studentIds: ids,
    childCount: typeof data.childCount === 'number' ? data.childCount : ids.length,
    last4: typeof data.last4 === 'string' ? data.last4 : '',
    checkedIn: data.checkedIn === true,
    createdAt: toDateOrNull(data.createdAt),
    guardian:
      rawGuardian && typeof rawGuardian.firstName === 'string'
        ? {
            firstName: rawGuardian.firstName,
            lastName: typeof rawGuardian.lastName === 'string' ? rawGuardian.lastName : '',
            phone: typeof rawGuardian.phone === 'string' ? rawGuardian.phone : '',
          }
        : null,
    children: rawChildren.map((entry) => {
      const child = (entry ?? {}) as Record<string, unknown>;
      return {
        firstName: typeof child.firstName === 'string' ? child.firstName : '',
        lastName: typeof child.lastName === 'string' ? child.lastName : '',
        grade: typeof child.grade === 'number' ? child.grade : null,
      };
    }),
    allergies: Array.isArray(data.allergies)
      ? data.allergies.map((entry) => (typeof entry === 'string' ? entry : null))
      : [],
    possibleDuplicateOf: Object.fromEntries(
      Object.entries(rawDuplicates).map(([index, value]) => [index, readStringArray(value)]),
    ),
    anchorStudentIds: readStringArray(data.anchorStudentIds),
    lastError: typeof data.lastError === 'string' ? data.lastError : null,
    lastErrorKind:
      data.lastErrorKind === 'children' ||
      data.lastErrorKind === 'guardian' ||
      data.lastErrorKind === 'both'
        ? data.lastErrorKind
        : null,
  };
}

function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

/**
 * The collection's garbage collector, on the same terms as the pairing sweep:
 * cheap because the collection is bounded by how many families register in a
 * day, and run from the one call that is guaranteed to be paying attention.
 */
export async function sweepRegistrations(db: FirestoreLike, now: Date): Promise<void> {
  const snapshot = await db.collection(REGISTRATIONS_COLLECTION).get();
  for (const doc of snapshot.docs) {
    const record = readRegistration(doc.data() ?? {});
    const createdAt = record.createdAt;
    if (createdAt === null || now.getTime() - createdAt.getTime() > REGISTRATION_DOC_TTL_MS) {
      await db.doc(`${REGISTRATIONS_COLLECTION}/${doc.id}`).delete();
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The already-on-the-roster suspicion                                         */
/* -------------------------------------------------------------------------- */

/**
 * Which children share a name with somebody already on the roster, and who.
 *
 * This was a guard and is now a note. It used to refuse the whole registration
 * and tell the family to search for the name instead, which sounds careful and
 * is not: the other Jacob Smith is a different child, nothing on the kiosk's
 * confirm screen distinguishes him except a grade nobody checks, and the family
 * were being pointed at him by name. A duplicate the reviewer merges on Tuesday
 * is a smaller problem than a child checked in as somebody else on Sunday.
 *
 * Name-only, and against active students only. Grade is deliberately not part
 * of the key — a family who moved up a year would otherwise look like two
 * different children — and the folding is `nameKey`'s, the same one the
 * upstream matcher uses, so *José* and *Jose* are the same suspicion here and
 * the same person there.
 *
 * The ids are for the reviewer, who is core team and can already read the whole
 * roster; the family never sees them.
 */
export async function findRosterDuplicates(
  db: FirestoreLike,
  children: readonly RegistrationChild[],
  options: { excludeStudentIds?: readonly string[] } = {},
): Promise<Record<string, string[]>> {
  const excluded = new Set(options.excludeStudentIds ?? []);
  const wanted = new Map<string, number[]>();
  children.forEach((child, index) => {
    const key = nameKey(child.firstName, child.lastName);
    const bucket = wanted.get(key);
    if (bucket) bucket.push(index);
    else wanted.set(key, [index]);
  });

  const snapshot = await db.collection(PATHS.students).get();
  const hits: Record<string, string[]> = {};
  for (const doc of snapshot.docs) {
    const data = doc.data() ?? {};
    if (data.status === 'inactive') continue;
    // The children this same request just wrote are not duplicates of
    // themselves — this runs after the batch commits, so they are on the roster
    // by the time it looks.
    if (excluded.has(doc.id)) continue;
    if (typeof data.firstName !== 'string' || typeof data.lastName !== 'string') continue;
    const key = nameKey(data.firstName, data.lastName);
    for (const index of wanted.get(key) ?? []) {
      (hits[String(index)] ??= []).push(doc.id);
    }
  }
  return hits;
}

/* -------------------------------------------------------------------------- */
/* Registering                                                                 */
/* -------------------------------------------------------------------------- */

interface EventFacts {
  id: string;
  seriesId: string | null;
  startAt: Date;
}

/**
 * The gathering this registration checks in against, read from its document.
 *
 * `seriesId` and `startAt` come from here rather than from the request for the
 * same reason the check-in rules pin the attendance shape: they decide which
 * repeat chain the visit counts towards, and a client that could name them
 * could file a family against a gathering nobody held.
 */
async function readEvent(db: FirestoreLike, eventId: string): Promise<EventFacts> {
  const snapshot = await db.doc(`events/${eventId}`).get();
  if (!snapshot.exists) refuse('That gathering no longer exists.');
  const data = snapshot.data() ?? {};
  if (data.status === 'cancelled') refuse('That gathering has been cancelled.');
  const startAt = toDateOrNull(data.startAt);
  if (startAt === null) refuse('That gathering has no start time.');
  return {
    id: eventId,
    seriesId: typeof data.seriesId === 'string' ? data.seriesId : null,
    startAt,
  };
}

export interface RegisterFamilyContext {
  /** The approver's uid — the member whose approval paired this kiosk. */
  uid: string;
  /** Everybody registered is checked in against it. */
  eventId: string;
}

export interface RegisterFamilyOptions {
  db: FirestoreLike;
  request: ParsedRegistration;
  context: RegisterFamilyContext;
  now?: Date;
  logger?: FunctionLogger;
}

/**
 * Which of the claimed siblings are real, active students.
 *
 * The kiosk resolves a family from the last-4 it searched with and sends the
 * ids; this is what stops that being a free assertion. It cannot check that the
 * person typing belongs to the family — the four digits are the only credential
 * and they are a weak one — but it can refuse ids that name nothing, which is
 * the difference between a claim about a real family and a claim about an
 * arbitrary document.
 *
 * A claim that survives here is still only used at approval time, where a
 * person sees it: "this child says they belong to the Okonkwo family" is shown,
 * not obeyed.
 */
async function verifyAnchors(db: FirestoreLike, ids: readonly string[]): Promise<string[]> {
  const verified: string[] = [];
  for (const id of ids) {
    const snapshot = await db.doc(`${PATHS.students}/${id}`).get();
    if (!snapshot.exists) continue;
    if ((snapshot.data() ?? {}).status === 'inactive') continue;
    verified.push(id);
  }
  return verified;
}

/**
 * Puts a family on the roster, checks them in when there is a gathering to
 * check them into, and makes their phone number work at the kiosk before they
 * have walked back to it.
 *
 * Everything here is Tally's own. Nothing reaches the church's people database:
 * each child is written `pendingReview: true`, which every push path consults
 * (`backends/pendingReview.ts`), and `approveRegistration` is what releases
 * them — in the right order, with one household for the whole family, with a
 * person looking at the screen.
 *
 * The order below is chosen so that the irreversible half happens after every
 * refusal and the fallible half after everything the family can see. Firestore
 * first: once the batch commits, the children are on the roster and the tick
 * can go on screen. The phone index patch and the duplicate scan follow, and
 * neither can fail a registration a parent has already been told succeeded —
 * a missed index patch costs the family nothing (the kiosk they are standing at
 * already holds the answer locally, and the nightly rebuild folds the overlay
 * in), and a missed duplicate scan costs a reviewer a hint, not a decision.
 */
export async function registerFamily(
  options: RegisterFamilyOptions,
): Promise<RegisterFamilyResult> {
  const { db, request, context } = options;
  const now = options.now ?? new Date();
  const logger = options.logger ?? SILENT_LOGGER;

  const event = await readEvent(db, context.eventId);
  const createdBy = context.uid;
  const anchorStudentIds = await verifyAnchors(db, request.anchorStudentIds);
  if (request.guardian === null && anchorStudentIds.length === 0) {
    /*
     * Every claimed sibling turned out to be nobody. The request was a sibling
     * registration and there is no family to attach to, so it is a first-time
     * registration with the adult's questions missing — which cannot be filled
     * in from here.
     */
    refuse('We could not find that family. Please register as a new family, or see a leader.');
  }

  /*
   * The digits the family types at the kiosk.
   *
   * From the adult's number when there is one; otherwise read back out of the
   * index from the siblings — never from the request, which would let a client
   * file a child under any four digits it liked. See `last4ForStudents`.
   */
  const last4List =
    request.guardian !== null
      ? [request.guardian.phone.slice(-4)]
      : await last4ForStudents(db, anchorStudentIds);
  const last4 = last4List[0] ?? '';

  /* ---- The claim ---------------------------------------------------------- */

  /*
   * First, before anything reads the roster.
   *
   * A retry of a successful call has to be recognised as a retry before
   * anything else happens, or it re-does work that is not idempotent. The
   * pre-allocated student ids are what make the rest of this function safe to
   * run twice: every write below is keyed by them.
   */
  const registrationRef = db.doc(`${REGISTRATIONS_COLLECTION}/${request.registrationId}`);
  let studentIds: string[];
  let replaying = false;

  const pending = {
    status: 'pending' as const,
    source: 'kiosk' as const,
    eventId: event?.id ?? null,
    childCount: request.children.length,
    last4,
    // Tied to the event actually read, not asserted: a kiosk registration is
    // made by a family standing at the door, and the attendance rows below
    // are written under the same condition.
    checkedIn: event !== null,
    createdAt: Timestamp.fromDate(now),
    /*
     * The review record's half. Written with the claim rather than at the end,
     * so that a request which dies after the batch commits still leaves a
     * reviewer something to act on: children held on the roster with no name
     * against them and no way to reach the family would be the worst of both.
     */
    guardian: request.guardian,
    children: request.children,
    allergies: request.allergies,
    anchorStudentIds,
    possibleDuplicateOf: {},
    lastError: null,
    lastErrorKind: null,
  };

  try {
    studentIds = request.children.map(() => db.collection(PATHS.students).doc().id);
    await registrationRef.create({ ...pending, studentIds });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    /*
     * Somebody has been here before — the same wizard run, retrying after a
     * response it never saw. A completed one is answered from what it wrote; a
     * pending one is resumed against the ids it already allocated.
     */
    replaying = true;
    const held = readRegistration((await registrationRef.get()).data() ?? {});
    if (held.childCount !== request.children.length) {
      refuse('That registration was for a different family.');
    }
    studentIds = held.studentIds;
    if (held.status === 'complete') {
      return {
        status: 'created',
        children: request.children.map((child, index) => ({
          studentId: studentIds[index]!,
          firstName: child.firstName,
          lastName: child.lastName,
          grade: child.grade,
          searchName: buildSearchName(child.firstName, child.lastName),
          // From the record, not the request: the replay answers with what
          // was actually kept, and both were parsed from the same body.
          hasAllergies: (held.allergies[index] ?? null) !== null,
        })),
        last4: held.last4 || last4,
        checkedIn: held.checkedIn,
      };
    }
  }

  /* ---- The roster, and the register --------------------------------------- */

  const children: RegisteredChild[] = request.children.map((child, index) => ({
    studentId: studentIds[index]!,
    firstName: child.firstName,
    lastName: child.lastName,
    grade: child.grade,
    searchName: buildSearchName(child.firstName, child.lastName),
    hasAllergies: (request.allergies[index] ?? null) !== null,
  }));

  const batch = db.batch();
  const at = Timestamp.fromDate(now);
  for (const child of children) {
    const ref: DocumentRefLike = db.doc(`${PATHS.students}/${child.studentId}`);
    batch.set(ref, {
      firstName: child.firstName,
      lastName: child.lastName,
      // Omitted rather than zeroed — a child too young for a grade has none.
      ...(child.grade === null ? {} : { grade: child.grade }),
      notes: null,
      status: 'active',
      // The yellow "Missing Info" badge, and the dashboard's first-timer list.
      // A family who typed their own names in has told us less than a leader
      // would have, not more.
      isVisitor: true,
      searchName: child.searchName,
      firstAttendedAt: event?.startAt ?? null,
      lastAttendedAt: event?.startAt ?? null,
      pcoPersonId: null,
      upstreamPushPending: true,
      /*
       * The hold. Nothing pushes this child anywhere until a reviewer clears
       * it — see backends/pendingReview.ts. `upstreamPushPending` stays true
       * alongside it because the child genuinely is queued; what the hold adds
       * is that the queue does not drain on its own.
       */
      pendingReview: true,
      // Provenance, and nothing more. It used to double as the push gate,
      // which is what `pendingReview` is for now; keeping it means a reviewer
      // and a support question can both get from a student back to the form
      // they were typed on.
      registrationId: request.registrationId,
      createdAt: at,
      updatedAt: at,
      createdBy,
      updatedBy: createdBy,
    });
    if (event) {
      batch.set(db.doc(`events/${event.id}/attendance/${child.studentId}`), {
        studentId: child.studentId,
        eventId: event.id,
        seriesId: event.seriesId,
        checkedInAt: at,
        checkedInBy: createdBy,
        method: 'kiosk',
        isFirstEver: true,
        /*
         * One registration is one arrival, by definition — these children were
         * typed into the same form and walked through the same door together,
         * which is a stronger statement than anything the kiosk's confirm
         * button makes. The registration's own id is already unique and
         * already on every child's document as provenance, so it is the
         * arrival: minting a second id would only invite the two to disagree.
         *
         * Without this the clearest "arrived together" there is — a family who
         * registered two children in one form — would come back at pickup time
         * with no arrival on file and fall through to the four-digit guess.
         */
        arrivalId: request.registrationId,
      });
    }
  }
  await batch.commit();

  /* ---- Findable by phone, now --------------------------------------------- */

  try {
    if (last4 === '') {
      /*
       * A sibling registration whose family is in no index bucket at all —
       * their household number never reached a backend and no overlay entry
       * survives. Nothing to patch; the child is still on the roster and still
       * checked in, and the family finds them by name until somebody reviews.
       */
      logger.warn('No phone digits found for a sibling registration; the index is unchanged', {
        registrationId: request.registrationId,
      });
    } else {
      await recordPendingLast4(
        db,
        { registrationId: request.registrationId, last4, studentIds },
        now,
      );
      // Every bucket the family already answers to, not only the first — a
      // household with two numbers on file must not start answering to one.
      for (const digits of last4List) await patchPhonesNow(db, digits, studentIds);
    }
  } catch (error) {
    // The nightly rebuild picks the overlay up either way; what is lost is only
    // the immediacy, and the family is standing at a kiosk that already holds
    // the answer locally.
    logger.warn('Could not patch the kiosk phone index for a registration', {
      registrationId: request.registrationId,
      error: String(error),
    });
  }

  /*
   * Tell the other kiosks. Outside the try above on purpose: a failed phone
   * patch is exactly when the roster half of the signal matters most.
   */
  const bumped: PulseChannel[] = ['roster'];
  if (last4 !== '') bumped.push('phones');
  await bumpPulse(db, bumped, now, { logger });

  /* ---- What a reviewer will want to know ---------------------------------- */

  /*
   * After the commit, deliberately. The scan reads the whole students
   * collection, so it would see this request's own children and report them as
   * duplicates of themselves — hence `excludeStudentIds`. Running it before the
   * commit would avoid that and cost the family the wait, which is the trade
   * the old refusal made and the reason it sat on the critical path.
   */
  let possibleDuplicateOf: Record<string, string[]> = {};
  try {
    possibleDuplicateOf = await findRosterDuplicates(db, request.children, {
      excludeStudentIds: studentIds,
    });
  } catch (error) {
    logger.warn('Could not scan for possible duplicates; the review record has none', {
      registrationId: request.registrationId,
      error: String(error),
    });
  }

  await registrationRef.set(
    {
      status: 'complete',
      studentIds,
      possibleDuplicateOf,
      completedAt: Timestamp.fromDate(now),
    },
    { merge: true },
  );
  if (!replaying) await sweepRegistrations(db, now);

  // Counts and ids. The guardian's name and number are on the document this
  // line is about; they are not going into a log as well.
  logger.info('Registered a family at the kiosk; held for review', {
    registrationId: request.registrationId,
    children: children.length,
    checkedIn: event !== null,
    siblingsClaimed: anchorStudentIds.length,
    possibleDuplicates: Object.keys(possibleDuplicateOf).length,
  });

  return {
    status: 'created',
    children,
    last4,
    checkedIn: event !== null,
  };
}
