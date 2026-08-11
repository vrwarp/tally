/**
 * Cloud Functions entry points.
 *
 * The exported names are a contract with src/services/functions.ts — renaming
 * one here silently breaks a button in the app, because `httpsCallable` resolves
 * by string. Everything a handler does lives in ./pco and ./access; this file is
 * only wiring, permission checks and the shapes the client expects back.
 *
 * Nothing here sweeps Planning Center. Tally used to mirror every person into
 * Firestore every six hours; it now reads people when it needs them and holds
 * the answer for `PCO_CACHE_TTL_SECONDS` at most. The one scheduled job left
 * writes down the gatherings a recurrence rule says are coming, which is work
 * that has to happen whether or not anybody opened the app.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { backendFailureStatus, describeBackendFailure } from './backends/errors.js';
import {
  drainStudent,
  sweepEdits,
  type DrainDeps,
  type EditRecord,
  type RunOutcome,
  type SweepResult,
} from './upstreamEdits.js';
import { isHeldForReview } from './backends/pendingReview.js';
import {
  a32AliasPairs,
  collapseAliasPair,
  existingStudentIdByA32Uuid,
} from './backends/aliases.js';
import {
  createRegistry,
  type BackendRegistry,
} from './backends/registry.js';
import {
  mergeBackendRosters,
  type PerBackendRoster,
} from './backends/roster.js';
import {
  linkageOfData,
  linkageOfStudentDoc,
  scanIdsFor,
  scanRoster,
  studentDocFor,
} from './backends/scan.js';
import {
  BackendPreconditionError,
  type AddParentResult,
  type BackendCapabilities,
  type CheckInsEventSummary,
  type CheckInsImportSummary,
  type ParentContactStatus,
  type PcoListSummary,
  type PeopleBackend,
  type PersonDetails,
  type PersonSearchResult,
  type PushPendingResult,
  type PushStudentResult,
  type RecreateStudentResult,
  type RosterPerson,
  type SetParentContactResult,
  type StudentProfilePatch,
  type UpdateStudentProfileResult,
} from './backends/types.js';
import { BACKEND_SECRETS, resolveConfig, type PcoConfig } from './config.js';
import { asFirestoreLike, PATHS, type FirestoreLike } from './firestore.js';
import { ChainAccessReader } from './eventAccess.js';
import { checkInsRootEventId } from './pco/checkins.js';
import {
  deleteEvents as removeEvents,
  type DeletionSummary,
  type DeletionTarget,
} from './eventDeletion.js';
import {
  BACKEND_IDS,
  isBackendId,
  parseStudentId,
  pcoStudentId,
  personIdFromStudentId,
  studentIdFor,
  type BackendId,
} from './generated/backendIds.js';
import {
  approvePairing,
  claimPairing,
  startPairing,
  type ApprovePairingStatus,
  type StartPairingResult,
} from './kiosk/pairing.js';
import { listKioskEvents, type KioskEventEntry } from './kiosk/events.js';
import {
  buildParticipationIndex,
  type ParticipationSummary,
} from './kiosk/participation.js';
import { buildPhoneIndex, type PhoneIndexSummary } from './kiosk/phoneIndex.js';
import { probeSigning, type SigningStatus } from './kiosk/signing.js';
import {
  parseRegisterFamilyRequest,
  registerFamily as runRegisterFamily,
  RegistrationInputError,
  sweepRegistrations,
  type RegisterFamilyResult,
} from './kiosk/registration.js';
import {
  amendRegistration as runAmendRegistration,
  type AmendChild,
  type AmendGuardian,
  type AmendRegistrationResult,
} from './kiosk/amend.js';
import {
  parseRecordVisitorParentRequest,
  recordVisitorParent as runRecordVisitorParent,
  type RecordVisitorParentResult,
} from './kiosk/visitorParent.js';
import {
  approveRegistration as runApproveRegistration,
  discardRegistration as runDiscardRegistration,
  listPendingRegistrations as listPending,
  type ApproveRegistrationResult,
  type DiscardRegistrationResult,
  type PendingRegistration,
} from './kiosk/review.js';
import {
  mergeStudents as runMergeStudents,
  unmergeStudents as runUnmergeStudents,
  type MergeStudentsResult,
} from './backends/mergeStudents.js';
import { bumpPulse, PULSE_DEBOUNCE_MS } from './kiosk/pulse.js';
import { materializeOccurrence as materializeOne, MINISTRY_TIME_ZONE } from './occurrences.js';
// Imported for its registration side effect and nothing else: pulling the
// adapter package in is what makes the Attendees backend available to the
// registry, and the entry point is the one place that decides what ships.
import './attendees32/backend.js';
import { createPcoBackend } from './pco/backend.js';
import { createPcoClient, PcoApiError } from './pco/client.js';
import { fetchLists } from './pco/lists.js';
import { graftMergedStudent } from './pco/studentPerson.js';

export { provisionAccess } from './access.js';

initializeApp();

// The whole ministry is in one place, so co-locating with Firestore is the only
// latency decision that matters here.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

function db(): FirestoreLike {
  return asFirestoreLike(getFirestore());
}

/**
 * The Planning Center backend, or the reason there cannot be one. Missing
 * credentials are reported to the caller rather than thrown, so the Settings
 * screen can name the missing value instead of showing "internal error".
 *
 * One backend, resolved per request like the configuration it is built from.
 * The multi-backend registry replaces this as other backends arrive; every
 * entry point already speaks only `PeopleBackend`, which is the point of the
 * seam.
 */
async function pcoBackendFor(
  database: FirestoreLike,
): Promise<{ backend: PeopleBackend | null; config: PcoConfig }> {
  const config = await resolveConfig(database);
  if (config.configError) return { backend: null, config };
  return { backend: createPcoBackend({ db: database, config }), config };
}

/**
 * Which backend answers for one student.
 *
 * The claim is read from Tally's own record, never from the caller: the id
 * prefix when the id is the claim, the server-written linkage fields when a
 * pushed visitor's document carries it. A student linked to nobody belongs to
 * whichever backend new students go to — the write paths that land here for
 * an unlinked student are exactly the ones about to create them somewhere.
 */
async function backendForStudent(
  registry: BackendRegistry,
  database: FirestoreLike,
  studentId: string,
): Promise<{ backend: PeopleBackend } | { error: string }> {
  let backendId = parseStudentId(studentId)?.backendId ?? null;
  if (!backendId) {
    const snapshot = await database.doc(`${PATHS.students}/${studentId}`).get();
    const linkage = snapshot.exists ? linkageOfData(snapshot.data() ?? {}) : null;
    backendId = linkage?.backendId ?? null;
  }
  if (!backendId) return registry.defaultPush();

  const backend = registry.get(backendId);
  if (!backend) {
    return {
      error:
        registry.configErrorOf(backendId) ??
        `${registry.displayNameOf(backendId)} is not connected.`,
    };
  }
  return { backend };
}

/** The read-reuse window a backend's answers live under. */
function cacheTtlOf(registry: BackendRegistry, backendId: BackendId): number {
  return backendId === 'pco'
    ? registry.configs.pco.cacheTtlSeconds
    : registry.configs.a32.cacheTtlSeconds;
}

/**
 * Which person `getPersonDetails` is being asked about, and of which backend.
 *
 * Two request shapes, one older than the other. A `studentId` names the
 * student and the linkage decides the backend — the shape every screen should
 * send. A bare `pcoPersonId` has always meant Planning Center and still does;
 * a deployed client from before the second backend existed sends only that,
 * and must keep working.
 */
async function resolveDetailsTarget(
  registry: BackendRegistry,
  database: FirestoreLike,
  data: { pcoPersonId?: string; studentId?: string } | undefined,
): Promise<{ backend: PeopleBackend; personId: string }> {
  const studentId = typeof data?.studentId === 'string' ? data.studentId.trim() : '';
  if (studentId) {
    const parsed = parseStudentId(studentId);
    let linkage = parsed;
    if (!linkage) {
      const snapshot = await database.doc(`${PATHS.students}/${studentId}`).get();
      linkage = snapshot.exists ? linkageOfData(snapshot.data() ?? {}) : null;
    }
    if (!linkage) {
      // An unlinked visitor has no upstream record to have details.
      throw new HttpsError('not-found', 'That student is not linked to a people backend.');
    }
    const backend = registry.get(linkage.backendId);
    if (!backend) {
      throw new HttpsError(
        'failed-precondition',
        registry.configErrorOf(linkage.backendId) ?? 'Not configured.',
      );
    }
    return { backend, personId: linkage.personId };
  }

  const personId = data?.pcoPersonId;
  if (typeof personId !== 'string' || personId.length === 0) {
    throw new HttpsError('invalid-argument', 'pcoPersonId is required.');
  }
  const backend = registry.get('pco');
  if (!backend) {
    throw new HttpsError('failed-precondition', registry.configErrorOf('pco') ?? 'Not configured.');
  }
  return { backend, personId };
}

/**
 * Who the caller is, held for a few seconds.
 *
 * Every gate below reads `users/{uid}`, and the screens that matter fire a
 * burst of calls rather than one: a dashboard of twenty follow-up rows asks for
 * twenty people's contact details, which is twenty reads of the same document
 * for the same person inside the same second. Holding the answer briefly
 * collapses that to one.
 *
 * It is deliberately *not* a custom claim on the auth token, which would cost
 * nothing at all. A claim goes stale until the client refreshes its token, so
 * revoking somebody's access would not take effect until they next signed in —
 * and this is the check that stands between a former volunteer and a minor's
 * parent's phone number. Firestore stays the source of truth; a revocation
 * lands within `CALLER_TTL_MS` on every instance, without anybody having to
 * think about token lifetimes.
 *
 * Denials are held on the same terms as grants, so a burst from somebody who is
 * not allowed in costs one read too. The cost is that activating a counselor
 * takes up to that long to be believed, which is a wait they can sit through
 * and an admin can explain.
 */
const CALLER_TTL_MS = 10_000;

/** Bounds memory on an instance a whole ministry signs in to. */
const CALLER_MAX_ENTRIES = 200;

interface Caller {
  active: boolean;
  role: string;
}

const callers = new Map<string, { record: Promise<Caller>; expiresAt: number }>();

async function readCaller(uid: string): Promise<Caller> {
  const at = Date.now();
  const held = callers.get(uid);
  if (held && held.expiresAt > at) return held.record;

  const record = (async (): Promise<Caller> => {
    const snapshot = await db().doc(`${PATHS.users}/${uid}`).get();
    const data = snapshot.exists ? (snapshot.data() ?? {}) : {};
    return {
      active: data.active === true,
      role: typeof data.role === 'string' ? data.role : '',
    };
  })();

  // Never remember a failure: a Firestore blip must not lock somebody out for
  // the rest of the TTL, and the next call should be a real attempt.
  record.catch(() => {
    if (callers.get(uid)?.record === record) callers.delete(uid);
  });

  callers.delete(uid);
  callers.set(uid, { record, expiresAt: at + CALLER_TTL_MS });
  while (callers.size > CALLER_MAX_ENTRIES) {
    const oldest = callers.keys().next();
    if (oldest.done) break;
    callers.delete(oldest.value);
  }

  return record;
}

/** Any signed-in, active member of the team. The role is read from Firestore. */
async function requireMember(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const caller = await readCaller(uid);
  if (!caller.active) {
    throw new HttpsError('permission-denied', 'Your access to Tally is not active.');
  }
}

/**
 * The gathering gate, for callables.
 *
 * The rules cover what a client writes directly. These cover what it asks a
 * server to write on its behalf — and the Admin SDK bypasses rules entirely, so
 * a callable that forgets this is not partially protected, it is unprotected.
 *
 * Takes the chain rather than an event id wherever the caller already has one,
 * because most of these act on a whole chain and looking up an instance to find
 * the chain it belongs to would be a round trip to learn what was passed in.
 */
async function requireOnChain(uid: string, chain: string): Promise<void> {
  const caller = await readCaller(uid);
  const reader = new ChainAccessReader(getFirestore(), uid, caller.role === 'admin');
  if (!(await reader.canWork(chain))) {
    throw new HttpsError(
      'permission-denied',
      'Only people added to that gathering can work it.',
    );
  }
}

/** The same, given an event id — reads the parent to find its chain. */
async function requireOnEvent(uid: string, eventId: string): Promise<void> {
  const snapshot = await getFirestore().doc(`events/${eventId}`).get();
  const data = snapshot.exists ? (snapshot.data() ?? {}) : {};
  const chain =
    typeof data.seriesId === 'string' && data.seriesId.length > 0
      ? data.seriesId
      : typeof data.recurrenceRootId === 'string' && data.recurrenceRootId.length > 0
        ? data.recurrenceRootId
        : eventId;
  await requireOnChain(uid, chain);
}

/** Core-team gate. The role is read from Firestore, never from the request. */
async function requireCoreTeam(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const caller = await readCaller(uid);
  if (!caller.active || (caller.role !== 'core' && caller.role !== 'admin')) {
    throw new HttpsError('permission-denied', 'Only the core team can do that.');
  }
}

/**
 * Admin, for the handful of things that are not a leader's to decide.
 *
 * The core team may edit the church's people database; deciding *when* Tally
 * talks to it is a different question, and the queue's pacing exists because an
 * API that rate-limits does not want a stampede.
 */
async function requireAdmin(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const caller = await readCaller(uid);
  if (!caller.active || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Only an admin can do that.');
  }
}

/**
 * Turns a backend failure into something a counselor can act on.
 *
 * The distinction that matters is "Tally is broken" versus "the backend is
 * having a minute" — the second is a reason to try again, and saying so stops a
 * volunteer hunting for a problem on their end. The sentence names whichever
 * backend actually failed, because "Planning Center is rate-limiting us" is a
 * lie when it was Attendees.
 *
 * The sentence is the whole answer for the person reading it at a door. The
 * request and response behind it ride along as the error's `details`, for the
 * screen's "Details" panel and the person they forward it to — see
 * ./pco/debug.ts for what that payload may and may not contain.
 */
function reportBackendFailure(displayName: string, error: unknown, what: string): never {
  if (error instanceof HttpsError) throw error;
  // A configuration problem an adapter could only discover mid-flight. The
  // message already says which value is wrong; the code says whose fault it is.
  if (error instanceof BackendPreconditionError) {
    throw new HttpsError('failed-precondition', error.message);
  }

  const debug = describeBackendFailure(error, what);
  logger.error(`Failed to ${what}`, { error: String(error), backend: debug });

  const status = backendFailureStatus(error);
  if (status === 429) {
    throw new HttpsError(
      'resource-exhausted',
      `${displayName} is rate-limiting us. Try again in a moment.`,
      debug,
    );
  }
  if (status === 401 || status === 403) {
    throw new HttpsError(
      'permission-denied',
      `${displayName} rejected Tally's credentials. A leader needs to check the connection in Settings.`,
      debug,
    );
  }

  throw new HttpsError('unavailable', `Could not reach ${displayName} to ${what}.`, debug);
}

/* -------------------------------------------------------------------------- */
/* Reading people                                                              */
/* -------------------------------------------------------------------------- */

/**
 * One backend's slice of a fanned-out read, sized for the wire: counts and a
 * sentence, never a second copy of the people.
 */
interface RosterBackendStatus {
  backendId: BackendId;
  displayName: string;
  ok: boolean;
  /** Why it failed, in plain language. Null when `ok`. */
  error: string | null;
  people: number;
  unresolved: number;
  missing: number;
  cached: boolean;
  fetchedAt: string;
}

/** Mirrors `RosterResponse` in src/services/functions.ts. */
interface RosterResponse {
  people: RosterPerson[];
  /** Roster entries whose backend person could not be read. */
  unresolved: string[];
  /** Merges the read followed and wrote back; the student rides under the
   *  survivor's row already. Ids only — nothing personal. */
  relinks: Array<{ fromPersonId: string; toPersonId: string }>;
  /** `unresolved` entries that are known gone — deleted, or a merge trail
   *  that ends dead. Their membership documents are frozen for check-ins. */
  missing: string[];
  cached: boolean;
  fetchedAt: string;
  /** Echoed so the app can say how stale what it is showing might be. */
  cacheTtlSeconds: number;
  /**
   * Each connected backend's own outcome, so one being down can be one banner
   * instead of a blank roster. Exactly one entry per enabled backend.
   */
  perBackend: RosterBackendStatus[];
}

/**
 * The youth roster: Tally's membership, with Planning Center's names on it.
 *
 * Open to any active member of the team, not just the core: a door volunteer
 * cannot check anybody in without it. It returns names and grades only — parent
 * contact comes from `getPersonDetails`, one person at a time, to somebody with
 * a reason to look, and the allergy *note* from `getAllergyNotes` for the few
 * students whose row is already flagged.
 *
 * Students Tally created itself and has not pushed yet live entirely in
 * Firestore, which the app already reads live; merging the two is the client's
 * job (`mergeRoster`). Once the push has linked them, their Planning Center
 * person is read here like everybody else's — their *row* stays the document,
 * but the fields Planning Center owns have to come from Planning Center, or a
 * birthday saved upstream goes on reading "No birthday" for ever.
 */
export const getRoster = onCall<{ force?: boolean } | undefined, Promise<RosterResponse>>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<RosterResponse> => {
    await requireMember(request.auth?.uid);

    const database = db();
    const registry = await createRegistry(database);
    const enabled = registry.ids();
    if (enabled.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        registry.configErrorOf('pco') ?? 'Not configured.',
      );
    }

    const scan = await scanRoster(database);
    const force = request.data?.force === true;

    /*
     * Every connected backend is asked about exactly its own students — both
     * halves of each membership, the prefixed documents and the pushed
     * visitors, and for the same reason as ever: a pushed visitor's row is
     * their document, but the document deliberately holds none of what the
     * backend owns, so without asking upstream their name was whatever was
     * typed at the door and a birthday saved upstream never appeared.
     *
     * `Promise.all` over per-backend try/catch rather than failing together:
     * one backend down must not blank the other's roster. A deployment with a
     * single backend keeps today's behavior exactly — its failure is the whole
     * read's failure, reported below.
     */
    const results: PerBackendRoster[] = await Promise.all(
      enabled.map(async (backendId): Promise<PerBackendRoster> => {
        const backend = registry.get(backendId)!;
        try {
          const result = await backend.fetchRoster({ personIds: scanIdsFor(scan, backendId), force });
          return { backendId, displayName: backend.displayName, ok: true, error: null, ...result };
        } catch (error) {
          logger.warn('Roster read failed for one backend', {
            backend: backendId,
            error: String(error),
          });
          return {
            backendId,
            displayName: backend.displayName,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            thrown: error,
            people: [],
            unresolved: [],
            relinks: [],
            missing: [],
            cached: false,
            fetchedAt: new Date().toISOString(),
          };
        }
      }),
    );

    if (!results.some((result) => result.ok)) {
      const first = results[0]!;
      return reportBackendFailure(first.displayName, first.thrown, 'load the roster');
    }

    /*
     * The same human on the roster through both backends is one student, and
     * the Planning Center read just said which pairs there are — its people
     * carry the church's `attendees_uuid` pointers. Folding follows the merge
     * precedent: the Planning Center side keeps the row, the Attendees-side
     * document goes inactive with a pointer, and this response already shows
     * the single student. Idempotent, because an inactive document leaves the
     * next scan.
     */
    const pcoResult = results.find((result) => result.backendId === 'pco');
    const aliasPairs = pcoResult?.ok ? a32AliasPairs(scan, pcoResult.a32Aliases) : [];
    if (aliasPairs.length > 0) {
      const folded = new Set(aliasPairs.map((pair) => pair.a32PersonId));
      for (const pair of aliasPairs) {
        await collapseAliasPair(database, pair);
        logger.info('Folded one student held by both backends', {
          keeper: pair.keeperDoc,
          folded: pair.foldDoc,
        });
      }
      for (const result of results) {
        if (result.backendId !== 'a32' || !result.ok) continue;
        result.people = result.people.filter((person) => !folded.has(person.pcoPersonId));
      }
    }

    for (const result of results) {
      if (!result.ok) continue;
      /*
       * Merges the hydration followed become membership moves here, where the
       * database is. The result already shows each student under the record
       * the church kept; this is what makes that stick, so the next roster
       * read stops tripping over the buried id. Idempotent, so replaying a
       * cached answer's relinks is harmless.
       */
      for (const relink of result.relinks) {
        const fromDoc = studentDocFor(scan, result.backendId, relink.fromPersonId);
        if (fromDoc) await graftMergedStudent(database, fromDoc, relink.toPersonId);
      }
      /*
       * Known-gone students are frozen; resolved ones thaw. The flag on the
       * membership document is what the check-in rules read, so a student
       * whose backend record died cannot quietly accumulate history under a
       * dead id — past events included — until somebody removes them or
       * re-creates the record. Only `missing` (confirmed gone) freezes:
       * `unresolved` also holds students a busy pass could not look at, and
       * being unlucky must not read as being deleted. Written only on change,
       * so a settled roster costs no writes.
       */
      for (const personId of result.missing) {
        const studentDoc = studentDocFor(scan, result.backendId, personId);
        if (studentDoc && !scan.recordMissing[studentDoc]) {
          await database.doc(`${PATHS.students}/${studentDoc}`).set(
            { upstreamRecordMissing: true }, { merge: true });
        }
      }
      const resolved = new Set(result.people.map((person) => person.pcoPersonId));
      for (const [studentDoc, flagged] of Object.entries(scan.recordMissing)) {
        if (!flagged) continue;
        const linkage = linkageOfStudentDoc(scan, studentDoc);
        if (linkage?.backendId === result.backendId && resolved.has(linkage.personId)) {
          await database.doc(`${PATHS.students}/${studentDoc}`).set(
            { upstreamRecordMissing: false }, { merge: true });
        }
      }
    }

    const merged = mergeBackendRosters(results);
    return {
      ...merged,
      cacheTtlSeconds: Math.max(...enabled.map((id) => cacheTtlOf(registry, id))),
      perBackend: results.map((result) => ({
        backendId: result.backendId,
        displayName: result.displayName,
        ok: result.ok,
        error: result.error,
        people: result.people.length,
        unresolved: result.unresolved.length,
        missing: result.missing.length,
        cached: result.cached,
        fetchedAt: result.fetchedAt,
      })),
    };
  },
);

/**
 * Finds somebody in Planning Center to put on the roster.
 *
 * Core team only: this searches the *whole* church directory, which is a wider
 * view of the congregation than a door volunteer has any reason to hold.
 */
export const searchPlanningCenterPeople = onCall<
  { query: string; backendId?: string },
  Promise<{
    people: PersonSearchResult[];
    perBackend: Array<{ backendId: BackendId; displayName: string; ok: boolean; error: string | null }>;
  }>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
  if (!query) return { people: [], perBackend: [] };

  const registry = await createRegistry(db());
  const asked = request.data?.backendId;
  const targets = isBackendId(asked) ? [asked] : registry.ids();
  const reachable = targets.filter((id) => registry.get(id) !== null);
  if (reachable.length === 0) {
    throw new HttpsError(
      'failed-precondition',
      registry.configErrorOf(targets[0] ?? 'pco') ?? 'Not configured.',
    );
  }

  const settled = await Promise.all(
    reachable.map(async (backendId) => {
      const backend = registry.get(backendId)!;
      try {
        return { backendId, backend, ok: true as const, error: null, people: await backend.searchPeople({ query }) };
      } catch (error) {
        return { backendId, backend, ok: false as const, error, people: [] as PersonSearchResult[] };
      }
    }),
  );

  const failed = settled.filter((entry) => !entry.ok);
  if (failed.length === settled.length) {
    const first = failed[0]!;
    return reportBackendFailure(
      first.backend.displayName,
      first.error,
      `search ${first.backend.displayName}`,
    );
  }

  /*
   * A person both directories hold is one row, not two. The Planning Center
   * hits carry the church's `attendees_uuid` pointers, so the Attendees hit
   * for the same human is recognisable — and it is the one dropped, because
   * an add from the surviving row lands on (or folds into) the Planning
   * Center membership either way.
   */
  const aliased = new Set(
    settled.flatMap((entry) =>
      entry.people
        .map((person) => person.a32PersonId)
        .filter((uuid): uuid is string => typeof uuid === 'string'),
    ),
  );

  return {
    // Registry order — Planning Center first — with each backend's own
    // relevance order intact inside its run.
    people: settled.flatMap((entry) =>
      entry.backendId === 'a32'
        ? entry.people.filter((person) => !aliased.has(person.pcoPersonId))
        : entry.people,
    ),
    perBackend: settled.map((entry) => ({
      backendId: entry.backendId,
      displayName: entry.backend.displayName,
      ok: entry.ok,
      error: entry.ok ? null : entry.error instanceof Error ? entry.error.message : String(entry.error),
    })),
  };
});

/** Mirrors `PcoPersonDetails` in src/types. */
interface PersonDetailsResponse extends PersonDetails {
  /** Which backend answered — and so which one the writable flags are about. */
  backendId: BackendId;
  /**
   * Whether Tally can add a parent contact for this student right now — an
   * adult in the household to hang it off, *and* write-back turned up to
   * `full`. Answered by the server because the browser can see neither half.
   */
  contactWritable: boolean;
  /**
   * Whether the student's own managed fields — name, grade, allergies — may be
   * edited from Tally, which is `full` and nothing else.
   *
   * Separate from `contactWritable` because the two gates are not the same
   * gate: editing this person needs only the mode, while writing a contact also
   * needs somebody in the household to write it onto. A form that conflated
   * them would lock a perfectly editable name behind a missing family.
   */
  profileWritable: boolean;
  /**
   * Whether Tally may build this student a family — create the parent, and the
   * household if there is none — which is `full` *and* nobody there yet.
   *
   * The second half is not a UI nicety: `addParent` refuses outright once an
   * adult is on file, because adding a second one from a form whose premise was
   * "nobody can be reached" is how a household ends up with two mothers.
   */
  parentCreatable: boolean;
}

/**
 * Parent contact and allergies for one student.
 *
 * Separate from the roster on purpose. This is the data minimisation the PRD
 * asks for made structural: a counselor checking people in at a door never
 * receives a minor's parent's phone number, because the screen they are on
 * never asks for it.
 */
export const getPersonDetails = onCall<
  { pcoPersonId?: string; studentId?: string; force?: boolean },
  Promise<PersonDetailsResponse | null>
>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 60, memory: '256MiB' },
  async (request): Promise<PersonDetailsResponse | null> => {
    await requireCoreTeam(request.auth?.uid);

    const registry = await createRegistry(db());
    const resolved = await resolveDetailsTarget(registry, db(), request.data);
    const { backend, personId } = resolved;

    try {
      const details = await backend.fetchPersonDetails({
        personId,
        /*
         * Asked for by a screen that has just written, and honoured because the
         * alternative fails in the worst possible place. `addParent` drops this
         * instance's cache when it succeeds, but the re-read that follows it is
         * a *different* request and may land on a different instance, whose
         * held answer still says this family has nobody in it — on the one
         * screen whose entire subject is whether they do.
         */
        force: request.data?.force === true,
      });
      if (!details) return null;

      /*
       * Added here rather than inside the cached read, because the two halves
       * of this answer expire on completely different schedules. Whether the
       * household has an adult is a fact about the backend and is worth
       * holding for the TTL; whether Tally is allowed to write is a setting a
       * leader may have changed a second ago, and serving that from a cache
       * would leave a form on screen that the write path then refuses.
       */
      const writeBackFull = backend.capabilities.writeBack === 'full';
      return {
        ...details,
        backendId: backend.id,
        contactWritable: details.householdAdult && writeBackFull,
        profileWritable: writeBackFull,
        parentCreatable:
          writeBackFull && !details.householdAdult && backend.capabilities.parentCreatable,
      };
    } catch (error) {
      return reportBackendFailure(backend.displayName, error, 'load this student');
    }
  },
);

export interface AllergyNotesResponse {
  /**
   * Planning Center person id -> the allergy line on file.
   *
   * Only people who have one appear. A person who could not be read is absent
   * rather than empty-stringed, and the two are the same thing to the badge
   * that reads this: it falls back to the word `Allergy` on its own.
   */
  notes: Record<string, string>;
}

/**
 * The allergy line for the students a check-in roster has already flagged.
 *
 * The one piece of medical information that reaches the door, and it is here
 * because withholding it made the flag worse than useless: a counselor looking
 * at `⚠ Allergy` on a row they are about to check in cannot act on it without
 * leaving the screen, so on a Friday nobody does. A badge that says *peanuts*
 * is read in the half second the row is already being looked at.
 *
 * Deliberately not `getPersonDetails`, on two counts. That one is core team
 * only, and the people this is for are the door volunteers — `counselor` is a
 * role that never sees the dashboard and must still see the allergy. And it
 * returns a parent's name, phone and email, none of which a check-in screen has
 * any business receiving; this returns one line per person and nothing else.
 *
 * The ids come from the caller — the students whose roster row carries the flag
 * — rather than from the whole roster, so the request is a handful of people on
 * a ministry of four hundred.
 */
export const getAllergyNotes = onCall<
  {
    pcoPersonIds?: readonly string[];
    personKeys?: ReadonlyArray<{ backendId: string; personId: string }>;
  },
  Promise<AllergyNotesResponse>
>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 60, memory: '256MiB' },
  async (request): Promise<AllergyNotesResponse> => {
    await requireMember(request.auth?.uid);

    const asked = request.data?.pcoPersonIds;
    const keys = request.data?.personKeys;
    if (!Array.isArray(asked) && !Array.isArray(keys)) {
      throw new HttpsError('invalid-argument', 'pcoPersonIds is required.');
    }

    // Two request shapes: bare ids have always meant Planning Center and
    // still do; `personKeys` names the backend per person, which is the shape
    // a mixed roster sends.
    const byBackend = new Map<BackendId, string[]>();
    const put = (backendId: BackendId, personId: unknown): void => {
      if (typeof personId !== 'string' || personId.length === 0) return;
      const list = byBackend.get(backendId);
      if (list) list.push(personId);
      else byBackend.set(backendId, [personId]);
    };
    for (const id of asked ?? []) put('pco', id);
    for (const key of keys ?? []) {
      if (key && isBackendId(key.backendId)) put(key.backendId, key.personId);
    }

    // Nothing to ask about is a perfectly ordinary answer — a roster where
    // nobody is flagged — and must not cost a backend client.
    if (byBackend.size === 0) return { notes: {} };

    const registry = await createRegistry(db());
    const targets = [...byBackend.entries()].filter(([backendId]) => registry.get(backendId));
    if (targets.length === 0) {
      const [firstAsked] = byBackend.keys();
      throw new HttpsError(
        'failed-precondition',
        registry.configErrorOf(firstAsked ?? 'pco') ?? 'Not configured.',
      );
    }

    const settled = await Promise.all(
      targets.map(async ([backendId, personIds]) => {
        const backend = registry.get(backendId)!;
        try {
          return { backend, ok: true as const, error: null, notes: await backend.fetchAllergyNotes({ personIds }) };
        } catch (error) {
          return { backend, ok: false as const, error, notes: {} as Record<string, string> };
        }
      }),
    );

    const failed = settled.filter((entry) => !entry.ok);
    if (failed.length === settled.length) {
      const first = failed[0]!;
      return reportBackendFailure(first.backend.displayName, first.error, 'read the allergy notes');
    }

    // Person ids do not collide across backends (numeric vs UUID), so one map
    // keyed by bare id keeps the client's existing lookup working unchanged.
    return { notes: Object.assign({}, ...settled.map((entry) => entry.notes)) };
  },
);

/**
 * Which students on the roster nobody can be reached about.
 *
 * A boolean each, and deliberately nothing else: this answers a question about
 * the *absence* of contact details, so sending any would be paying the whole
 * privacy cost of `getPersonDetails` for a screen that only counts.
 *
 * Core team only, and separate from `getRoster` on purpose — see
 * `fetchParentContactStatus`. The roster is what a door volunteer waits for;
 * this is a Tuesday-morning question asked from the insights screen.
 */
export const getParentContactStatus = onCall<
  { force?: boolean } | undefined,
  Promise<ParentContactStatus>
>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<ParentContactStatus> => {
    await requireCoreTeam(request.auth?.uid);

    const registry = await createRegistry(db());
    const enabled = registry.ids();
    if (enabled.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        registry.configErrorOf('pco') ?? 'Not configured.',
      );
    }

    const scan = await scanRoster(db());
    const force = request.data?.force === true;

    /*
     * Both halves of each backend's membership, which is what makes this
     * different from every other read of the scan.
     *
     * A visitor Tally pushed upstream keeps their own document id, so the
     * roster read does not carry them and this question had no answer for
     * them — and "no answer" is not "no parent", so the dashboard could only
     * fall back to the flag on their document, which says `false` for ever. A
     * contact added through Tally, written upstream and confirmed by the very
     * next read left them on the "incomplete profiles" list anyway. Asking
     * about them here is what lets the backend answer for the students Tally
     * itself put there.
     */
    const settled = await Promise.all(
      enabled.map(async (backendId) => {
        const backend = registry.get(backendId)!;
        try {
          const status = await backend.fetchParentContactStatus({
            personIds: scanIdsFor(scan, backendId),
            force,
          });
          return { backend, ok: true as const, error: null, status };
        } catch (error) {
          return { backend, ok: false as const, error, status: null };
        }
      }),
    );

    const answered = settled.filter(
      (entry): entry is typeof entry & { status: ParentContactStatus } => entry.status !== null,
    );
    if (answered.length === 0) {
      const first = settled[0]!;
      return reportBackendFailure(
        first.backend.displayName,
        first.error,
        'check which students have a parent contact',
      );
    }

    return {
      reachable: Object.assign({}, ...answered.map((entry) => entry.status.reachable)),
      unresolved: answered.flatMap((entry) => entry.status.unresolved),
      cached: answered.every((entry) => entry.status.cached),
      fetchedAt: answered
        .map((entry) => entry.status.fetchedAt)
        .reduce((latest, at) => (at > latest ? at : latest), ''),
    };
  },
);

/* -------------------------------------------------------------------------- */
/* Connection status                                                           */
/* -------------------------------------------------------------------------- */

/** Mirrors `PcoStatusResult` in src/services/functions.ts. */
interface PcoStatusResult {
  configured: boolean;
  reachable: boolean;
  /** Null when everything is fine; otherwise the reason, in plain language. */
  problem: string | null;
  writeBack: 'off' | 'create' | 'full';
  cacheTtlSeconds: number;
  baseUrlOverridden: boolean;
  /** How many of Tally's roster entries Planning Center could actually name. */
  peopleVisible: number | null;
  /** Roster entries whose upstream person could not be read. */
  unresolved: number;
  /** Active students with no Planning Center person yet. */
  queued: number;
  /**
   * Active students waiting for somebody to approve them, counted apart from
   * `queued` because nothing is stuck — see `backends/pendingReview.ts`.
   */
  heldForReview: number;
  /**
   * The effective settings, so Settings can both describe the connection and
   * open an editor already filled in with what is actually in force — rather
   * than with what the browser guesses is in force.
   *
   * Everything here is non-secret by construction: the token pair is never
   * part of this shape, and `baseUrl` is an API root, not a credential.
   */
  settings: {
    minGrade: number;
    maxGrade: number;
    writeBack: 'off' | 'create' | 'full';
    cacheTtlSeconds: number;
    baseUrl: string;
    /** True when these came from `config/planningCenter` rather than a deploy. */
    managedInApp: boolean;
  };
}

/**
 * What the Settings screen shows, asked for rather than watched.
 *
 * There is no `config/pcoSync` document any more and nothing subscribes to one:
 * the old sweep wrote status into Firestore so a progress bar could follow it,
 * which meant every core-team member's phone lit up on a schedule. A read has no
 * progress to follow.
 */
export const getPlanningCenterStatus = onCall<
  { force?: boolean } | undefined,
  Promise<PcoStatusResult>
>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<PcoStatusResult> => {
    await requireCoreTeam(request.auth?.uid);

    const { backend, config } = await pcoBackendFor(db());

    /*
     * Read before the configuration is judged, because "how many students have
     * not reached Planning Center" is most worth knowing in exactly the states
     * that return early below — write-back off, or the connection broken. The
     * roster ids from the same scan are only usable once there is a backend.
     */
    const scan = await scanRoster(db());

    const base = {
      writeBack: config.writeBack,
      cacheTtlSeconds: config.cacheTtlSeconds,
      baseUrlOverridden: config.baseUrlOverridden,
      // Echoed even when the connection is broken: the editor this feeds is
      // exactly where somebody goes to fix a broken connection, so it must open
      // filled in rather than empty.
      settings: {
        minGrade: config.minGrade,
        maxGrade: config.maxGrade,
        writeBack: config.writeBack,
        cacheTtlSeconds: config.cacheTtlSeconds,
        baseUrl: config.baseUrl,
        managedInApp: config.managedInApp,
      },
      unresolved: 0,
      queued: scan.queued,
      heldForReview: scan.heldForReview,
    } satisfies Omit<PcoStatusResult, 'configured' | 'reachable' | 'problem' | 'peopleVisible'>;

    if (config.configError) {
      return {
        ...base,
        configured: false,
        reachable: false,
        problem: config.configError,
        peopleVisible: null,
      };
    }

    if (!backend) {
      return { ...base, configured: false, reachable: false, problem: 'Not configured.', peopleVisible: null };
    }

    try {
      // Deliberately the real roster query rather than a cheap ping: "we can
      // reach the API" and "we can see your students" are different claims, and
      // only the second is worth showing a leader.
      const personIds = scan.personIds.pco;
      const result = await backend.fetchRoster({
        personIds,
        force: request.data?.force === true,
      });

      const problem =
        personIds.length === 0
          ? 'Nobody is on the roster yet. Add students from the Students screen.'
          : result.unresolved.length > 0
            ? `${result.unresolved.length} of ${personIds.length} students on the roster could not be read from Planning Center. They may have been deleted or merged upstream.`
            : null;

      return {
        ...base,
        configured: true,
        reachable: true,
        problem,
        peopleVisible: result.people.length,
        unresolved: result.unresolved.length,
      };
    } catch (error) {
      return {
        ...base,
        configured: true,
        reachable: false,
        problem: error instanceof Error ? error.message : String(error),
        peopleVisible: null,
      };
    }
  },
);

/** One backend's connection report, plus what it is and what it can do. */
interface BackendStatus {
  backendId: BackendId;
  displayName: string;
  /** Switched on and fully configured — the registry's own judgement. */
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  problem: string | null;
  writeBack: 'off' | 'create' | 'full';
  cacheTtlSeconds: number;
  peopleVisible: number | null;
  unresolved: number;
  /** Present only on an enabled backend — capabilities are an adapter's. */
  capabilities: BackendCapabilities | null;
  /** The effective settings, shaped per backend. */
  settings: Record<string, unknown>;
}

interface BackendStatusesResponse {
  backends: BackendStatus[];
  defaultPushBackend: BackendId;
  /** Active students no backend holds yet — a deployment-wide count. */
  queued: number;
  /** Of those, the ones nobody has approved yet rather than the ones stuck. */
  heldForReview: number;
}

/**
 * Every backend Tally knows, connected or not, in one answer.
 *
 * The Settings screen's read. Disabled backends are here on purpose — the
 * screen where somebody sets Attendees up needs to show Attendees before it is
 * configured, with the problem named. The probe for enabled backends is the
 * real roster query, same reasoning as `getPlanningCenterStatus`: "we can
 * reach the API" and "we can see your students" are different claims, and only
 * the second is worth showing a leader.
 */
export const getBackendStatuses = onCall<
  { force?: boolean } | undefined,
  Promise<BackendStatusesResponse>
>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<BackendStatusesResponse> => {
    await requireCoreTeam(request.auth?.uid);

    const database = db();
    const registry = await createRegistry(database);
    const scan = await scanRoster(database);
    const force = request.data?.force === true;

    const backends = await Promise.all(
      BACKEND_IDS.map(async (backendId): Promise<BackendStatus> => {
        const backend = registry.get(backendId);
        const base = {
          backendId,
          displayName: registry.displayNameOf(backendId),
          writeBack:
            backendId === 'pco' ? registry.configs.pco.writeBack : registry.configs.a32.writeBack,
          cacheTtlSeconds: cacheTtlOf(registry, backendId),
          settings: backendSettingsOf(registry, backendId),
          unresolved: 0,
        };

        if (!backend) {
          const problem = registry.configErrorOf(backendId);
          return {
            ...base,
            enabled: false,
            // Not serving for one of two reasons, and the card says different
            // things for them: unfinished configuration (the problem names
            // what is missing) versus a configured backend a leader switched
            // off (no problem to report — it is doing as asked).
            configured: problem === null,
            reachable: false,
            problem,
            peopleVisible: null,
            capabilities: null,
          };
        }

        try {
          const result = await backend.fetchRoster({
            personIds: scan.personIds[backendId],
            force,
          });
          const total = scan.personIds[backendId].length;
          return {
            ...base,
            enabled: true,
            configured: true,
            reachable: true,
            problem:
              result.unresolved.length > 0
                ? `${result.unresolved.length} of ${total} students on the roster could not be read from ${backend.displayName}. They may have been deleted or merged upstream.`
                : null,
            peopleVisible: result.people.length,
            unresolved: result.unresolved.length,
            capabilities: backend.capabilities,
          };
        } catch (error) {
          return {
            ...base,
            enabled: true,
            configured: true,
            reachable: false,
            problem: error instanceof Error ? error.message : String(error),
            peopleVisible: null,
            capabilities: backend.capabilities,
          };
        }
      }),
    );

    return {
      backends,
      defaultPushBackend: registry.defaultPushBackendId,
      queued: scan.queued,
      heldForReview: scan.heldForReview,
    };
  },
);

/** The non-secret settings echo, shaped for each backend's editor. */
function backendSettingsOf(registry: BackendRegistry, backendId: BackendId): Record<string, unknown> {
  if (backendId === 'pco') {
    const config = registry.configs.pco;
    return {
      minGrade: config.minGrade,
      maxGrade: config.maxGrade,
      writeBack: config.writeBack,
      cacheTtlSeconds: config.cacheTtlSeconds,
      baseUrl: config.baseUrl,
      managedInApp: config.managedInApp,
    };
  }
  const config = registry.configs.a32;
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    divisionId: config.divisionId,
    meetSlug: config.meetSlug,
    characterSlug: config.characterSlug,
    assemblySlug: config.assemblySlug,
    minGrade: config.minGrade,
    maxGrade: config.maxGrade,
    writeBack: config.writeBack,
    cacheTtlSeconds: config.cacheTtlSeconds,
    managedInApp: config.managedInApp,
  };
}

/**
 * The Planning Center lists this token can see, for the roster picker.
 *
 * Core team only, and read-only by necessity as much as by choice: the API has
 * no way to create a list or to change who is on one, so Tally chooses among
 * what Planning Center already has and links out for the rest.
 */
export const listPlanningCenterLists = onCall<
  { search?: string; limit?: number } | undefined,
  Promise<{ lists: PcoListSummary[] }>
>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 60, memory: '256MiB' },
  async (request): Promise<{ lists: PcoListSummary[] }> => {
    await requireCoreTeam(request.auth?.uid);

    const config = await resolveConfig(db());
    if (!config.appId || !config.secret) {
      throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');
    }

    // Deliberately not `clientFor`, which refuses on *any* configuration
    // problem. The most likely reason somebody has this picker open is the
    // problem itself — "list mode, no list chosen" — and refusing to list the
    // lists until the list is chosen is a closed loop with no way out of it.
    // Credentials are the only thing this call actually needs.
    const client = createPcoClient({
      appId: config.appId,
      secret: config.secret,
      baseUrl: config.baseUrl,
    });

    try {
      const search = typeof request.data?.search === 'string' ? request.data.search : undefined;
      const limit = typeof request.data?.limit === 'number' ? request.data.limit : undefined;
      return { lists: await fetchLists({ client, search, limit }) };
    } catch (error) {
      return reportBackendFailure('Planning Center', error, 'load your Planning Center lists');
    }
  },
);

/**
 * Drops this instance's cached roster.
 *
 * Best effort by construction, and worth being clear about: the cache lives in
 * memory, so this clears the instance the call happens to land on and does
 * nothing for the others. That is why "Refresh" in the app does not rely on it
 * — it passes `force` on the read itself, which works wherever the read lands.
 * This exists for the case where a leader wants the *next* read to be fresh too.
 */
export const refreshPlanningCenter = onCall<void, Promise<{ status: 'ok' }>>(
  // Same omission as `listPendingRegistrations` above, with a smaller blast
  // radius and the same shape: without the secrets `registry.ids()` is empty,
  // so the loop below resets nothing at all and still answers `ok`. A
  // best-effort call may miss the other instances; it should not miss its own.
  { secrets: BACKEND_SECRETS, timeoutSeconds: 30, memory: '256MiB' },
  async (request) => {
    await requireCoreTeam(request.auth?.uid);
    const registry = await createRegistry(db());
    for (const backendId of registry.ids()) registry.get(backendId)?.resetCache();
    return { status: 'ok' };
  },
);

/* -------------------------------------------------------------------------- */
/* The roster itself                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Puts a Planning Center person on Tally's roster.
 *
 * Server-side rather than a Firestore write, because the document id *is* the
 * claim: `students/pco_123` says "this row is Planning Center person 123", and
 * a browser that could write that could bind a student record onto any person
 * in the church — which is why the security rules forbid a client asserting the
 * linkage at all. Here the linkage is checked against Planning Center before it
 * is written.
 *
 * Idempotent: adding somebody who is already on the roster reactivates them
 * rather than failing, because "they are back this term" is far more common
 * than a mistake.
 */
export const addRosterMember = onCall<
  { pcoPersonId: string; backendId?: string },
  Promise<{ status: 'added' | 'restored' | 'already-on-roster'; studentId: string }>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const personId = request.data?.pcoPersonId;
  if (typeof personId !== 'string' || personId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'pcoPersonId is required.');
  }

  // A bare person id has always meant Planning Center; a search result from
  // another backend says which one it came from.
  const backendId: BackendId = isBackendId(request.data?.backendId)
    ? request.data.backendId
    : 'pco';
  const registry = await createRegistry(db());
  const backend = registry.get(backendId);
  if (!backend) {
    throw new HttpsError(
      'failed-precondition',
      registry.configErrorOf(backendId) ?? 'Not configured.',
    );
  }

  // Confirm the person is real before recording that they are on the roster: a
  // typo'd id would otherwise become a permanent row that renders as nothing.
  // A merged id is followed to the record the church kept — whoever pasted it
  // meant that person — and only a trail that ends dead is refused.
  let rosterPersonId: string;
  let checkedA32Alias: string | undefined;
  try {
    const check = await backend.checkPerson({ personId });
    if (check.outcome === 'gone') {
      throw new HttpsError('not-found', `${backend.displayName} has no person with that id.`);
    }
    rosterPersonId = check.personId;
    checkedA32Alias = check.a32PersonId;
  } catch (error) {
    return reportBackendFailure(
      backend.displayName,
      error,
      `check that person in ${backend.displayName}`,
    );
  }

  /*
   * The same human may already be on the roster through the other backend —
   * the church's `attendees_uuid` field says so. Adding an Attendees person a
   * Planning Center membership already answers for would put one child on the
   * roster twice, so the add lands on the membership the roster has. Best
   * effort on purpose: the aliases live upstream, and not being able to read
   * them must not break an add.
   */
  if (backendId === 'a32') {
    const pco = registry.get('pco');
    if (pco) {
      try {
        const scan = await scanRoster(db());
        const aliases =
          (await pco.fetchRoster({ personIds: scanIdsFor(scan, 'pco') })).a32Aliases ?? {};
        const holder = Object.entries(aliases).find(([, uuid]) => uuid === rosterPersonId);
        const keeperDoc = holder ? studentDocFor(scan, 'pco', holder[0]) : undefined;
        if (keeperDoc) return { status: 'already-on-roster', studentId: keeperDoc };
      } catch (error) {
        logger.warn('Could not check the Attendees person against Planning Center aliases', {
          error: String(error),
        });
      }
    }
  }

  const studentId = studentIdFor(backendId, rosterPersonId);
  const ref = db().doc(`${PATHS.students}/${studentId}`);
  const snapshot = await ref.get();
  const existing = snapshot.exists ? (snapshot.data() ?? {}) : {};
  const wasActive = existing.status === 'active';

  await ref.set(
    {
      // The legacy field keeps meaning Planning Center; the generic pair is
      // the one every backend writes.
      ...(backendId === 'pco' ? { pcoPersonId: rosterPersonId } : {}),
      upstreamBackend: backendId,
      upstreamPersonId: rosterPersonId,
      status: 'active',
      addedToRosterAt: Timestamp.now(),
      addedToRosterBy: request.auth?.uid ?? null,
      ...(snapshot.exists ? {} : { createdAt: Timestamp.now() }),
    },
    { merge: true },
  );

  /*
   * The other direction of the same rule: this Planning Center person's alias
   * may name an Attendees membership already on the roster. The new document
   * is the keeper — the Planning Center side is canonical for a linked pair —
   * and the Attendees-side document folds into it at once, rather than on the
   * next roster read.
   */
  if (backendId === 'pco' && checkedA32Alias) {
    try {
      const scan = await scanRoster(db());
      const foldDoc = studentDocFor(scan, 'a32', checkedA32Alias);
      if (foldDoc && foldDoc !== studentId) {
        await collapseAliasPair(db(), {
          keeperDoc: studentId,
          foldDoc,
          pcoPersonId: rosterPersonId,
          a32PersonId: checkedA32Alias,
        });
        logger.info('Folded one student held by both backends', {
          keeper: studentId,
          folded: foldDoc,
        });
      }
    } catch (error) {
      logger.warn('Could not fold the Attendees membership for an added person', {
        error: String(error),
      });
    }
  }

  return {
    status: !snapshot.exists ? 'added' : wasActive ? 'already-on-roster' : 'restored',
    studentId,
  };
});

/**
 * Takes somebody off the roster without erasing that they were ever here.
 *
 * Deactivation rather than deletion, and not only out of caution: every
 * attendance record references a student by id, so deleting the row would
 * silently drop those events' head counts and leave history pointing at
 * nobody. An inactive student stops appearing at the door and keeps their past.
 */
export const removeRosterMember = onCall<{ studentId: string }, Promise<{ status: 'removed' }>>(
  { timeoutSeconds: 30, memory: '256MiB' },
  async (request) => {
    await requireCoreTeam(request.auth?.uid);

    const studentId = request.data?.studentId;
    if (typeof studentId !== 'string' || studentId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'studentId is required.');
    }

    const ref = db().doc(`${PATHS.students}/${studentId}`);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpsError('not-found', 'No such student.');

    await ref.set(
      {
        status: 'inactive',
        removedFromRosterAt: Timestamp.now(),
        removedFromRosterBy: request.auth?.uid ?? null,
      },
      { merge: true },
    );
    return { status: 'removed' };
  },
);

/**
 * Copies everybody on a Planning Center list onto Tally's roster, once.
 *
 * The migration path for a church that has been running Tally on list mode, and
 * a shortcut for one that keeps a list for its own reasons. Deliberately a copy
 * and not a link: a List is a saved *query*, so its membership moves on its own
 * — which is precisely why it makes a poor roster and a decent starting point.
 */
export const importPlanningCenterList = onCall<
  { listId: string },
  Promise<{ added: number; alreadyOnRoster: number; restored: number; total: number }>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const listId = request.data?.listId;
  if (typeof listId !== 'string' || listId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'listId is required.');
  }

  const { backend, config } = await pcoBackendFor(db());
  if (!backend) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');
  if (!backend.fetchListMemberIds) {
    throw new HttpsError('failed-precondition', `${backend.displayName} does not have lists.`);
  }

  let personIds: string[];
  try {
    personIds = await backend.fetchListMemberIds(listId);
  } catch (error) {
    return reportBackendFailure(backend.displayName, error, 'read that Planning Center list');
  }

  const database = db();
  const batch = database.batch();
  const now = Timestamp.now();
  let added = 0;
  let restored = 0;
  let alreadyOnRoster = 0;

  for (const personId of personIds) {
    const ref = database.doc(`${PATHS.students}/${pcoStudentId(personId)}`);
    const snapshot = await ref.get();
    const existing = snapshot.exists ? (snapshot.data() ?? {}) : {};

    if (snapshot.exists && existing.status === 'active') {
      alreadyOnRoster += 1;
      continue;
    }
    if (snapshot.exists) restored += 1;
    else added += 1;

    batch.set(
      ref,
      {
        pcoPersonId: personId,
        upstreamBackend: 'pco',
        upstreamPersonId: personId,
        status: 'active',
        addedToRosterAt: now,
        addedToRosterBy: request.auth?.uid ?? null,
        ...(snapshot.exists ? {} : { createdAt: now }),
      },
      { merge: true },
    );
  }

  if (added + restored > 0) await batch.commit();
  return { added, restored, alreadyOnRoster, total: personIds.length };
});

/* -------------------------------------------------------------------------- */
/* Check-Ins history import                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The Check-Ins events a leader could import — Footprints, Sunday school, the
 * preschool room — each with enough history attached to recognise the right
 * one before anything is written.
 *
 * The Check-Ins client — its root derived from the People root, and everything
 * else Planning Center about it — lives inside the adapter now; a backend that
 * cannot derive one reports it as the `failed-precondition` it is.
 *
 * Core team only: this is a view over the whole church's check-in system, not
 * something a door volunteer needs.
 */
export const listCheckInsEvents = onCall<
  { backendId?: string } | undefined,
  Promise<{ events: CheckInsEventSummary[] }>
>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '256MiB' },
  async (request) => {
    await requireCoreTeam(request.auth?.uid);

    const backendId: BackendId = isBackendId(request.data?.backendId)
      ? request.data.backendId
      : 'pco';
    const registry = await createRegistry(db());
    const backend = registry.get(backendId);
    if (!backend) {
      throw new HttpsError(
        'failed-precondition',
        registry.configErrorOf(backendId) ?? 'Not configured.',
      );
    }
    if (!backend.listImportableEvents) {
      throw new HttpsError('failed-precondition', `${backend.displayName} has no history to import.`);
    }

    try {
      return { events: await backend.listImportableEvents() };
    } catch (error) {
      return reportBackendFailure(backend.displayName, error, 'list your Check-Ins events');
    }
  },
);

/**
 * Imports one Check-Ins event's whole history: every gathering anybody
 * attended, everyone who attended one, and every check-in — as ordinary Tally
 * events, roster members and attendance records. See ./pco/checkins.ts for
 * what is written and what is deliberately skipped.
 *
 * Idempotent, and safe to re-run to top a chain up: every id is derived, and
 * nothing a leader has since edited in Tally is overwritten. The timeout is
 * generous because the largest of this church's events is a few thousand
 * check-ins — about a minute of reads — and half a timeout would import half
 * a history.
 *
 * Core team only, like every other write that reshapes the roster.
 */
export const importCheckInsEvent = onCall<
  { pcoEventId: string; backendId?: string },
  Promise<CheckInsImportSummary>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const pcoEventId = request.data?.pcoEventId;
  if (typeof pcoEventId !== 'string' || pcoEventId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'pcoEventId is required.');
  }

  const backendId: BackendId = isBackendId(request.data?.backendId)
    ? request.data.backendId
    : 'pco';
  const registry = await createRegistry(db());
  const backend = registry.get(backendId);
  if (!backend) {
    throw new HttpsError(
      'failed-precondition',
      registry.configErrorOf(backendId) ?? 'Not configured.',
    );
  }
  if (!backend.importHistory) {
    throw new HttpsError('failed-precondition', `${backend.displayName} has no history to import.`);
  }

  /*
   * An import writes events *and* attendance under a chain derived from the
   * upstream event id — `pco-checkins-{id}`, deterministic, which is what makes
   * re-importing the same event idempotent and what makes the chain knowable
   * here without running the import first.
   *
   * That determinism is also why this needs a gate: import the same Check-Ins
   * event twice with a restriction added in between and the second run would
   * write straight into a gathering the caller is no longer on, through the
   * Admin SDK, past every rule.
   */
  await requireOnChain(request.auth!.uid, checkInsRootEventId(pcoEventId.trim()));

  // Occurrence ids embed the ministry-local calendar day, and this container
  // runs in UTC — same reasoning, same fix as `materializeOccurrence`.
  process.env.TZ = MINISTRY_TIME_ZONE;

  /*
   * Before an Attendees import, ask Planning Center which of the roster's
   * students *are* Attendees people — the `attendees_uuid` aliases — so an
   * attendee the roster already holds files their history under the
   * membership the church already has, not under a second one. Best effort:
   * an unreadable alias list means an import that behaves as before, never a
   * failed import.
   */
  let existingStudentIds: Record<string, string> | undefined;
  if (backendId === 'a32') {
    const pco = registry.get('pco');
    if (pco) {
      try {
        const scan = await scanRoster(db());
        const aliases =
          (await pco.fetchRoster({ personIds: scanIdsFor(scan, 'pco') })).a32Aliases ?? {};
        const byUuid = existingStudentIdByA32Uuid(scan, aliases);
        if (Object.keys(byUuid).length > 0) existingStudentIds = byUuid;
      } catch (error) {
        logger.warn('Could not resolve Planning Center aliases before an Attendees import', {
          error: String(error),
        });
      }
    }
  }

  try {
    return await backend.importHistory({
      upstreamEventId: pcoEventId.trim(),
      uid: request.auth!.uid,
      now: new Date(),
      logger,
      existingStudentIds,
    });
  } catch (error) {
    return reportBackendFailure(backend.displayName, error, 'import that Check-Ins event');
  }
});

/* -------------------------------------------------------------------------- */
/* Write-back                                                                  */
/* -------------------------------------------------------------------------- */

export const pushStudentToPlanningCenter = onCall<
  { studentId: string; backendId?: string },
  Promise<PushStudentResult>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  /*
   * A linked student is pushed to the backend that holds them; an unlinked
   * one to wherever new students go. The explicit override is for the button
   * that says which — pushing a visitor to a named backend rather than the
   * default.
   */
  const registry = await createRegistry(db());
  let resolution: { backend: PeopleBackend } | { error: string };
  if (isBackendId(request.data?.backendId)) {
    const chosen = registry.get(request.data.backendId);
    resolution = chosen
      ? { backend: chosen }
      : { error: registry.configErrorOf(request.data.backendId) ?? 'Not configured.' };
  } else {
    resolution = await backendForStudent(registry, db(), studentId);
  }
  if ('error' in resolution) {
    return { status: 'skipped', pcoPersonId: null, message: resolution.error };
  }

  const backend = resolution.backend;
  const result = await backend.pushStudent({ studentId, logger });
  // A student who is now in the backend must not be missing from the next
  // roster read because a cached copy predates them.
  if (result.status !== 'skipped') backend.resetCache();
  return result;
});

/**
 * Adds a parent's phone number or email to a student's household upstream.
 *
 * Gated twice over, and deliberately narrow in what it can do at all. It refuses
 * unless write-back is `full`, and even then it only ever creates a PhoneNumber
 * or an Email on an adult Planning Center *already* has in the household — it
 * cannot create a person, a household, or a membership. A student with no family
 * on file has no write path here at all; the app links out to Planning Center
 * for that, which is where the family has to be built anyway.
 *
 * Core team only. This writes to the church's permanent people database, which
 * is a wider blast radius than anything a door volunteer does.
 */
export const setParentContact = onCall<
  { studentId: string; phone?: string | null; email?: string | null },
  Promise<SetParentContactResult>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  const registry = await createRegistry(db());
  const resolution = await backendForStudent(registry, db(), studentId);
  if ('error' in resolution) {
    throw new HttpsError('failed-precondition', resolution.error);
  }
  const backend = resolution.backend;

  let result: SetParentContactResult;
  try {
    result = await backend.setParentContact({
      studentId,
      phone: request.data?.phone ?? null,
      email: request.data?.email ?? null,
      logger,
    });
  } catch (error) {
    return reportBackendFailure(
      backend.displayName,
      error,
      `add a parent contact in ${backend.displayName}`,
    );
  }

  /*
   * Drop just this student's cached details rather than the whole cache. The
   * screen that called this re-reads immediately, and a held answer from
   * moments ago would show the number as still missing — but nothing else about
   * the roster changed, and a full reset would make every other counselor's
   * next read pay for one edit.
   */
  if (result.status === 'updated') {
    const personId = personIdFromStudentId(studentId);
    if (personId) backend.invalidatePersonDetails(personId);
    // And the sweep behind "incomplete profiles", which has just stopped being
    // true about this household.
    backend.invalidateReachability();
  }

  return result;
});

/**
 * Saves the Edit profile form for a student Planning Center already has.
 *
 * The counterpart of `pushStudentToPlanningCenter`, and deliberately a separate
 * entry point: that one reconciles a student *Tally* holds, this one carries an
 * edit straight upstream for a student Tally holds nothing about. Nothing is
 * written to Firestore on the way through — a linked student's name, grade and
 * allergies are Planning Center's, and a copy left in Tally would be shown by
 * nothing and re-pushed later.
 *
 * Refuses unless write-back is `full`, and touches only the attributes that
 * actually changed. Core team only, like every other write into the church's
 * people database.
 */
export const updateStudentProfile = onCall<
  { studentId: string } & StudentProfilePatch,
  Promise<UpdateStudentProfileResult>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  const registry = await createRegistry(db());
  const resolution = await backendForStudent(registry, db(), studentId);
  if ('error' in resolution) {
    throw new HttpsError('failed-precondition', resolution.error);
  }
  const backend = resolution.backend;

  let result: UpdateStudentProfileResult;
  try {
    result = await backend.updateStudentProfile({
      studentId,
      firstName: request.data?.firstName,
      nickname: request.data?.nickname,
      lastName: request.data?.lastName,
      grade: request.data?.grade,
      allergies: request.data?.allergies,
      birthday: request.data?.birthday,
      logger,
    });
  } catch (error) {
    return reportBackendFailure(
      backend.displayName,
      error,
      `save this profile to ${backend.displayName}`,
    );
  }

  /*
   * The whole cache, not just this student's details: a renamed or regraded
   * person changes the *roster* — how they sort, whether the grade band still
   * includes them — and that answer is held under a different key on every
   * device that asks. One edit is a fine price for one cold read.
   */
  if (result.status === 'updated') backend.resetCache();

  return result;
});

/**
 * Builds a student a family: a parent, and a household if they have none.
 *
 * The widest write Tally makes, and the only one that says something about a
 * *family* rather than about a field — so it is also the one with a human in
 * the loop. Given a name it has not been told to accept, it searches Planning
 * Center for adults who already have it and hands them back rather than
 * creating a second record for somebody the church already knows; the caller
 * chooses one, or says to create a new person anyway.
 *
 * Refuses unless write-back is `full`, refuses once an adult is already in the
 * household — `setParentContact` is that path — and never overwrites a contact
 * detail on file. Core team only.
 */
export const addParent = onCall<
  {
    studentId: string;
    personId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    email?: string | null;
    createNew?: boolean;
  },
  Promise<AddParentResult>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  const registry = await createRegistry(db());
  const resolution = await backendForStudent(registry, db(), studentId);
  if ('error' in resolution) {
    throw new HttpsError('failed-precondition', resolution.error);
  }
  const backend = resolution.backend;

  let result: AddParentResult;
  try {
    result = await backend.addParent({
      studentId,
      personId: request.data?.personId ?? null,
      firstName: request.data?.firstName ?? null,
      lastName: request.data?.lastName ?? null,
      phone: request.data?.phone ?? null,
      email: request.data?.email ?? null,
      createNew: request.data?.createNew === true,
      logger,
    });
  } catch (error) {
    return reportBackendFailure(
      backend.displayName,
      error,
      `add a parent in ${backend.displayName}`,
    );
  }

  /*
   * The whole cache, unlike `setParentContact`'s surgical drop. A new household
   * changes who is reachable and who counts as unreachable across every screen
   * that asks — the student's details, the incomplete-profiles sweep keyed by
   * household, and the roster's own view of this family. One cold read is the
   * right price for a family that did not exist a second ago.
   */
  if (result.status === 'added') backend.resetCache();

  return result;
});

/**
 * Puts a person back in Planning Center for a student whose record died there.
 *
 * The other half of the attendance freeze: a student flagged
 * `upstreamRecordMissing` cannot accumulate attendance under a dead id, and
 * this is the sanctioned way to thaw them without taking them off the roster. The flow itself lives in
 * ./pco/recreate.ts and refuses to create where creating would be wrong — a
 * record that still exists clears the flag, a merge with a living survivor
 * relinks instead.
 */
export const recreatePlanningCenterPerson = onCall<
  { studentId: string; firstName?: string | null; lastName?: string | null; grade?: number | null },
  Promise<RecreateStudentResult>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  const registry = await createRegistry(db());
  const resolution = await backendForStudent(registry, db(), studentId);
  if ('error' in resolution) {
    throw new HttpsError('failed-precondition', resolution.error);
  }
  const backend = resolution.backend;

  let result: RecreateStudentResult;
  try {
    result = await backend.recreateStudent({
      studentId,
      firstName: request.data?.firstName ?? undefined,
      lastName: request.data?.lastName ?? undefined,
      grade: typeof request.data?.grade === 'number' ? request.data.grade : undefined,
      logger,
    });
  } catch (error) {
    return reportBackendFailure(
      backend.displayName,
      error,
      `re-create this student in ${backend.displayName}`,
    );
  }

  // A new (or newly pointed-at) person changes what every cached read answers.
  if (result.status === 'recreated' || result.status === 'relinked') backend.resetCache();

  return result;
});

/**
 * Retries every visitor whose push has not landed.
 *
 * This used to run after each scheduled sweep. With the sweep gone it is a
 * button, which is honest: the queue only ever holds students created while
 * Planning Center was unreachable or write-back was off, and both of those are
 * things a person notices and fixes.
 */
export const pushPendingVisitors = onCall<void, Promise<PushPendingResult>>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 300, memory: '256MiB' },
  async (request): Promise<PushPendingResult> => {
    await requireCoreTeam(request.auth?.uid);

    const registry = await createRegistry(db());
    const target = registry.defaultPush();
    if ('error' in target) return { pushed: 0, skipped: 0, errors: 0 };

    const result = await target.backend.pushPendingStudents({ logger });
    if (result.pushed > 0) target.backend.resetCache();
    return result;
  },
);

/**
 * A quick-added visitor should exist in Planning Center before the counselor has
 * walked back to the door. Best effort only: `pushPendingVisitors` reconciles
 * anything that failed, so a Planning Center outage never blocks check-in.
 */
export const onStudentCreated = onDocumentCreated(
  {
    document: 'students/{studentId}',
    secrets: BACKEND_SECRETS,
    timeoutSeconds: 120,
    memory: '256MiB',
    retry: false,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    /*
     * The kiosk pulse first, BEFORE the push gating below: the early returns
     * skip held children and backend imports, and those are exactly the
     * students a lobby kiosk must learn about. Debounced, because this trigger
     * fires once per document — a 400-person list import must cost a couple of
     * pulse writes, not 400. `retry: false` above means a bump-then-crash
     * cannot double anything.
     *
     * This is the welcome-desk case: a child quick-added in the main app is
     * findable on every kiosk within about a minute, with nobody pressing
     * anything.
     */
    await bumpPulse(db(), ['roster'], new Date(), { debounceMs: PULSE_DEBOUNCE_MS, logger });

    if (
      data.upstreamPushPending !== true ||
      typeof data.pcoPersonId === 'string' ||
      typeof data.upstreamPersonId === 'string'
    ) {
      return;
    }
    /*
     * A family who registered themselves is held until somebody has looked at
     * them — see backends/pendingReview.ts. This used to key off
     * `registrationId`, which was the same set of students by accident rather
     * than by meaning; `registrationId` is provenance now, and the hold is the
     * hold. `approveRegistration` clears it and pushes, in the order a
     * household needs.
     */
    if (isHeldForReview(data)) return;

    const registry = await createRegistry(db());
    const target = registry.defaultPush();
    if ('error' in target) return;
    const backend = target.backend;
    if (backend.capabilities.writeBack === 'off') return;

    try {
      const result = await backend.pushStudent({ studentId: event.params.studentId, logger });
      // The roster cache predates this person; without the drop they would be
      // missing from the next read for up to the TTL.
      if (result.status !== 'skipped') backend.resetCache();
      logger.info('Pushed a new student to the people backend', {
        studentId: event.params.studentId,
        backend: backend.id,
        ...result,
      });
    } catch (error) {
      logger.warn('Immediate push failed; a leader can retry from Settings', {
        studentId: event.params.studentId,
        error: String(error),
      });
    }
  },
);

/* -------------------------------------------------------------------------- */
/* The profile-edit queue                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Runs one queued edit against whichever backend holds the student.
 *
 * Everything this function decides is a *classification*: it turns one
 * backend's answer into one of the six outcomes `upstreamEdits.ts` knows how to
 * write down, so the drain itself never has to know what Planning Center is.
 * The two interesting judgements:
 *
 * **Merged is decided on the id, never on the values.** `readThroughMerges`
 * follows a person through however many merges their record has been part of,
 * so an edit against somebody merged mid-flight lands — on the survivor, under
 * a different id than the job named. If the fields also differed, `differs`
 * could describe it; if they did not, nothing would, and the job would report
 * success while the student now resolves to a different human. So the id is
 * compared first and wins outright.
 *
 * **`differs` is judged against the baseline the form was showing.** A field
 * whose upstream value is neither what was typed nor what the form opened on is
 * a field somebody else changed in between, and saying so is the difference
 * between reporting a save and asserting a value nobody holds.
 */
async function runUpstreamEdit(edit: EditRecord): Promise<RunOutcome> {
  const registry = await createRegistry(db());
  const resolution = await backendForStudent(registry, db(), edit.studentId);
  if ('error' in resolution) {
    return { kind: 'refused', failure: 'writeBackOff', message: resolution.error };
  }
  const backend = resolution.backend;

  if (backend.capabilities.writeBack !== 'full') {
    return {
      kind: 'refused',
      failure: 'writeBackOff',
      message: `Write-back to ${backend.displayName} is not switched on, so this edit was not saved. An admin can turn it on in Settings.`,
    };
  }

  const patch = edit.patch as StudentProfilePatch;
  const namedPersonId = personIdFromStudentId(edit.studentId);

  let result;
  try {
    result = await backend.updateStudentProfile({
      studentId: edit.studentId,
      ...patch,
      /*
       * What the form was showing, which turns this into a compare-and-set.
       *
       * A queued edit may have been written minutes ago on a phone with no
       * signal. Arriving second must not mean winning: if somebody in the
       * church office changed the same field in between, nothing is written and
       * a human is asked which is right.
       */
      expect: {
        lastName: typeof edit.baseline.lastName === 'string' ? edit.baseline.lastName : undefined,
        grade:
          edit.baseline.grade === null || typeof edit.baseline.grade === 'number'
            ? (edit.baseline.grade as number | null)
            : undefined,
      },
      logger,
    });
  } catch (error) {
    const status = backendFailureStatus(error);
    if (status === 401 || status === 403) {
      return {
        kind: 'refused',
        failure: 'auth',
        message: `${backend.displayName} refused Tally's credentials. An admin has to reconnect it; retrying will not help.`,
      };
    }
    if (status === 404 || status === 410) return { kind: 'orphaned' };
    /*
     * Anything else in the 4xx range is the backend having read the request and
     * said no — a name it will not take, a grade outside its own range. The
     * same patch sent again gets the same answer, so retrying it is four more
     * round trips ending in "could not reach Planning Center", which is both
     * untrue and points a leader at the network instead of at the value they
     * typed. It goes to the screen at once, in the backend's own words.
     *
     * The exceptions are the ones where the request was fine and the moment
     * was not: 408 and 409 are worth repeating as-is, and a 429 has already
     * been retried inside the client with `Retry-After` honoured — reaching
     * here means that ran out, not that the backend said no.
     */
    if (status !== null && status >= 400 && status < 500 && ![408, 409, 429].includes(status)) {
      return {
        kind: 'refused',
        failure: 'validation',
        message: describeBackendRefusal(error, backend.displayName),
      };
    }
    // 429s, 5xx and anything that never got an answer at all.
    return {
      kind: 'retry',
      retryAfterMs: retryAfterOf(error),
      message: `Could not reach ${backend.displayName} to save this. It will try again on its own.`,
    };
  }

  if (result.status === 'no-student' || result.status === 'not-in-planning-center') {
    return { kind: 'orphaned', message: result.message };
  }
  if (result.status === 'invalid') {
    return { kind: 'refused', failure: 'validation', message: result.message };
  }
  if (result.status === 'disabled') {
    return { kind: 'refused', failure: 'writeBackOff', message: result.message };
  }

  const person = result.person;

  // Identity first, and outright. See the note above.
  if (person && namedPersonId && person.pcoPersonId !== namedPersonId) {
    return {
      kind: 'merged',
      survivorPersonId: person.pcoPersonId,
      survivorName: `${person.firstName} ${person.lastName}`.trim(),
      message: result.message,
    };
  }

  if (result.status === 'conflict') {
    return {
      kind: 'differs',
      observed: disagreementsWith(edit, result.before) ?? {},
      message: result.message,
    };
  }

  if (result.status === 'updated') {
    backend.resetCache();
  } else {
    // `unchanged` is often this browser discovering it was the stale one, and
    // the roster row it hands back is the correction. Nothing was written, so
    // the whole cache does not have to pay for it.
    backend.invalidateReachability();
  }
  return { kind: 'landed', message: result.message };
}

/**
 * What the backend was holding instead, for the strip to show beside what was
 * typed.
 *
 * The refusal itself is the adapter's — it compares and declines to set, so
 * nothing of the office's is overwritten by an edit that arrived second. This
 * only reads the row that came back with that refusal.
 *
 * Only the two fields a roster row can answer for. An allergy note and a birth
 * year are deliberately not on a roster row, so there is nothing here to
 * disagree with, and inventing a disagreement would be worse than saying
 * nothing.
 */
function disagreementsWith(
  edit: EditRecord,
  before: { lastName: string; grade: number | null } | null,
): Record<string, unknown> | null {
  if (!before) return null;
  const out: Record<string, unknown> = {};

  const wantedLast = edit.patch.lastName;
  const baseLast = edit.baseline.lastName;
  if (
    typeof wantedLast === 'string' &&
    before.lastName !== wantedLast &&
    before.lastName !== baseLast
  ) {
    out.lastName = before.lastName;
  }

  const wantedGrade = edit.patch.grade;
  const baseGrade = edit.baseline.grade;
  if (
    wantedGrade !== undefined &&
    before.grade !== wantedGrade &&
    before.grade !== (baseGrade ?? null)
  ) {
    out.grade = before.grade;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * What a backend said when it refused, in words a leader can act on.
 *
 * The error carries the backend's own `detail` lines, and they are the only
 * account of *which* value was wrong — "Grade must be between 1 and 12" is a
 * sentence somebody can go and fix, and a generic "Planning Center would not
 * accept this" sends them back to the form to guess. They are written for
 * developers, so they get a sentence of Tally's around them rather than being
 * dropped on the screen alone, and a status-only fallback covers the backends
 * that refuse without saying anything.
 */
function describeBackendRefusal(error: unknown, displayName: string): string {
  const details = error instanceof PcoApiError
    ? error.errors.map((detail) => detail.detail ?? detail.title).filter(Boolean)
    : [];
  const said = details.join('; ').trim();
  return said
    ? `${displayName} would not accept this: ${said}`
    : `${displayName} would not accept this, and sending it again unchanged will not help.`;
}

/** What the backend asked us to wait, where it said. */
function retryAfterOf(error: unknown): number | null {
  const value = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function drainDeps(): DrainDeps {
  return { db: db(), now: () => new Date(), run: runUpstreamEdit, logger };
}

/**
 * The ordinary path: the device that made the edit asks for it to be sent.
 *
 * This used to be `onUpstreamEditCreated`, a Firestore trigger. The trigger's
 * entire job was latency — start the drain in a second or two rather than
 * waiting for the sweep — and the browser that just pressed Save can do that
 * itself, sooner and with one less moving part: no Eventarc registration, no
 * second function cold-starting behind the first.
 *
 * What it is *not* is the thing that makes an edit durable. That is the job
 * document, which is written before this is called and is picked up by the
 * sweep below whatever happens to the tab. So this may fail, be skipped, or
 * never be called at all, and the only consequence is that the edit goes
 * within the sweep's period instead of within a second. Nothing here is
 * allowed to become load-bearing.
 *
 * Scoped to one student rather than the queue, and core team rather than
 * admin: the caller has just created a job for that child and is asking for
 * their own work to be done. `drainUpstreamEditsNow` remains the wide,
 * admin-only poke, because deciding to talk to the whole church database at
 * once is a different decision.
 *
 * Draining the *student* rather than the edit is what folds two saves in a
 * row into one upstream write — the same reason the trigger did it.
 */
export const drainStudentEdits = onCall<{ studentId: string }, Promise<{ states: string[] }>>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 300, memory: '256MiB' },
  async (request): Promise<{ states: string[] }> => {
    await requireCoreTeam(request.auth?.uid);

    const studentId = request.data?.studentId;
    if (typeof studentId !== 'string' || studentId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'studentId is required.');
    }

    const states = await drainStudent(studentId, drainDeps());
    return { states };
  },
);

/**
 * Drains the queue now, rather than within the minute.
 *
 * The callable twin of the schedule below, and every scheduled job in this
 * codebase has one — `pushPendingVisitors` beside `pushPendingStudents`,
 * `refreshKioskPhoneIndex` beside `rebuildKioskPhoneIndex`. The reason is the
 * same each time: a job that only ever runs on a timer is one nobody can do
 * anything about at the moment they are looking at it. An admin who has just
 * reconnected a credential should not have to wait out a minute to find out
 * whether it worked, and a queue that looks stuck should be pokeable.
 *
 * Admin only. It is not a write of its own — everything it can do, the schedule
 * does anyway — but it decides *when* the church's people database is talked
 * to, and pacing is the whole reason the sweep takes small batches.
 */
export const drainUpstreamEditsNow = onCall<{ limit?: number } | void, Promise<SweepResult>>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 300, memory: '256MiB' },
  async (request): Promise<SweepResult> => {
    await requireAdmin(request.auth?.uid);
    const limit = typeof request.data?.limit === 'number' ? request.data.limit : undefined;
    const result = await sweepEdits(drainDeps(), limit);
    logger.info('Drained the upstream edit queue on request', result);
    return result;
  },
);

/**
 * Everything a browser cannot be trusted to cover.
 *
 * A job whose tab was closed between writing it and asking for it, one
 * abandoned by a worker that died mid-request, a backed-off retry nobody is
 * watching any more, and the sweeping of settled ones. In small batches: a
 * queue that built up through an outage drains into an API that rate-limits,
 * and stampeding it is how a recovery turns back into an outage.
 *
 * Every five minutes rather than every one. It stopped being the thing that
 * decides how long an ordinary edit takes the moment the client began asking
 * for its own drain — including for a retry, which the tab schedules against
 * `nextAttemptAt` while it is open. What is left here is the case where there
 * is no tab, and five minutes is a fair answer to "nobody is watching this".
 * A ministry that edits nine profiles a week was paying for 1,440 sweeps a day
 * to find nothing.
 */
export const drainUpstreamEdits = onSchedule(
  {
    schedule: 'every 5 minutes',
    secrets: BACKEND_SECRETS,
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async () => {
    const result = await sweepEdits(drainDeps());
    if (result.ran > 0 || result.swept > 0) {
      logger.info('Swept the upstream edit queue', result);
    }
  },
);

/* -------------------------------------------------------------------------- */
/* Occurrences                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Brings one projected gathering into existence.
 *
 * Tally's calendar is computed from the recurrence rules rather than written
 * down ahead of time, so next Friday is a projection until somebody does
 * something about it. This is what they press against: check-in opening the
 * screen, a leader cancelling or editing it. After this returns, the id the app
 * was already showing names a real document.
 *
 * Any active member may call it, which is the point — check-in is a counselor's
 * job and `events` is core-team-writable. Safety comes from the request being
 * unable to say anything that matters: `chain` and `startAt` are a *question*,
 * and `materializeOne` refuses unless the projection independently agrees that
 * the occurrence exists. The document's id and every field of it are derived
 * from events that already passed the security rules.
 *
 * `MINISTRY_TIME_ZONE` is what makes a "19:00 Friday" gathering land at 19:00.
 * The expander builds every date with the local-time `Date` constructor, and a
 * Cloud Functions container is UTC, which either side of a DST change would put
 * a Friday evening on the wrong calendar day.
 */
export const materializeOccurrence = onCall<
  { chain: string; startAt: number },
  Promise<{ id: string; created: boolean }>
>({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  await requireMember(request.auth?.uid);

  // Safe to set globally because a v2 function is its own service — nothing
  // else shares this container.
  process.env.TZ = MINISTRY_TIME_ZONE;

  const chain = request.data?.chain;
  const startAt = request.data?.startAt;
  if (typeof chain !== 'string' || chain.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'chain is required.');
  }
  if (typeof startAt !== 'number' || !Number.isFinite(startAt)) {
    throw new HttpsError('invalid-argument', 'startAt must be a timestamp in milliseconds.');
  }

  /*
   * The gate that closes the one hole the rules cannot.
   *
   * A projected occurrence has no document until this runs, and its derived id
   * (`{chain}-{date}`) has no `eventAccess` document of its own — so
   * `eventChain()` in the rules falls back to the id and finds nothing to
   * refuse. Refusing here is what stops an occurrence of a restricted chain
   * ever becoming real for somebody outside it, and therefore what stops
   * attendance being filed under it.
   */
  await requireOnChain(request.auth!.uid, chain);

  const result = await materializeOne(
    db(),
    { chain, startAt: new Date(startAt), uid: request.auth!.uid },
    new Date(),
    logger,
  );

  // Not an error the caller can fix by retrying: either the rule does not put a
  // gathering there, or it has since been changed so that it no longer does.
  if (!result) {
    throw new HttpsError('not-found', 'That is not a gathering the schedule describes.');
  }

  return result;
});

/**
 * One student's attendance, filtered by what the caller may actually see.
 *
 * This exists because of a shape in the security rules that cannot be fixed
 * inside them. A student's profile answers "when did this child come?" with a
 * collection-group query over `attendance`, which is one indexed read for any
 * depth of history rather than a read per night. A collection-group query can
 * only be authorised by a rule at a wildcard path — and a wildcard path has no
 * single parent event, so no rule there can ask which gathering a record
 * belongs to, let alone whether the reader is on it.
 *
 * Worse, the wildcard also matches an ordinary subcollection query, so the rule
 * that made the profile possible was quietly granting `list` over every
 * restricted register too. The two facts together mean the wildcard has to be
 * denied outright, and the query has to move somewhere that can filter. Here.
 *
 * The Admin SDK bypasses rules, so this is the gate for these reads. Nothing
 * about that is incidental — get the filtering wrong here and there is no
 * second fence behind it.
 */
export const getStudentAttendance = onCall<
  {
    studentId?: string;
    /** Milliseconds. The cheap form: which nights, since when. */
    since?: number;
    /** The paged form. Serialisable, unlike the snapshot cursor it replaces. */
    cursor?: { checkedInAt: number; path: string } | null;
    pageSize?: number;
  },
  Promise<{
    /** The `since` form: event ids, newest first. Absent on a paged call. */
    eventIds?: string[];
    /** The paged form. Absent on a `since` call. */
    records?: Array<{ eventId: string; id: string; data: Record<string, unknown> }>;
    cursor?: { checkedInAt: number; path: string } | null;
    hasMore?: boolean;
    /** Chains left out because the caller is not on them. */
    withheld: string[];
  }>
>({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  await requireMember(request.auth?.uid);
  const uid = request.auth!.uid;
  const caller = await readCaller(uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  // The raw handle rather than `db()`: this needs `collectionGroup`, which the
  // narrowed `FirestoreLike` deliberately does not expose.
  const firestore = getFirestore();
  const reader = new ChainAccessReader(firestore, uid, caller.role === 'admin');

  /*
   * The chain a record belongs to, from the event document rather than from the
   * record's own `seriesId` field.
   *
   * The two agree — the rules require it on every write — but the record is
   * written by the client and the event is the thing the ACL is actually keyed
   * on. Trusting the record here would let a forged `seriesId` name an open
   * chain and walk a restricted register out through this callable, which is
   * the one place with no rules behind it.
   */
  const chains = new Map<string, string>();
  const chainOf = async (eventId: string): Promise<string> => {
    const held = chains.get(eventId);
    if (held !== undefined) return held;

    const snapshot = await firestore.doc(`events/${eventId}`).get();
    const data = snapshot.exists ? (snapshot.data() ?? {}) : {};
    const chain =
      typeof data.seriesId === 'string' && data.seriesId.length > 0
        ? data.seriesId
        : typeof data.recurrenceRootId === 'string' && data.recurrenceRootId.length > 0
          ? data.recurrenceRootId
          : eventId;

    chains.set(eventId, chain);
    return chain;
  };

  /** The event id from the document's own path — see `fetchStudentHistory`. */
  const eventIdOf = (ref: FirebaseFirestore.DocumentReference): string | null =>
    ref.parent.parent?.id ?? null;

  const withheld = new Set<string>();

  /* ---- The cheap form: which nights, since when ------------------------- */

  if (typeof request.data?.since === 'number') {
    const snapshot = await firestore
      .collectionGroup('attendance')
      .where('studentId', '==', studentId)
      .where('checkedInAt', '>=', Timestamp.fromMillis(request.data.since))
      .orderBy('checkedInAt', 'desc')
      .get();

    const eventIds: string[] = [];
    for (const document of snapshot.docs) {
      const eventId = eventIdOf(document.ref);
      if (!eventId) continue;
      const chain = await chainOf(eventId);
      if (await reader.canWork(chain)) eventIds.push(eventId);
      else withheld.add(chain);
    }

    return { eventIds: [...new Set(eventIds)], withheld: [...withheld] };
  }

  /* ---- The paged form --------------------------------------------------- */

  const pageSize = Math.min(Math.max(request.data?.pageSize ?? 20, 1), 100);
  const cursor = request.data?.cursor ?? null;

  /*
   * The cursor is `checkedInAt` plus the document path, because the client can
   * no longer hold a snapshot. `checkedInAt` alone is not unique — an import
   * can stamp a whole register with one instant — so the path is what stops a
   * page boundary from dropping or repeating a row. `__name__` is the implicit
   * tiebreak Firestore already orders by, named here so `startAfter` can take
   * a value for it.
   */
  const base = firestore
    .collectionGroup('attendance')
    .where('studentId', '==', studentId)
    .orderBy('checkedInAt', 'desc')
    .orderBy('__name__', 'desc');

  /*
   * Over-read, because a page can filter down.
   *
   * Twenty rows in may be six rows out for a student who attends a restricted
   * gathering, and a client that inferred "no more" from a short page would
   * stop the profile's infinite scroll at the first such page — silently, on
   * the screen whose entire job is showing a complete history. So the loop
   * keeps reading until the page is full or the query is exhausted, and
   * `hasMore` is stated rather than guessed.
   */
  const records: Array<{ eventId: string; id: string; data: Record<string, unknown> }> = [];
  let last: { checkedInAt: number; path: string } | null = cursor;
  let exhausted = false;

  while (records.length < pageSize && !exhausted) {
    const batch = await (last
      ? base.startAfter(
          Timestamp.fromMillis(last.checkedInAt),
          firestore.doc(last.path),
        )
      : base
    )
      .limit(pageSize)
      .get();

    if (batch.empty) {
      exhausted = true;
      break;
    }
    if (batch.docs.length < pageSize) exhausted = true;

    for (const document of batch.docs) {
      const data = document.data();
      const checkedInAt = data.checkedInAt as Timestamp | undefined;
      last = {
        checkedInAt: checkedInAt?.toMillis() ?? 0,
        path: document.ref.path,
      };

      const eventId = eventIdOf(document.ref);
      if (!eventId) continue;

      const chain = await chainOf(eventId);
      if (!(await reader.canWork(chain))) {
        withheld.add(chain);
        continue;
      }

      records.push({ eventId, id: document.id, data: serialiseAttendance(data) });
      if (records.length >= pageSize) break;
    }
  }

  return {
    records,
    cursor: exhausted && records.length === 0 ? null : last,
    hasMore: !exhausted,
    withheld: [...withheld],
  };
});

/** Timestamps to millis, so the page survives the wire. */
function serialiseAttendance(data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = value instanceof Timestamp ? value.toMillis() : value;
  }
  return out;
}

/**
 * Removes a gathering, or every gathering in one chain of repeats, along with
 * the check-ins filed under it.
 *
 * Core team only, matching the rules on `events` — and a step beyond what those
 * rules can do on their own, because deleting a document leaves its
 * subcollections behind. See `functions/src/eventDeletion.ts` for why that is
 * the whole reason this runs on a server.
 *
 * `preview` is how the confirmation dialog knows what it is asking about. It
 * counts through exactly the code that would delete, so the number somebody
 * agrees to is the number that goes.
 */
export const deleteEvents = onCall<
  { scope?: unknown; eventId?: unknown; chain?: unknown; preview?: unknown },
  Promise<DeletionSummary>
>({ timeoutSeconds: 300, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const scope = request.data?.scope;
  let target: DeletionTarget;

  if (scope === 'event') {
    const eventId = request.data?.eventId;
    if (typeof eventId !== 'string' || eventId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'eventId is required.');
    }
    target = { scope: 'event', eventId };
    await requireOnEvent(request.auth!.uid, eventId);
  } else if (scope === 'chain') {
    const chain = request.data?.chain;
    if (typeof chain !== 'string' || chain.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'chain is required.');
    }
    target = { scope: 'chain', chain };
    await requireOnChain(request.auth!.uid, chain);
  } else {
    throw new HttpsError('invalid-argument', "scope must be 'event' or 'chain'.");
  }

  /*
   * `preview` is gated too, and that is not belt-and-braces. It counts through
   * exactly the code that would delete — so an ungated preview answers "how
   * many students have ever been to your restricted gathering" to anybody who
   * asks, without deleting anything and without leaving a trace.
   */

  const summary = await removeEvents(db(), target, logger, {
    apply: request.data?.preview !== true,
  });

  // Only reachable for a single event: a chain that matches nothing deletes
  // nothing and says so. Either the gathering is one the recurrence rules
  // merely describe — there is no document to remove — or another device
  // removed it first, and both read the same way to whoever is looking.
  if (!summary) {
    throw new HttpsError('not-found', 'That gathering is no longer here.');
  }

  return summary;
});

/* -------------------------------------------------------------------------- */
/* Kiosk                                                                       */
/* -------------------------------------------------------------------------- */

/*
 * The self-serve check-in kiosk: a browser on a shelf holding a custom-token
 * session for the staff member who approved it. The handshake and its
 * reasoning live in ./kiosk/pairing.ts; these wrappers add only what belongs
 * at an entry point — argument checking, the permission gate on approval, and
 * the Admin SDK's token mint.
 */

/**
 * UNAUTHENTICATED — the kiosk has no identity yet; acquiring one is the point.
 * The guardrails are in the module: a cap on live pairings, a ten-minute
 * expiry, and the fact that nothing here grants anything — only an
 * authenticated approval does.
 */
export const startKioskPairing = onCall<void, Promise<StartPairingResult>>(
  { timeoutSeconds: 30, memory: '256MiB' },
  async (): Promise<StartPairingResult> => {
    const result = await startPairing(db(), new Date());
    if (result === 'busy') {
      throw new HttpsError('resource-exhausted', 'Too many kiosks are pairing right now. Try again in a few minutes.');
    }
    return result;
  },
);

/**
 * A staff member vouching for the code on a kiosk's screen. Any active member:
 * the identity the kiosk inherits is the approver's own, and the attendance
 * rules already require that identity to be at least a counselor for its
 * writes to land.
 */
export const approveKioskPairing = onCall<
  { code?: unknown },
  Promise<{ status: ApprovePairingStatus }>
>({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  await requireMember(request.auth?.uid);

  const code = request.data?.code;
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'code is required.');
  }

  return { status: await approvePairing(db(), code, request.auth!.uid, new Date()) };
});

/**
 * UNAUTHENTICATED — polled by the kiosk until the approval lands. The secret
 * is what stands between the code on the lobby screen and the token: only the
 * device that started the pairing holds it.
 *
 * Deployed minting needs the runtime service account to hold
 * `roles/iam.serviceAccountTokenCreator` on itself — see docs/data-model.md's
 * kiosk section. The Auth emulator mints unsigned tokens and needs nothing.
 */
export const claimKioskToken = onCall<
  { code?: unknown; secret?: unknown },
  Promise<{ status: 'pending' | 'not-found' | 'expired' } | { status: 'ready'; token: string }>
>({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const code = request.data?.code;
  const secret = request.data?.secret;
  if (typeof code !== 'string' || typeof secret !== 'string') {
    throw new HttpsError('invalid-argument', 'code and secret are required.');
  }

  const result = await claimPairing(db(), code, secret, new Date());
  if (result.status !== 'ready') return { status: result.status };

  const token = await getAuth().createCustomToken(result.uid, { kiosk: true });
  return { status: 'ready', token };
});

/**
 * The kiosk's event chooser: every gathering in the window, materialised or
 * merely described by a recurrence rule. Same projection the app renders, run
 * on the server so the kiosk bundle carries none of it. Any active member —
 * which a paired kiosk is, as its approver.
 */
export const getKioskEvents = onCall<
  { days?: unknown } | undefined,
  Promise<{ events: KioskEventEntry[] }>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  await requireMember(request.auth?.uid);

  process.env.TZ = MINISTRY_TIME_ZONE;

  const database = db();
  /*
   * Whether the registration wizard should ask about allergies rides on every
   * row (see KioskEventEntry) — the same write-back test the retired phone
   * form's code check performed, moved to bind time because the binding is the
   * only thing a kiosk keeps. Computing it needs the registry, and the
   * registry's notion of "enabled" needs the secret bindings, which is why
   * this callable mounts BACKEND_SECRETS now.
   */
  const registry = await createRegistry(database);
  const target = registry.defaultPush();
  const allergiesSupported =
    !('error' in target) && target.backend.capabilities.writeBack === 'full';

  const days = typeof request.data?.days === 'number' ? request.data.days : undefined;
  const events = await listKioskEvents(database, new Date(), logger, { days, allergiesSupported });

  /*
   * Filtered at bind time, which is the only moment this can be refused kindly.
   *
   * A kiosk keeps its binding and nothing else. Bound to a gathering its
   * approver cannot work, it looks perfectly healthy in the lobby and then
   * fails on the *first check-in* — in front of a family, with a queue behind
   * them — and afterwards queues up to fifty more writes that will never land.
   * The list a kiosk is offered is therefore narrowed to what the person
   * approving the pairing may actually work.
   */
  const uid = request.auth!.uid;
  const caller = await readCaller(uid);
  const reader = new ChainAccessReader(getFirestore(), uid, caller.role === 'admin');
  const { allowed } = await reader.partition(events.map((entry) => entry.chain));

  return { events: events.filter((entry) => allowed.has(entry.chain)) };
});

/**
 * A family registering themselves at the kiosk.
 *
 * The one write in Tally that creates people at the request of somebody who is
 * not a member of the team, which is why every field of every document it
 * writes is decided here rather than sent: the caller says who their children
 * are, and the server says what that means.
 *
 * The gate is the kiosk claim *plus* the approver still being active — the same
 * pair the shelf's check-ins already depend on, so deactivating the person who
 * paired a kiosk stops its registrations at the same moment it stops everything
 * else. `requireMember` rather than `requireCoreTeam` for the same reason
 * `getKioskEvents` uses it: the identity is the approver's, and a counselor who
 * may quick-add a visitor at a door may certainly let a family do it themselves.
 *
 * Kiosk-token-only since the phone form was retired. The anonymous-with-a-code
 * way in went with it, which closed the one semi-open door Tally had: the
 * pairing pair (`startKioskPairing`/`claimKioskToken`) are now the only
 * intentionally-unauthenticated callables.
 */
export const registerFamily = onCall<Record<string, unknown>, Promise<RegisterFamilyResult>>(
  { secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '256MiB' },
  async (request) => {
    if (request.auth?.token?.kiosk !== true) {
      throw new HttpsError('permission-denied', 'Registration happens at a kiosk.');
    }
    await requireMember(request.auth?.uid);

    const eventId = request.data?.eventId;
    if (typeof eventId !== 'string' || eventId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'eventId is required.');
    }

    try {
      return await runRegisterFamily({
        db: db(),
        request: parseRegisterFamilyRequest(request.data),
        context: { uid: request.auth.uid, eventId: eventId.trim() },
        logger,
      });
    } catch (error) {
      if (error instanceof RegistrationInputError) {
        throw new HttpsError('invalid-argument', error.message);
      }
      throw error;
    }
  },
);

/**
 * A parent contact a counselor was given at the door.
 *
 * The quick-add itself is still a client write — three fields, an atomic batch,
 * a green row before the network has answered — and it stays that way. This is
 * the optional second half: a leader standing next to the adult who brought the
 * child takes down a name and a number, and there is nowhere on a student
 * document those may live (`noMirroredPersonalData` in `firestore.rules`, and
 * that is the point rather than an obstacle). So they land on a registration
 * record, held for the Review screen, exactly as a lobby family's do.
 *
 * `requireMember`, not `requireCoreTeam`: a counselor who may put a child on
 * the roster may certainly write down a phone number for somebody else to act
 * on. What they cannot do is the acting — `addParent` decides which David Kim
 * this is, and that stays core team, on a screen, on a Tuesday.
 */
export const recordVisitorParent = onCall<
  Record<string, unknown>,
  Promise<RecordVisitorParentResult>
>({ timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireMember(request.auth?.uid);
  const uid = request.auth?.uid;
  if (typeof uid !== 'string') {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }

  try {
    return await runRecordVisitorParent({
      db: db(),
      request: parseRecordVisitorParentRequest(request.data),
      uid,
      logger,
    });
  } catch (error) {
    if (error instanceof RegistrationInputError) {
      throw new HttpsError('invalid-argument', error.message);
    }
    throw error;
  }
});

/* -------------------------------------------------------------------------- */
/* Reviewing what the door recorded                                            */
/* -------------------------------------------------------------------------- */

/**
 * The families waiting to be reviewed, with everything needed to judge them.
 *
 * A callable rather than a subscription, and core team only, because this is
 * the one place in Tally that answers with a parent's phone number. The
 * collection behind it is deny-all in `firestore.rules` in both directions —
 * there is no client read path at all, and this is the exception, gated on the
 * same role that may already push a student into the church's database.
 *
 * The sweep runs from here for the same reason the pairing sweep runs from the
 * pairing calls: this is the one call guaranteed to be made by somebody paying
 * attention, and a registration nobody reviewed still has to expire.
 */
export const listPendingRegistrations = onCall<void, Promise<PendingRegistration[]>>(
  /*
   * The secrets are what make the registry more than a shell.
   *
   * A declared secret reaches a function's environment only when that function
   * asks for it, and this one did not — so `createRegistry` read an empty
   * `PCO_APP_ID`, wrote a `configError`, and handed back a registry with no
   * Planning Center in it. Nothing failed: `defaultPush()` answered with an
   * error, `namesFromUpstream` returned on the first line, and every card came
   * back with `guardianCandidates: []` — indistinguishable, by design, from a
   * church that has never heard of this parent. The screen then quietly
   * promised a new person for a mother Planning Center already holds, which is
   * the second household this whole path exists to prevent.
   *
   * The emulator hides it perfectly: `readValue` falls back to `process.env`,
   * and `.env.demo-tally` sets both values, so every test and the end-to-end
   * suite exercise a fully configured registry. Only a deploy is missing them.
   */
  { secrets: BACKEND_SECRETS, timeoutSeconds: 120, memory: '256MiB' },
  async (request) => {
    await requireCoreTeam(request.auth?.uid);
    const database = db();
    const now = new Date();
    await sweepRegistrations(database, now);
    /*
     * The registry is here to *name* things, not to write them: a duplicate
     * candidate whose name lives in a backend is a row the screen would
     * otherwise render as "a student on the roster", which is unusable in a
     * list where the reviewer is being asked which of two rows is the same
     * child. A backend that cannot be reached simply leaves those labels as
     * they were.
     */
    return listPending(database, now, { registry: await createRegistry(database), logger });
  },
);

/**
 * Yes: put this family in the church's database.
 *
 * The one action in Tally that turns a stranger's typing into a permanent
 * record somewhere else, which is why it is a button a named person presses
 * rather than something that happened while they were serving coffee.
 */
export const approveRegistration = onCall<
  {
    registrationId: string;
    withoutGuardian?: boolean;
    withRegistrationIds?: string[];
    guardianPersonId?: string | null;
    createNewGuardian?: boolean;
    childDecisions?: { studentId?: unknown; personId?: unknown; createNew?: unknown }[];
    guardianHouseholdId?: string | null;
    createNewHousehold?: boolean;
    newHouseholdName?: string | null;
  },
  Promise<ApproveRegistrationResult>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 300, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);
  const registrationId = request.data?.registrationId;
  if (typeof registrationId !== 'string' || registrationId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'registrationId is required.');
  }

  const withRegistrationIds = request.data?.withRegistrationIds;
  if (withRegistrationIds !== undefined && !Array.isArray(withRegistrationIds)) {
    throw new HttpsError('invalid-argument', 'withRegistrationIds must be a list.');
  }
  const guardianPersonId = request.data?.guardianPersonId;
  if (
    guardianPersonId !== undefined &&
    guardianPersonId !== null &&
    typeof guardianPersonId !== 'string'
  ) {
    throw new HttpsError('invalid-argument', 'guardianPersonId must be a person id.');
  }
  const guardianHouseholdId = request.data?.guardianHouseholdId;
  if (
    guardianHouseholdId !== undefined &&
    guardianHouseholdId !== null &&
    typeof guardianHouseholdId !== 'string'
  ) {
    throw new HttpsError('invalid-argument', 'guardianHouseholdId must be a household id.');
  }
  const rawChildDecisions = request.data?.childDecisions;
  if (rawChildDecisions !== undefined && !Array.isArray(rawChildDecisions)) {
    throw new HttpsError('invalid-argument', 'childDecisions must be a list.');
  }
  /*
   * Read field by field rather than trusted as a shape. This is the payload
   * that names which upstream person a child becomes, and a malformed entry
   * must degrade to "nobody answered for this child" — the behaviour every
   * caller had before the control existed — rather than to a link nobody made.
   */
  const childDecisions = (rawChildDecisions ?? [])
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const studentId = typeof row.studentId === 'string' ? row.studentId.trim() : '';
      if (!studentId) return null;
      return {
        studentId,
        ...(typeof row.personId === 'string' && row.personId.trim().length > 0
          ? { personId: row.personId.trim() }
          : {}),
        ...(row.createNew === true ? { createNew: true } : {}),
      };
    })
    .filter((entry): entry is { studentId: string; personId?: string; createNew?: boolean } =>
      entry !== null,
    );

  const database = db();
  return runApproveRegistration({
    db: database,
    registry: await createRegistry(database),
    registrationId: registrationId.trim(),
    // Every one of these is optional on the wire, and absent means the ordinary
    // approval — an old bundle cannot discard a guardian, regroup a family or
    // name a parent by omission.
    withoutGuardian: request.data?.withoutGuardian === true,
    withRegistrationIds: (withRegistrationIds ?? [])
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
    guardianPersonId: typeof guardianPersonId === 'string' ? guardianPersonId.trim() : null,
    createNewGuardian: request.data?.createNewGuardian === true,
    childDecisions,
    guardianHouseholdId:
      typeof guardianHouseholdId === 'string' ? guardianHouseholdId.trim() : null,
    createNewHousehold: request.data?.createNewHousehold === true,
    newHouseholdName:
      typeof request.data?.newHouseholdName === 'string'
        ? request.data.newHouseholdName.trim()
        : null,
    uid: request.auth!.uid,
    logger,
  });
});

/**
 * Not yet: fix what the family typed first.
 *
 * The third answer this screen was missing. Approve is permanent and discard
 * loses the family, so a misspelling used to have no proportionate response —
 * see `kiosk/amend.ts` for what a correction has to carry with it, which is
 * considerably more than the field being corrected.
 *
 * Core team, like every other write on this screen: it renames a roster row and
 * it can move which four digits find a family at the lobby.
 */
export const amendRegistration = onCall<
  {
    registrationId: string;
    child?: AmendChild;
    guardian?: AmendGuardian;
  },
  Promise<AmendRegistrationResult>
>({ timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);
  const registrationId = request.data?.registrationId;
  if (typeof registrationId !== 'string' || registrationId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'registrationId is required.');
  }

  try {
    return await runAmendRegistration({
      db: db(),
      registrationId: registrationId.trim(),
      // Passed through as they arrived: every field is parsed by the door's own
      // rules inside the call, so a shape check here would be a second, weaker
      // copy of the one that matters.
      child: request.data?.child,
      guardian: request.data?.guardian,
      uid: request.auth!.uid,
      logger,
    });
  } catch (error) {
    if (error instanceof RegistrationInputError) {
      throw new HttpsError('invalid-argument', error.message);
    }
    throw error;
  }
});

/** No: take them off the roster, and forget the phone number. */
export const discardRegistration = onCall<
  { registrationId: string },
  Promise<DiscardRegistrationResult>
>({ timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);
  const registrationId = request.data?.registrationId;
  if (typeof registrationId !== 'string' || registrationId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'registrationId is required.');
  }

  return runDiscardRegistration({
    db: db(),
    registrationId: registrationId.trim(),
    uid: request.auth!.uid,
    logger,
  });
});

/**
 * Two roster rows, one child.
 *
 * Core team, like every other write that changes what the roster *means* rather
 * than what it records. See `backends/mergeStudents.ts` for what this does and
 * does not claim about the church's own database.
 */
export const mergeStudents = onCall<
  { keeperId: string; foldId: string; undo?: boolean },
  Promise<MergeStudentsResult>
>({ timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);
  const foldId = request.data?.foldId;
  if (typeof foldId !== 'string' || foldId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'foldId is required.');
  }

  if (request.data?.undo === true) {
    return runUnmergeStudents({ db: db(), foldId: foldId.trim(), uid: request.auth!.uid, logger });
  }

  const keeperId = request.data?.keeperId;
  if (typeof keeperId !== 'string' || keeperId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'keeperId is required.');
  }
  return runMergeStudents({
    db: db(),
    keeperId: keeperId.trim(),
    foldId: foldId.trim(),
    uid: request.auth!.uid,
    logger,
  });
});


/**
 * Rebuilds `kioskIndex/phones` on demand: the Settings button, and the kiosk
 * itself when it finds the stored index stale at bind time. Any active member —
 * the output is only tail digits and student ids, data the same people already
 * read from the document this writes.
 */
export const refreshKioskPhoneIndex = onCall<
  { force?: unknown } | undefined,
  Promise<PhoneIndexSummary>
>({ secrets: BACKEND_SECRETS, timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  await requireMember(request.auth?.uid);

  const database = db();
  const registry = await createRegistry(database);
  try {
    return await buildPhoneIndex(database, registry, {
      force: request.data?.force === true,
      builtBy: request.auth!.uid,
      logger: logger,
    });
  } catch (error) {
    reportBackendFailure('A people backend', error, 'rebuild the kiosk phone index');
  }
});

/**
 * Whether this deployment can mint kiosk tokens, for the Settings card.
 *
 * The IAM grant behind `claimKioskToken` is invisible three times over: absent
 * from the code, unexercised by the emulator, and swallowed by the kiosk's own
 * poll loop when it is missing. Settings asking here is the only place the
 * answer surfaces short of reading the function logs.
 *
 * Core team rather than any member: this reports on project configuration, and
 * its answer is addressed to whoever can go and fix it.
 */
export const getKioskStatus = onCall<undefined, Promise<SigningStatus>>(
  { timeoutSeconds: 30, memory: '256MiB' },
  async (request) => {
    await requireCoreTeam(request.auth?.uid);
    // The token is discarded inside `probeSigning` and never returned: this
    // callable answers whether signing works, not with a usable credential.
    return probeSigning((uid) => getAuth().createCustomToken(uid));
  },
);

/**
 * The nightly rebuild, so the index never drifts more than a day from the
 * numbers upstream even if no kiosk is ever paired. 3:30 am local: after
 * everything, before everyone.
 */
export const rebuildKioskPhoneIndex = onSchedule(
  {
    schedule: 'every day 03:30',
    timeZone: MINISTRY_TIME_ZONE,
    secrets: BACKEND_SECRETS,
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    const database = db();
    const registry = await createRegistry(database);
    if (registry.ids().length === 0) return;
    const summary = await buildPhoneIndex(database, registry, {
      builtBy: 'schedule',
      logger: logger,
    });
    logger.info('Rebuilt the kiosk phone index', summary);
  },
);

/**
 * Rebuilds `kioskIndex/participation` on demand: the kiosk itself when it finds
 * the stored index stale at bind time. Any active member, for the same reason
 * the phone index is — the output is student ids the caller already reads.
 *
 * No backend secrets, because this reads nothing but Tally's own registers.
 */
export const refreshKioskParticipation = onCall<undefined, Promise<ParticipationSummary>>(
  { timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    await requireMember(request.auth?.uid);
    return buildParticipationIndex(db(), { builtBy: request.auth!.uid, logger: logger });
  },
);

/**
 * The nightly rebuild, so a kiosk that is never paired still binds to a current
 * answer. Ten minutes before the phone index, and emphatically its own job:
 * this build touches no backend and needs no secrets, while `buildPhoneIndex`
 * deliberately *throws* when one is down. Sharing a schedule would let a
 * Planning Center outage take the kiosk's idea of who belongs to a gathering
 * with it.
 */
export const rebuildKioskParticipation = onSchedule(
  {
    schedule: 'every day 03:20',
    timeZone: MINISTRY_TIME_ZONE,
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    const summary = await buildParticipationIndex(db(), { builtBy: 'schedule', logger: logger });
    logger.info('Rebuilt the kiosk participation index', summary);
  },
);
