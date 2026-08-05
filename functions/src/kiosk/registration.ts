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
 * create a student carrying `status`, `isVisitor` or `pcoPushPending` — and a
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
 * What it will not do is decide who somebody is. Upstream duplicate handling is
 * `pushStudent`'s exact first+last+grade match, and the guardian join is
 * corroborated by a phone number — anything less certain creates a fresh
 * person, because the alternative on a self-serve screen is showing one family
 * another family's contact details. Duplicates are a merge somebody does by
 * hand later; a wrong join is a privacy incident.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { BackendRegistry } from '../backends/registry.js';
import { buildSearchName } from '../backends/mappingShared.js';
import {
  PATHS,
  SILENT_LOGGER,
  toDateOrNull,
  type DocumentRefLike,
  type FirestoreLike,
  type FunctionLogger,
} from '../firestore.js';
import { patchPhonesNow, recordPendingLast4 } from './phoneIndex.js';

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

/** Only used in code mode; never stored in Firestore, only sent upstream. */
export const ALLERGIES_MAX_LENGTH = 200;

/**
 * How long a registration document is kept before the sweep takes it.
 *
 * It exists only to make a retry idempotent, and a retry happens within seconds
 * of the original — a day is generous by three orders of magnitude and keeps
 * the collection small enough to sweep by reading it.
 */
export const REGISTRATION_DOC_TTL_MS = 24 * 60 * 60_000;

/** `createdBy` for a registration nobody was signed in for. */
export const REMOTE_REGISTRATION_SENTINEL = 'kiosk-registration';

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
  guardian: RegistrationGuardian;
  /** Index-aligned with `children`. Empty outside code mode. */
  allergies: (string | null)[];
}

export type RegistrationSource = 'kiosk' | 'qr';

export interface RegisteredChild {
  studentId: string;
  firstName: string;
  lastName: string;
  grade: number | null;
  searchName: string;
}

export type GuardianUpstream = 'created' | 'joined' | 'skipped' | 'failed';

export type RegisterFamilyResult =
  | {
      status: 'created';
      children: RegisteredChild[];
      /** The digits the family types at the kiosk from now on. */
      last4: string;
      checkedIn: boolean;
      guardian: { upstream: GuardianUpstream };
    }
  | {
      status: 'duplicate';
      /** Which of the submitted children are already on the roster. */
      duplicateIndexes: number[];
      message: string;
    };

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
 * `allergies` is refused outside code mode rather than ignored: the kiosk has
 * no field for it and never will — a lobby screen does not display a child's
 * medical notes, so it does not collect them either — and a request carrying
 * them is a client doing something this flow has not agreed to.
 */
export function parseRegisterFamilyRequest(
  data: unknown,
  source: RegistrationSource,
): ParsedRegistration {
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

  const rawGuardian = (body.guardian ?? {}) as Record<string, unknown>;
  const guardian: RegistrationGuardian = {
    firstName: parseName(rawGuardian.firstName, "The parent's first name"),
    lastName: parseName(rawGuardian.lastName, "The parent's last name"),
    phone: parseRegistrationPhone(rawGuardian.phone),
  };

  if (source !== 'qr' && body.allergies !== undefined) {
    refuse('allergies cannot be registered from the kiosk.');
  }

  return {
    registrationId,
    children,
    guardian,
    allergies: source === 'qr' ? parseAllergies(body.allergies, children.length) : [],
  };
}

/* -------------------------------------------------------------------------- */
/* The registration document — idempotency, and nothing else                   */
/* -------------------------------------------------------------------------- */

/**
 * What survives a request, so a retry cannot create a second family.
 *
 * Deliberately not the request: no names, no phone number, no allergies. A
 * retry re-sends all of that, and a collection of half-finished registrations
 * is not a place to accumulate what the rest of the database refuses to hold.
 * What is here is the pre-allocated student ids — the reason a replay is safe,
 * since every write downstream is keyed by them — plus enough to answer a
 * completed call again.
 */
interface RegistrationRecord {
  status: 'pending' | 'complete';
  source: RegistrationSource;
  eventId: string | null;
  studentIds: string[];
  childCount: number;
  last4: string;
  checkedIn: boolean;
  createdAt: Date | null;
}

function readRegistration(data: Record<string, unknown>): RegistrationRecord {
  const ids = Array.isArray(data.studentIds)
    ? data.studentIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    status: data.status === 'complete' ? 'complete' : 'pending',
    source: data.source === 'qr' ? 'qr' : 'kiosk',
    eventId: typeof data.eventId === 'string' ? data.eventId : null,
    studentIds: ids,
    childCount: typeof data.childCount === 'number' ? data.childCount : ids.length,
    last4: typeof data.last4 === 'string' ? data.last4 : '',
    checkedIn: data.checkedIn === true,
    createdAt: toDateOrNull(data.createdAt),
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
async function sweepRegistrations(db: FirestoreLike, now: Date): Promise<void> {
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
/* The already-on-the-roster guard                                             */
/* -------------------------------------------------------------------------- */

/**
 * Which of these children are already on the roster, by exact name.
 *
 * Name-only, and against active students only. Grade is deliberately not part
 * of the key: the remedy this produces is "search for them on the kiosk", which
 * works whatever grade the office recorded, and a family who moved up a year
 * would otherwise register a second copy of their own child.
 *
 * It is enumeration-safe in the sense that matters: the answer reveals only
 * whether a name the caller themselves typed is on the roster, which is exactly
 * what the kiosk's public name search already answers, one keystroke at a time.
 */
export async function findRosterDuplicates(
  db: FirestoreLike,
  children: readonly RegistrationChild[],
): Promise<number[]> {
  const wanted = new Map<string, number[]>();
  children.forEach((child, index) => {
    const key = buildSearchName(child.firstName, child.lastName);
    const bucket = wanted.get(key);
    if (bucket) bucket.push(index);
    else wanted.set(key, [index]);
  });

  const snapshot = await db.collection(PATHS.students).get();
  const hits = new Set<number>();
  for (const doc of snapshot.docs) {
    const data = doc.data() ?? {};
    if (data.status === 'inactive') continue;
    const searchName =
      typeof data.searchName === 'string'
        ? data.searchName
        : typeof data.firstName === 'string' && typeof data.lastName === 'string'
          ? buildSearchName(data.firstName, data.lastName)
          : null;
    if (searchName === null) continue;
    for (const index of wanted.get(searchName) ?? []) hits.add(index);
  }
  return [...hits].sort((a, b) => a - b);
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
  source: RegistrationSource;
  /** The approver's uid, in kiosk mode. Absent for a remote registration. */
  uid?: string;
  /** Required in kiosk mode; everybody registered is checked in against it. */
  eventId?: string;
}

export interface RegisterFamilyOptions {
  db: FirestoreLike;
  registry: BackendRegistry;
  request: ParsedRegistration;
  context: RegisterFamilyContext;
  now?: Date;
  logger?: FunctionLogger;
}

/**
 * Creates a family, checks them in when there is a gathering to check them into,
 * and makes their phone number work at the kiosk before they have walked back
 * to it.
 *
 * The order is chosen so that the irreversible half happens after every refusal
 * and the fallible half after everything the family can see. Firestore first:
 * once the batch commits, the children are on the roster and the tick can go on
 * screen. Everything after it — the phone index patch, the pushes upstream, the
 * household — is best-effort, logged, and never able to fail the registration a
 * parent has already been told succeeded. A push that does not land leaves
 * `pcoPushPending` set, which is exactly the state `pushPendingVisitors` sweeps.
 */
export async function registerFamily(
  options: RegisterFamilyOptions,
): Promise<RegisterFamilyResult> {
  const { db, registry, request, context } = options;
  const now = options.now ?? new Date();
  const logger = options.logger ?? SILENT_LOGGER;

  const event =
    context.source === 'kiosk'
      ? await readEvent(db, context.eventId ?? refuse('eventId is required.'))
      : null;
  const createdBy = context.uid ?? REMOTE_REGISTRATION_SENTINEL;
  const last4 = request.guardian.phone.slice(-4);

  /* ---- The claim ---------------------------------------------------------- */

  /*
   * Before the duplicate guard, not after it.
   *
   * The obvious order is to check the roster first and never write anything for
   * a family who are already on it — but a *retry* of a successful call would
   * then find the children this same request created a second ago and report
   * them as duplicates of themselves. The claim has to be what a second call
   * hits first, so that a retry is recognised as a retry before anything else
   * looks at the roster. A fresh claim that turns out to be a duplicate is
   * released below, so the "writes nothing" property survives.
   */
  const registrationRef = db.doc(`${REGISTRATIONS_COLLECTION}/${request.registrationId}`);
  let studentIds: string[];
  let replaying = false;

  const pending = {
    status: 'pending' as const,
    source: context.source,
    eventId: event?.id ?? null,
    childCount: request.children.length,
    last4,
    checkedIn: event !== null,
    createdAt: Timestamp.fromDate(now),
  };

  try {
    studentIds = request.children.map(() => db.collection(PATHS.students).doc().id);
    await registrationRef.create({ ...pending, studentIds });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    /*
     * Somebody has been here before — the same wizard run, retrying after a
     * response it never saw. A completed one is answered from what it wrote; a
     * pending one is resumed against the ids it already allocated, which is
     * what makes every write below idempotent rather than merely repeated.
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
        })),
        last4: held.last4 || last4,
        checkedIn: held.checkedIn,
        guardian: { upstream: 'skipped' },
      };
    }
  }

  /* ---- Already here? ------------------------------------------------------ */

  /*
   * Only for a registration nobody has run before. A resumed one has already
   * passed this, and its own half-written children would fail it.
   */
  if (!replaying) {
    const duplicates = await findRosterDuplicates(db, request.children);
    if (duplicates.length > 0) {
      // Released, so the family can correct the name and try again under a new
      // id — and so a refusal leaves nothing behind.
      await registrationRef.delete();
      await sweepRegistrations(db, now);
      const names = duplicates.map((index) => request.children[index]!.firstName).join(' and ');
      return {
        status: 'duplicate',
        duplicateIndexes: duplicates,
        message:
          duplicates.length === request.children.length
            ? `${names} is already on our list — search for their name instead.`
            : `${names} is already on our list. Search for them, and register the others separately.`,
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
      pcoPushPending: true,
      // What tells `onStudentCreated` to leave this one alone: the push happens
      // below, in this request, where it can be sequenced against the household
      // write. Two pushes racing would both pass `findExistingPerson` and create
      // two upstream people for one child.
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
      });
    }
  }
  await batch.commit();

  /* ---- Findable by phone, now --------------------------------------------- */

  try {
    await recordPendingLast4(
      db,
      { registrationId: request.registrationId, last4, studentIds },
      now,
    );
    await patchPhonesNow(db, last4, studentIds);
  } catch (error) {
    // The nightly rebuild picks the overlay up either way; what is lost is only
    // the immediacy, and the family is standing at a kiosk that already holds
    // the answer locally.
    logger.warn('Could not patch the kiosk phone index for a registration', {
      registrationId: request.registrationId,
      error: String(error),
    });
  }

  /* ---- Upstream ----------------------------------------------------------- */

  const guardianUpstream = await pushUpstream({
    registry,
    request,
    children,
    logger,
  });

  await registrationRef.set(
    { status: 'complete', studentIds, completedAt: Timestamp.fromDate(now) },
    { merge: true },
  );
  if (!replaying) await sweepRegistrations(db, now);

  logger.info('Registered a family at the kiosk', {
    registrationId: request.registrationId,
    source: context.source,
    children: children.length,
    checkedIn: event !== null,
    guardian: guardianUpstream,
  });

  return {
    status: 'created',
    children,
    last4,
    checkedIn: event !== null,
    guardian: { upstream: guardianUpstream },
  };
}

/**
 * Everything that happens in the church's own database, and none of it fatal.
 *
 * The ladder is the deployment's write-back mode, not a preference:
 *
 *   - **full** — the children become people upstream and the adult becomes a
 *     person in a household with them, carrying the phone number.
 *   - **create** — the children become people; there is no household write to
 *     make, so the parent's name is dropped and their number survives only as
 *     the four digits in the kiosk index. Dropping it is the honest option:
 *     `noMirroredPersonalData` forbids a parent's name on a student document,
 *     and a notes field holding it would be that mirror rebuilt one string at a
 *     time on every counselor's screen. The incomplete-profile list is where a
 *     leader picks this up.
 *   - **off, or no backend at all** — the children stay queued in Firestore,
 *     which is what `pcoPushPending` is for.
 */
async function pushUpstream(args: {
  registry: BackendRegistry;
  request: ParsedRegistration;
  children: readonly RegisteredChild[];
  logger: FunctionLogger;
}): Promise<GuardianUpstream> {
  const { registry, request, children, logger } = args;

  const target = registry.defaultPush();
  if ('error' in target) return 'skipped';
  const backend = target.backend;
  if (backend.capabilities.writeBack === 'off') return 'skipped';

  let pushed = 0;
  for (const child of children) {
    try {
      const result = await backend.pushStudent({ studentId: child.studentId, logger });
      if (result.status !== 'skipped') pushed += 1;
    } catch (error) {
      logger.warn('Could not push a registered child upstream; it stays queued', {
        studentId: child.studentId,
        error: String(error),
      });
    }
  }
  if (pushed > 0) backend.resetCache();

  /* ---- Allergies, where they belong --------------------------------------- */

  if (backend.capabilities.writeBack === 'full') {
    for (const [index, allergies] of request.allergies.entries()) {
      if (!allergies) continue;
      const child = children[index];
      if (!child) continue;
      try {
        await backend.updateStudentProfile({ studentId: child.studentId, allergies, logger });
      } catch (error) {
        logger.warn('Could not record allergies upstream', {
          studentId: child.studentId,
          error: String(error),
        });
      }
    }
  }

  /* ---- The adult ---------------------------------------------------------- */

  if (!backend.capabilities.parentCreatable || !backend.createFamily) return 'skipped';

  try {
    const family = await backend.createFamily({
      studentIds: children.map((child) => child.studentId),
      firstName: request.guardian.firstName,
      lastName: request.guardian.lastName,
      phone: request.guardian.phone,
      logger,
    });
    backend.invalidateReachability();
    if (family.status === 'created') return 'created';
    if (family.status === 'joined' || family.status === 'already-has-family') return 'joined';
    return 'skipped';
  } catch (error) {
    logger.warn('Could not create the family upstream', {
      children: children.length,
      error: String(error),
    });
    return 'failed';
  }
}
