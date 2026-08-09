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
import type { AdultCandidate, CreateFamilyResult } from '../backends/types.js';
import { PATHS, SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import { parseStudentId, type BackendId } from '../generated/backendIds.js';
import { PHONE_INDEX_DOC } from './phoneIndex.js';
import { bumpPulse } from './pulse.js';
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
  /**
   * Whether this roster row already answers to the family's four digits.
   *
   * The merge decision is the one call on this screen with a right answer, and
   * a name and a grade are often not enough to make it: two children can share
   * both, and one child's grade rolls over between terms, so "Elena Salgado ·
   * 8th grade" against an incoming "Elena Salgado · 7th grade" is either the
   * same girl a year later or a different girl, and the screen could not say
   * which. The phone index can: if the church already finds this row under the
   * number the family just typed, they are almost certainly the same household.
   *
   * A fact about the guardian's record rather than a new fact about a child —
   * the kiosk has searched on exactly these digits since it shipped — and it
   * never *decides*, it only tells the reviewer which row to look at first.
   */
  sharesFamilyDigits: boolean;
}

/** One child of one registration, as typed and as it landed. */
export interface PendingRegistrationChild extends RegistrationChild {
  /** Null when the batch never committed — a registration that died mid-write. */
  studentId: string | null;
  /** Whether the student document is still held. */
  pendingReview: boolean;
  /** Set once a reviewer folded this child into a row that was already there. */
  mergedIntoStudentId: string | null;
  /**
   * *Who* they were folded into, named.
   *
   * Resolved here rather than inferred on the screen from this child's
   * duplicate hints, because a merge is not always made through those: a
   * reviewer can fold a row from the directory, and a "wrong person" correction
   * names somebody the hints never carried. The screen was left printing
   * "merged into a row on the roster", which is a sentence that names nobody
   * to a reviewer whose next press bakes the association into a push with no
   * delete.
   */
  mergedInto: ReviewStudentSummary | null;
  /** From the wizard's allergies question, or a legacy phone-form record. */
  allergies: string | null;
  /** Active students who already have this name. Suspicion, not a verdict. */
  possibleDuplicates: ReviewStudentSummary[];
}

/**
 * Another family on this same screen who typed the same phone number.
 *
 * The evidence for "these two cards are one household", offered rather than
 * acted on. Two registrations in one queue sharing a number is nearly always a
 * family who came back — a second child, a second visit, a form filled in twice
 * — and until now nothing on this screen said so: a reviewer approved them one
 * at a time, and the backend, which by then could only see one adult with a
 * matching number, deduplicated the *parent* and built a second household
 * around them. One adult, two families, in a database with no merge for
 * households.
 *
 * Named rather than counted, because the reviewer has to be able to tell which
 * card it means when three are on screen.
 */
export interface SameFamilyHint {
  registrationId: string;
  guardianName: string;
  /** Their children, so a reviewer can see it is a sibling and not a repeat. */
  childNames: string[];
  registeredAt: number | null;
  /**
   * How many of their children are still waiting on a name collision.
   *
   * The approve button on a card is held until every child of *that* card is
   * settled, and approving as a group would otherwise reach around it: a child
   * whose own card is greyed out gets pushed for ever by a press on their
   * sibling's. Carried per hint so the group control can be held for the same
   * reason the button is, and say whose row is holding it.
   */
  unsettledChildren: number;
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
  /**
   * Adults the backend already has under the guardian's name.
   *
   * The decision `createFamily` otherwise makes alone, brought forward to the
   * person who can actually make it. A candidate whose `corroborated` is true
   * is the one the backend would have picked by itself; the rest are the ones
   * it would have walked past, and a reviewer looking at a name, a phone number
   * and a list of that adult's own children can answer for them.
   *
   * Empty is not "there is nobody" — it is also "the backend takes no writes",
   * "this deployment cannot build families", and "Planning Center did not
   * answer". A screen must not read it as evidence that the guardian is new.
   */
  guardianCandidates: AdultCandidate[];
  /** Other pending registrations that typed this family's phone number. */
  sameFamily: SameFamilyHint[];
  /** Whether every child has already been approved and pushed. */
  settled: boolean;
  /** Why the last approval did not finish, if one did not. */
  lastError: string | null;
  /**
   * *Which half* did not finish, so a screen can offer the move that fits.
   *
   * A prose reason cannot be branched on, and the two halves want opposite
   * instruments: children the backend refused are worth retrying, because the
   * usual cause is an outage that has since passed. An adult it refused is
   * usually refused for a reason no retry can fix — a number it already holds
   * for somebody outside this household — and the move that ends the job is to
   * finish without them. Offering "try again" for that is how a record reaches
   * its thirtieth day still holding a phone number.
   *
   * Null when nothing has failed, `'children'`, `'guardian'`, or `'both'`.
   */
  lastErrorKind: 'children' | 'guardian' | 'both' | null;
}

/**
 * Names the roster rows whose names live in a backend rather than here.
 *
 * A student linked to Planning Center or Attendees keeps their name upstream,
 * so `summarise` below can only answer "a student on the roster" for them. That
 * was survivable while the duplicate candidates sat behind a click and became a
 * defect the moment they were listed side by side: a reviewer asked "which of
 * these is the same child?" cannot answer when one option has no name, and the
 * wrong answer is a permanent duplicate in a database with no delete.
 *
 * One batched read per backend, and every failure is silent — an unreachable
 * Planning Center leaves the labels exactly as they were, which is the same
 * degraded-but-honest screen this shipped with.
 */
async function namesFromBackends(
  registry: BackendRegistry | undefined,
  summaries: ReviewStudentSummary[],
  logger: FunctionLogger,
): Promise<void> {
  if (!registry) return;
  const wanted = summaries.filter((summary) => !summary.known);
  if (wanted.length === 0) return;

  const byBackend = new Map<BackendId, Map<string, ReviewStudentSummary[]>>();
  for (const summary of wanted) {
    const parsed = parseStudentId(summary.studentId);
    if (!parsed) continue;
    const forBackend = byBackend.get(parsed.backendId) ?? new Map();
    forBackend.set(parsed.personId, [...(forBackend.get(parsed.personId) ?? []), summary]);
    byBackend.set(parsed.backendId, forBackend);
  }

  for (const [backendId, wantedFromIt] of byBackend) {
    const backend = registry.get(backendId);
    if (!backend) continue;
    try {
      const result = await backend.fetchRoster({ personIds: [...wantedFromIt.keys()] });
      for (const person of result.people) {
        for (const summary of wantedFromIt.get(person.pcoPersonId) ?? []) {
          summary.firstName = person.firstName;
          summary.lastName = person.lastName;
          summary.grade = person.grade;
          summary.known = person.firstName.length > 0 || person.lastName.length > 0;
        }
      }
    } catch (error) {
      logger.warn('Could not name a duplicate candidate from its backend', {
        backendId,
        error: String(error),
      });
    }
  }
}

/**
 * The roster rows the church already finds under one set of four digits.
 *
 * Read once per call rather than per candidate: `kioskIndex/phones` is a single
 * document holding the whole map, and a queue of a dozen families would
 * otherwise re-read it thirty times. An unreadable index is simply no signal —
 * every candidate reports `sharesFamilyDigits: false` and the screen is exactly
 * what it was before this existed.
 */
async function rowsUnderDigits(db: FirestoreLike, logger: FunctionLogger): Promise<Record<string, Set<string>>> {
  try {
    const snapshot = await db.doc(PHONE_INDEX_DOC).get();
    const last4 = (snapshot.exists ? (snapshot.data() ?? {}) : {}).last4;
    if (typeof last4 !== 'object' || last4 === null) return {};
    return Object.fromEntries(
      Object.entries(last4 as Record<string, unknown>).map(([digits, ids]) => [
        digits,
        new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []),
      ]),
    );
  } catch (error) {
    logger.warn('Could not read the phone index while listing registrations', {
      error: String(error),
    });
    return {};
  }
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
    // Filled in by the caller, which holds the digits and the index.
    sharesFamilyDigits: false,
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
  options: { registry?: BackendRegistry; logger?: FunctionLogger } = {},
): Promise<PendingRegistration[]> {
  const logger = options.logger ?? SILENT_LOGGER;
  const underDigits = await rowsUnderDigits(db, logger);
  const snapshot = await db.collection(REGISTRATIONS_COLLECTION).get();
  const rows: PendingRegistration[] = [];
  /** Children who already reached the backend, so nobody is offered as their own parent. */
  const upstreamByRegistration = new Map<string, string[]>();

  for (const doc of snapshot.docs) {
    const record = readRegistration(doc.data() ?? {});

    const students = await Promise.all(
      record.studentIds.map(async (studentId) => {
        const held = await db.doc(`${PATHS.students}/${studentId}`).get();
        return { studentId, exists: held.exists, data: held.data() ?? {} };
      }),
    );
    upstreamByRegistration.set(
      doc.id,
      students
        .map((student) => student.data.upstreamPersonId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
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
          mergedInto:
            typeof student?.data.mergedIntoStudentId === 'string'
              ? await summarise(db, student.data.mergedIntoStudentId)
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
      guardianCandidates: [],
      sameFamily: [],
      settled: children.length > 0 && children.every((child) => !child.pendingReview),
      lastError: record.lastError,
      lastErrorKind: record.lastErrorKind,
    });
  }

  /*
   * One pass over every summary on the page, after they are all built.
   *
   * Batched deliberately: a reviewer's queue can hold a dozen families whose
   * duplicate hints all point at backend-linked rows, and asking the backend
   * once per candidate would be a page load that walks Planning Center's rate
   * limit. Mutates the summaries in place because they are this call's own
   * objects and nothing else has seen them yet.
   */
  await namesFromBackends(
    options.registry,
    rows.flatMap((row) => [
      ...row.anchors,
      ...row.children.flatMap((child) => [
        ...child.possibleDuplicates,
        ...(child.mergedInto ? [child.mergedInto] : []),
      ]),
    ]),
    logger,
  );

  /*
   * Which candidates the church already finds under this family's own digits.
   *
   * The strongest evidence the screen can offer for "these two rows are one
   * child", and it is evidence rather than a verdict: the reviewer still
   * chooses. Anchors are deliberately left alone — a verified sibling is not a
   * duplicate, and marking them would put a hint on a row nobody is judging.
   */
  for (const row of rows) {
    const family = underDigits[row.last4];
    if (!family) continue;
    for (const child of row.children) {
      for (const candidate of child.possibleDuplicates) {
        candidate.sharesFamilyDigits = family.has(candidate.studentId);
      }
    }
  }

  linkSameFamily(rows);
  await namesFromUpstream(options.registry, rows, upstreamByRegistration, logger);

  return rows.sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
}

/**
 * Ties together the registrations that typed the same number.
 *
 * Whole digits rather than the four the kiosk indexes on: `last4` is a bucket
 * a hundred families share in a large church, and a hint that says "this may be
 * the same household as the Nguyens" had better not be founded on a one-in-ten-
 * thousand coincidence. The last ten, so `+1 (555) 010-3344` and `5550103344`
 * are one number — the same rule the backends compare on.
 *
 * Symmetric, so both cards carry it: a reviewer works down the queue from the
 * top and the pair has to be visible from whichever they reach first.
 */
function linkSameFamily(rows: PendingRegistration[]): void {
  const digitsOf = (phone: string): string => {
    const digits = phone.replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  };

  const byDigits = new Map<string, PendingRegistration[]>();
  for (const row of rows) {
    if (row.guardian === null || row.settled) continue;
    const digits = digitsOf(row.guardian.phone);
    if (digits.length === 0) continue;
    byDigits.set(digits, [...(byDigits.get(digits) ?? []), row]);
  }

  for (const group of byDigits.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.sameFamily = group
        .filter((other) => other.registrationId !== row.registrationId)
        .map((other) => ({
          registrationId: other.registrationId,
          guardianName: `${other.guardian?.firstName ?? ''} ${other.guardian?.lastName ?? ''}`.trim(),
          childNames: other.children.map((child) => `${child.firstName} ${child.lastName}`.trim()),
          registeredAt: other.registeredAt,
          unsettledChildren: other.children.filter(
            (child) =>
              child.pendingReview &&
              child.mergedIntoStudentId === null &&
              child.possibleDuplicates.length > 0,
          ).length,
        }));
    }
  }
}

/**
 * Who the backend already has under each guardian's name.
 *
 * One search per unreviewed family with a guardian, and deliberately not
 * cached: this is read at the moment somebody is about to write to the church's
 * database, and a stale answer here is the wrong household. Families sharing a
 * name and number are searched once and given the same answer, which is the
 * ordinary case on a screen holding a repeat registration.
 *
 * Every failure is silent and answers with nothing. A reviewer who cannot see
 * the candidates gets the screen exactly as it was before they existed — the
 * approve button still works, and the backend still makes its own careful guess
 * — where a thrown error would take the whole queue down over a read nobody
 * asked for.
 */
async function namesFromUpstream(
  registry: BackendRegistry | undefined,
  rows: PendingRegistration[],
  /** Registration id -> the backend ids its children already have, if any. */
  upstreamByRegistration: ReadonlyMap<string, string[]>,
  logger: FunctionLogger,
): Promise<void> {
  if (!registry) return;
  const target = registry.defaultPush();
  if ('error' in target) return;
  const backend = target.backend;
  if (backend.capabilities.writeBack !== 'full') return;
  const search = backend.findAdultCandidates;
  if (search === undefined) return;

  const asked = new Map<string, PendingRegistration[]>();
  for (const row of rows) {
    if (row.guardian === null || row.settled) continue;
    // Stringified rather than concatenated: "Ann Marie"/"Lee" and "Ann"/
    // "MarieLee" are two families, and joining them on nothing makes them one —
    // which would show the second card the first one's candidate list.
    const key = JSON.stringify([
      row.guardian.firstName,
      row.guardian.lastName,
      row.guardian.phone,
    ]);
    asked.set(key, [...(asked.get(key) ?? []), row]);
  }

  for (const group of asked.values()) {
    const guardian = group[0]!.guardian!;
    /*
     * The exclusions are pooled across the group rather than taken per card.
     *
     * Two registrations under one name and number are one family, so a child
     * who reached the backend on the first card's half-finished approval must
     * not be offered as the parent on the second — and they would be, if the
     * one answer this group shares were computed from one card's children.
     */
    const excludePersonIds = group.flatMap(
      (row) => upstreamByRegistration.get(row.registrationId) ?? [],
    );

    let candidates: AdultCandidate[] = [];
    try {
      candidates = await search.call(backend, {
        firstName: guardian.firstName,
        lastName: guardian.lastName,
        phone: guardian.phone,
        excludePersonIds,
        logger,
      });
    } catch (error) {
      logger.warn('Could not read adult candidates for a registration', {
        registrationId: group[0]!.registrationId,
        error: String(error),
      });
    }
    for (const row of group) row.guardianCandidates = candidates;
  }
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
 *
 * ## The dead end this used to have
 *
 * A guardian write can fail for a reason no retry can fix — commonly that the
 * number belongs to a person the backend already has, outside this household.
 * The record then survived for ever, offering a button that reattempted the
 * same refusal every time, and a reviewer's only alternative was **Not ours**,
 * which discards a family whose children may already be upstream where nothing
 * can delete them. Neither move ends the job, and the screen had no third.
 *
 * `withoutGuardian` is that third: push the children, deliberately skip the
 * adult, and let the record go. It is a decision rather than a retry — the
 * parent's name and number are lost with the record, which is the whole point
 * of taking it, so the caller is expected to have said so on screen first.
 *
 * ## What a reviewer may settle that the backend would otherwise guess
 *
 * Two decisions, both optional, both the same shape: the caller passes what a
 * person decided, and passing nothing leaves the backend exactly as careful as
 * it was.
 *
 * - `withRegistrationIds` approves several registrations as **one family** —
 *   every child in one push, one `createFamily`, one household. Two cards
 *   sharing a phone number are a family who came back, and approving them one
 *   at a time is what put one adult at the head of two households: the second
 *   approval resolved to the same parent and then built a household around
 *   children who had none, because the parent's own was never consulted. Both
 *   halves are now fixed — this one so the reviewer can say it, and the
 *   backends so the sweep gets it right when nobody does.
 * - `guardianPersonId` / `createNewGuardian` name the adult. The lobby has
 *   nobody to ask, so `createFamily` corroborates a name with a phone number
 *   and creates a fresh person for anything less; a reviewer on a Tuesday can
 *   see the candidates and answer properly — including "yes, that is her, she
 *   has changed her number", which no amount of matching will ever reach.
 */
export async function approveRegistration(options: {
  db: FirestoreLike;
  registry: BackendRegistry;
  registrationId: string;
  uid: string;
  /** Finish without the adult, for a household the backend will not build. */
  withoutGuardian?: boolean;
  /**
   * Other registrations that are the same family, approved along with this one.
   *
   * The guardian on *this* record is the one written; the others contribute
   * their children and their anchors. Ids the collection no longer holds are
   * skipped rather than refused — a reviewer's other tab may have dealt with
   * one already, and that is not a reason to strand this family.
   */
  withRegistrationIds?: readonly string[];
  /** The adult the reviewer picked from `guardianCandidates`. */
  guardianPersonId?: string | null;
  /** The reviewer saw the candidates and said none of them is the parent. */
  createNewGuardian?: boolean;
  now?: Date;
  logger?: FunctionLogger;
}): Promise<ApproveRegistrationResult> {
  const { db, registry, registrationId, uid } = options;
  const withoutGuardian = options.withoutGuardian === true;
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

  /* ---- Everything being approved together --------------------------------- */

  /*
   * The primary first, and the guardian only ever comes from it. The others
   * are here for their children and their anchors: a family is one adult with
   * one number, and picking which card's spelling of the name to write is not
   * a decision to make by iteration order.
   */
  const group = [{ id: registrationId, ref, record }];
  for (const otherId of options.withRegistrationIds ?? []) {
    if (otherId === registrationId || group.some((entry) => entry.id === otherId)) continue;
    const otherRef = db.doc(`${REGISTRATIONS_COLLECTION}/${otherId}`);
    const otherSnapshot = await otherRef.get();
    // Gone means somebody already dealt with it, which is not a reason to
    // strand the family in front of us.
    if (!otherSnapshot.exists) continue;
    group.push({
      id: otherId,
      ref: otherRef,
      record: readRegistration(otherSnapshot.data() ?? {}),
    });
  }

  /* ---- The hold comes off first ------------------------------------------- */

  const at = Timestamp.fromDate(now);
  const live: string[] = [];
  for (const entry of group) {
    for (const studentId of entry.record.studentIds) {
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
       * A child a reviewer already merged is pushed as the row that survived,
       * not as the row that lost.
       *
       * Getting this wrong is invisible and expensive: the fold document is
       * still named on this registration, and pushing it would create upstream
       * exactly the duplicate the merge was performed to avoid — permanently,
       * since there is no delete. Following the pointer instead also does
       * something useful, because the guardian's household is built around
       * whoever comes back from here: the adult ends up attached to the family
       * that was already on file.
       */
      const survivor = await followMerges(db, studentId);
      if (survivor !== null && !live.includes(survivor)) live.push(survivor);
    }
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
    for (const entry of group) await entry.ref.delete();
    logger.info('Approved a registration with nowhere to push it', {
      registrationId,
      registrations: group.length,
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
    for (const entry of group) {
      for (const [index, allergies] of entry.record.allergies.entries()) {
        const named = entry.record.studentIds[index];
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

  if (record.guardian && withoutGuardian) {
    /*
     * Asked for deliberately, so not attempted at all — and reported as its own
     * outcome rather than as `disabled`, which means "this deployment could
     * never". This one could have; a person decided it should not, and the
     * message says whose details are going nowhere so the sentence a reviewer
     * reads afterwards matches the sentence they agreed to.
     */
    guardian = 'skipped';
    guardianMessage = `Added the children only. ${record.guardian.firstName} ${record.guardian.lastName}'s details were not recorded in ${backend.displayName}, and the number is gone from Tally.`;
    logger.info('Approved a registration without its guardian, at a reviewer’s request', {
      registrationId,
      children: live.length,
    });
  } else if (record.guardian && buildFamily === undefined) {
    guardian = 'disabled';
    guardianMessage = `${backend.displayName} cannot take a parent's details from Tally, so ${record.guardian.firstName}'s name and number were not recorded there.`;
  } else if (record.guardian && buildFamily !== undefined) {
    try {
      const family = await buildFamily.call(backend, {
        studentIds: live,
        // Every card's siblings, deduplicated: the whole point of approving
        // together is that one household holds the lot.
        anchorStudentIds: [
          ...new Set(group.flatMap((entry) => entry.record.anchorStudentIds)),
        ],
        firstName: record.guardian.firstName,
        lastName: record.guardian.lastName,
        parentPersonId: options.guardianPersonId ?? null,
        createNewParent: options.createNewGuardian === true,
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
    guardian === 'disabled' ||
    // A guardian a reviewer chose to skip is settled by that choice. Holding
    // the record open would keep offering the retry they just declined, and
    // keep the number for thirty days to serve it.
    withoutGuardian;
  const unfinished = failed > 0 || (record.guardian !== null && !guardianSettled);

  /*
   * All or none of the group, and that is deliberate on both sides.
   *
   * They were approved as one family, so they succeed or fail as one: a
   * half-kept group would offer a retry that carries some of the children and
   * silently drops the rest, and a household built from what is left is exactly
   * the second family this whole change exists to stop. Keeping every record on
   * a failure costs a reviewer one more press — they say "same family" again —
   * and it is the press that keeps the retry honest.
   */
  if (unfinished) {
    const guardianFailed = record.guardian !== null && !guardianSettled;
    const lastError =
      guardianMessage ||
      `${failed} of ${live.length} children could not be added to ${backend.displayName}.`;
    const lastErrorKind =
      failed > 0 && guardianFailed ? 'both' : guardianFailed ? 'guardian' : 'children';
    for (const entry of group) {
      await entry.ref.set({ lastError, lastErrorKind, lastAttemptAt: at }, { merge: true });
    }
  } else {
    for (const entry of group) await entry.ref.delete();
  }

  logger.info('Reviewed a self-registration', {
    registrationId,
    registrations: group.length,
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
        upstreamPushPending: false,
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
  // A discarded child must stop being findable at the lobby within a poll, not
  // a six-hour TTL — the search would otherwise offer a check-in for a student
  // a reviewer just said was not real.
  if (deactivated > 0) await bumpPulse(db, ['roster'], now, { logger });
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
