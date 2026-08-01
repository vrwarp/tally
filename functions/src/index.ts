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
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PCO_SECRETS, resolveConfig, type PcoConfig } from './config.js';
import { asFirestoreLike, PATHS, type FirestoreLike } from './firestore.js';
import {
  deleteEvents as removeEvents,
  type DeletionSummary,
  type DeletionTarget,
} from './eventDeletion.js';
import { materializeOccurrence as materializeOne, MINISTRY_TIME_ZONE } from './occurrences.js';
import {
  checkInsBaseUrl,
  importCheckInsEvent as importCheckInsEventUpstream,
  listCheckInsEvents as listCheckInsEventsUpstream,
  type CheckInsEventSummary,
  type CheckInsImportSummary,
} from './pco/checkins.js';
import { createPcoClient, PcoApiError, type PcoClient } from './pco/client.js';
import { describePcoFailure } from './pco/debug.js';
import { fetchListMemberIds, fetchLists, type PcoListSummary } from './pco/lists.js';
import {
  setParentContact as setParentContactUpstream,
  type SetParentContactResult,
} from './pco/parentContact.js';
import {
  updateStudentProfile as updateStudentProfileUpstream,
  type StudentProfilePatch,
  type UpdateStudentProfileResult,
} from './pco/profile.js';
import { addParent as addParentUpstream, type AddParentResult } from './pco/household.js';
import {
  fetchParentContactStatus,
  fetchPersonDetails,
  fetchRoster,
  pcoStudentId,
  personDetailsCacheKey,
  personIdFromStudentId,
  reachableAdultsCacheKey,
  searchPeople,
  type ParentContactStatus,
  type PersonDetails,
  type PersonSearchResult,
  type RosterPerson,
} from './pco/roster.js';
import { resetSharedCache, sharedCache } from './pco/sharedCache.js';
import {
  pushPendingStudents,
  pushStudent,
  type PushPendingResult,
  type PushStudentResult,
} from './pco/pushStudents.js';

export { provisionAccess } from './access.js';

initializeApp();

// The whole ministry is in one place, so co-locating with Firestore is the only
// latency decision that matters here.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

function db(): FirestoreLike {
  return asFirestoreLike(getFirestore());
}

/**
 * Builds a client, or returns the reason it cannot be built. Missing credentials
 * are reported to the caller rather than thrown, so the Settings screen can name
 * the missing value instead of showing "internal error".
 */
function clientFor(config: PcoConfig): PcoClient | null {
  if (config.configError) return null;
  return createPcoClient({
    appId: config.appId,
    secret: config.secret,
    baseUrl: config.baseUrl,
  });
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

/** Core-team gate. The role is read from Firestore, never from the request. */
async function requireCoreTeam(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const caller = await readCaller(uid);
  if (!caller.active || (caller.role !== 'core' && caller.role !== 'admin')) {
    throw new HttpsError('permission-denied', 'Only the core team can do that.');
  }
}

/**
 * Turns a Planning Center failure into something a counselor can act on.
 *
 * The distinction that matters is "Tally is broken" versus "Planning Center is
 * having a minute" — the second is a reason to try again, and saying so stops a
 * volunteer hunting for a problem on their end.
 *
 * The sentence is the whole answer for the person reading it at a door. The
 * request and response behind it ride along as the error's `details`, for the
 * screen's "Details" panel and the person they forward it to — see
 * ./pco/debug.ts for what that payload may and may not contain.
 */
function reportPcoFailure(error: unknown, what: string): never {
  if (error instanceof HttpsError) throw error;

  const debug = describePcoFailure(error, what);
  logger.error(`Failed to ${what}`, { error: String(error), pco: debug });

  if (error instanceof PcoApiError) {
    if (error.status === 429) {
      throw new HttpsError(
        'resource-exhausted',
        'Planning Center is rate-limiting us. Try again in a moment.',
        debug,
      );
    }
    if (error.status === 401 || error.status === 403) {
      throw new HttpsError(
        'permission-denied',
        "Planning Center rejected Tally's credentials. A leader needs to check the connection in Settings.",
        debug,
      );
    }
  }

  throw new HttpsError('unavailable', `Could not reach Planning Center to ${what}.`, debug);
}

/* -------------------------------------------------------------------------- */
/* Reading people                                                              */
/* -------------------------------------------------------------------------- */

/** Mirrors `RosterResponse` in src/services/functions.ts. */
interface RosterResponse {
  people: RosterPerson[];
  /** Roster entries whose Planning Center person could not be read. */
  unresolved: string[];
  cached: boolean;
  fetchedAt: string;
  /** Echoed so the app can say how stale what it is showing might be. */
  cacheTtlSeconds: number;
}

interface RosterScan {
  /**
   * Every Planning Center person Tally has on its roster.
   *
   * The membership is Tally's own: a `students/{id}` document whose id is
   * `pco_{personId}`. Read here rather than trusted from the caller, because the
   * whole point of the id prefix is that it says which upstream person a row
   * refers to — a browser that could name the ids would be choosing whose
   * personal details the server fetches.
   */
  personIds: string[];
  /**
   * The people Tally itself put into Planning Center, whose documents still
   * carry the id Tally gave them.
   *
   * A visitor quick-added at a door is `students/{tally-id}` with no person
   * behind them. The push writes `pcoPersonId` onto that document — it does not
   * rename it, because every attendance record already points at the id — so
   * from then on Tally knows exactly which upstream person they are while the
   * scan above, which reads the id and nothing else, does not.
   *
   * Kept apart from `personIds` because the two halves answer differently on
   * the client. A `personIds` student *is* their roster row; a linked student
   * is already a row of their own, and the roster read answers for their
   * Planning Center fields — the name, the grade, the allergy flag, the
   * birthday — which `mergeRoster` lays onto the document's row. It used to
   * not ask about them at all, on the reasoning that they needed no row; the
   * fields came from nowhere instead, and a birthday saved upstream stayed
   * "No birthday" on the roster for ever.
   *
   * Trusted for the same reason `personIds` is: the field is written by the
   * push, server-side. A browser cannot set it.
   */
  linkedPersonIds: string[];
  /**
   * Active students with no Planning Center person yet — the same rows the
   * Students screen marks "Queued". Counted on this pass rather than its own
   * because the collection has already been read.
   */
  queued: number;
}

/** One scan of the students collection, for the two things anybody asks it. */
async function scanRoster(database: FirestoreLike): Promise<RosterScan> {
  const snapshot = await database.collection(PATHS.students).get();
  const personIds: string[] = [];
  const linkedPersonIds: string[] = [];
  let queued = 0;

  for (const document of snapshot.docs) {
    const data = document.data() ?? {};

    /*
     * A student taken off the roster keeps their document — every attendance
     * record points at it, so deleting the row would drop past head counts —
     * but stops being somebody Tally asks Planning Center about. Skipping them
     * here is what makes "remove" mean anything, and it also means Tally reads
     * no personal data at all about a child who has left the ministry. Somebody
     * who has left is not waiting to be created upstream either, so the same
     * skip is what keeps them out of the queued count.
     */
    if (data.status === 'inactive') continue;

    const personId = personIdFromStudentId(document.id);
    if (personId) personIds.push(personId);
    else if (typeof data.pcoPersonId === 'string' && data.pcoPersonId) {
      // Pushed, so not queued — and not on the roster read either, which is
      // what left them with no answer at all to the question below.
      linkedPersonIds.push(data.pcoPersonId);
    } else queued += 1;
  }

  return { personIds, linkedPersonIds, queued };
}

/**
 * The youth roster: Tally's membership, with Planning Center's names on it.
 *
 * Open to any active member of the team, not just the core: a door volunteer
 * cannot check anybody in without it. It returns names and grades only — parent
 * contact and allergies come from `getPersonDetails`, one person at a time, to
 * somebody with a reason to look.
 *
 * Students Tally created itself and has not pushed yet live entirely in
 * Firestore, which the app already reads live; merging the two is the client's
 * job (`mergeRoster`). Once the push has linked them, their Planning Center
 * person is read here like everybody else's — their *row* stays the document,
 * but the fields Planning Center owns have to come from Planning Center, or a
 * birthday saved upstream goes on reading "No birthday" for ever.
 */
export const getRoster = onCall<{ force?: boolean } | undefined, Promise<RosterResponse>>(
  { secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<RosterResponse> => {
    await requireMember(request.auth?.uid);

    const config = await resolveConfig(db());
    const client = clientFor(config);
    if (!client) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');

    try {
      const scan = await scanRoster(db());
      const result = await fetchRoster({
        client,
        config,
        cache: sharedCache(config),
        /*
         * Both halves, like `getParentContactStatus` below and for the same
         * reason. A pushed visitor's row is their document, but the document
         * deliberately holds none of what Planning Center owns — so without
         * asking upstream about them, their name was whatever was typed at the
         * door, their allergy flag was permanently off, and a birthday added
         * through the very editor this app provides never appeared.
         */
        personIds: [...scan.personIds, ...scan.linkedPersonIds],
        force: request.data?.force === true,
      });
      return { ...result, cacheTtlSeconds: config.cacheTtlSeconds };
    } catch (error) {
      return reportPcoFailure(error, 'load the roster');
    }
  },
);

/**
 * Finds somebody in Planning Center to put on the roster.
 *
 * Core team only: this searches the *whole* church directory, which is a wider
 * view of the congregation than a door volunteer has any reason to hold.
 */
export const searchPlanningCenterPeople = onCall<
  { query: string },
  Promise<{ people: PersonSearchResult[] }>
>({ secrets: PCO_SECRETS, timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const query = typeof request.data?.query === 'string' ? request.data.query.trim() : '';
  if (!query) return { people: [] };

  const config = await resolveConfig(db());
  const client = clientFor(config);
  if (!client) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');

  try {
    return { people: await searchPeople({ client, config, query }) };
  } catch (error) {
    return reportPcoFailure(error, 'search Planning Center');
  }
});

/** Mirrors `PcoPersonDetails` in src/types. */
interface PersonDetailsResponse extends PersonDetails {
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
  { pcoPersonId: string; force?: boolean },
  Promise<PersonDetailsResponse | null>
>(
  { secrets: PCO_SECRETS, timeoutSeconds: 60, memory: '256MiB' },
  async (request): Promise<PersonDetailsResponse | null> => {
    await requireCoreTeam(request.auth?.uid);

    const personId = request.data?.pcoPersonId;
    if (typeof personId !== 'string' || personId.length === 0) {
      throw new HttpsError('invalid-argument', 'pcoPersonId is required.');
    }

    const config = await resolveConfig(db());
    const client = clientFor(config);
    if (!client) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');

    try {
      const details = await fetchPersonDetails({
        client,
        config,
        cache: sharedCache(config),
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
       * household has an adult is a fact about Planning Center and is worth
       * holding for the TTL; whether Tally is allowed to write is a setting a
       * leader may have changed a second ago, and serving that from a cache
       * would leave a form on screen that the write path then refuses.
       */
      const writeBackFull = config.writeBack === 'full';
      return {
        ...details,
        contactWritable: details.householdAdult && writeBackFull,
        profileWritable: writeBackFull,
        parentCreatable: writeBackFull && !details.householdAdult,
      };
    } catch (error) {
      return reportPcoFailure(error, 'load this student');
    }
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
  { secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<ParentContactStatus> => {
    await requireCoreTeam(request.auth?.uid);

    const config = await resolveConfig(db());
    const client = clientFor(config);
    if (!client) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');

    try {
      const scan = await scanRoster(db());
      return await fetchParentContactStatus({
        client,
        config,
        cache: sharedCache(config),
        /*
         * Both halves of the membership, which is what makes this different
         * from every other read of the scan.
         *
         * A visitor Tally pushed upstream keeps their own document id, so the
         * roster read does not carry them and this question had no answer for
         * them — and "no answer" is not "no parent", so the dashboard could
         * only fall back to the flag on their document, which says `false` for
         * ever. A contact added through Tally, written into Planning Center and
         * confirmed by the very next read left them on the "incomplete
         * profiles" list anyway. Asking about them here is what lets Planning
         * Center answer for the students Tally itself put there.
         */
        personIds: [...scan.personIds, ...scan.linkedPersonIds],
        force: request.data?.force === true,
      });
    } catch (error) {
      return reportPcoFailure(error, 'check which students have a parent contact');
    }
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
  { secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<PcoStatusResult> => {
    await requireCoreTeam(request.auth?.uid);

    const config = await resolveConfig(db());

    /*
     * Read before the configuration is judged, because "how many students have
     * not reached Planning Center" is most worth knowing in exactly the states
     * that return early below — write-back off, or the connection broken. The
     * roster ids from the same scan are only usable once there is a client.
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

    const client = clientFor(config);
    if (!client) {
      return { ...base, configured: false, reachable: false, problem: 'Not configured.', peopleVisible: null };
    }

    try {
      // Deliberately the real roster query rather than a cheap ping: "we can
      // reach the API" and "we can see your students" are different claims, and
      // only the second is worth showing a leader.
      const personIds = scan.personIds;
      const result = await fetchRoster({
        client,
        config,
        cache: sharedCache(config),
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
  { secrets: PCO_SECRETS, timeoutSeconds: 60, memory: '256MiB' },
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
      return reportPcoFailure(error, 'load your Planning Center lists');
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
  { timeoutSeconds: 30, memory: '256MiB' },
  async (request) => {
    await requireCoreTeam(request.auth?.uid);
    resetSharedCache();
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
  { pcoPersonId: string },
  Promise<{ status: 'added' | 'restored' | 'already-on-roster'; studentId: string }>
>({ secrets: PCO_SECRETS, timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const personId = request.data?.pcoPersonId;
  if (typeof personId !== 'string' || personId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'pcoPersonId is required.');
  }

  const config = await resolveConfig(db());
  const client = clientFor(config);
  if (!client) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');

  // Confirm the person is real before recording that they are on the roster: a
  // typo'd id would otherwise become a permanent row that renders as nothing.
  try {
    await client.get(`/people/${encodeURIComponent(personId)}`);
  } catch (error) {
    if (error instanceof PcoApiError && error.status === 404) {
      throw new HttpsError('not-found', 'Planning Center has no person with that id.');
    }
    return reportPcoFailure(error, 'check that person in Planning Center');
  }

  const studentId = pcoStudentId(personId);
  const ref = db().doc(`${PATHS.students}/${studentId}`);
  const snapshot = await ref.get();
  const existing = snapshot.exists ? (snapshot.data() ?? {}) : {};
  const wasActive = existing.status === 'active';

  await ref.set(
    {
      pcoPersonId: personId,
      status: 'active',
      addedToRosterAt: Timestamp.now(),
      addedToRosterBy: request.auth?.uid ?? null,
      ...(snapshot.exists ? {} : { createdAt: Timestamp.now() }),
    },
    { merge: true },
  );

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
>({ secrets: PCO_SECRETS, timeoutSeconds: 300, memory: '512MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const listId = request.data?.listId;
  if (typeof listId !== 'string' || listId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'listId is required.');
  }

  const config = await resolveConfig(db());
  const client = clientFor(config);
  if (!client) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');

  let personIds: string[];
  try {
    personIds = await fetchListMemberIds(client, listId);
  } catch (error) {
    return reportPcoFailure(error, 'read that Planning Center list');
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
 * A client for the Check-Ins product, or the reason there cannot be one.
 *
 * Check-Ins lives beside People on the same host, so its root is derived from
 * the configured People root rather than being a second setting — pointing one
 * at the simulator points both. The same Personal Access Token authenticates
 * either product; whether it is *allowed* to read Check-Ins is Planning
 * Center's call, and comes back as an ordinary 403 the error path explains.
 */
function checkInsClientFor(config: PcoConfig): PcoClient | { error: string } {
  if (config.configError) return { error: config.configError };
  const baseUrl = checkInsBaseUrl(config.baseUrl);
  if (!baseUrl) {
    return {
      error: `The configured Planning Center URL ("${config.baseUrl}") does not end in /people/v2, so the Check-Ins API root cannot be derived from it.`,
    };
  }
  return createPcoClient({ appId: config.appId, secret: config.secret, baseUrl });
}

/**
 * The Check-Ins events a leader could import — Footprints, Sunday school, the
 * preschool room — each with enough history attached to recognise the right
 * one before anything is written.
 *
 * Core team only: this is a view over the whole church's check-in system, not
 * something a door volunteer needs.
 */
export const listCheckInsEvents = onCall<void, Promise<{ events: CheckInsEventSummary[] }>>(
  { secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '256MiB' },
  async (request) => {
    await requireCoreTeam(request.auth?.uid);

    const config = await resolveConfig(db());
    const client = checkInsClientFor(config);
    if ('error' in client) throw new HttpsError('failed-precondition', client.error);

    try {
      return { events: await listCheckInsEventsUpstream({ client, db: db() }) };
    } catch (error) {
      return reportPcoFailure(error, 'list your Check-Ins events');
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
  { pcoEventId: string },
  Promise<CheckInsImportSummary>
>({ secrets: PCO_SECRETS, timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const pcoEventId = request.data?.pcoEventId;
  if (typeof pcoEventId !== 'string' || pcoEventId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'pcoEventId is required.');
  }

  const config = await resolveConfig(db());
  const client = checkInsClientFor(config);
  if ('error' in client) throw new HttpsError('failed-precondition', client.error);

  // Occurrence ids embed the ministry-local calendar day, and this container
  // runs in UTC — same reasoning, same fix as `materializeOccurrence`.
  process.env.TZ = MINISTRY_TIME_ZONE;

  try {
    return await importCheckInsEventUpstream({
      db: db(),
      client,
      pcoEventId: pcoEventId.trim(),
      uid: request.auth!.uid,
      now: new Date(),
      logger,
    });
  } catch (error) {
    return reportPcoFailure(error, 'import that Check-Ins event');
  }
});

/* -------------------------------------------------------------------------- */
/* Write-back                                                                  */
/* -------------------------------------------------------------------------- */

export const pushStudentToPlanningCenter = onCall<
  { studentId: string },
  Promise<PushStudentResult>
>({ secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  const config = await resolveConfig(db());
  const client = clientFor(config);
  if (!client) {
    return {
      status: 'skipped',
      pcoPersonId: null,
      message: config.configError ?? 'Planning Center is not configured.',
    };
  }

  const result = await pushStudent({ db: db(), client, config, studentId, logger });
  // A student who is now in Planning Center must not be missing from the next
  // roster read because a cached copy predates them.
  if (result.status !== 'skipped') resetSharedCache();
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
>({ secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  const config = await resolveConfig(db());
  const client = clientFor(config);
  if (!client) {
    throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');
  }

  let result: SetParentContactResult;
  try {
    result = await setParentContactUpstream({
      db: db(),
      client,
      config,
      studentId,
      phone: request.data?.phone ?? null,
      email: request.data?.email ?? null,
      logger,
    });
  } catch (error) {
    return reportPcoFailure(error, 'add a parent contact in Planning Center');
  }

  /*
   * Drop just this student's cached details rather than the whole cache. The
   * screen that called this re-reads immediately, and a held answer from
   * moments ago would show the number as still missing — but nothing else about
   * the roster changed, and a full reset would make every other counselor's
   * next read pay for one edit.
   */
  if (result.status === 'updated') {
    const cache = sharedCache(config);
    const personId = personIdFromStudentId(studentId);
    if (personId) cache.invalidate(personDetailsCacheKey(config.baseUrl, personId));
    // And the sweep behind "incomplete profiles", which has just stopped being
    // true about this household.
    cache.invalidate(reachableAdultsCacheKey(config.baseUrl));
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
>({ secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  const config = await resolveConfig(db());
  const client = clientFor(config);
  if (!client) {
    throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');
  }

  let result: UpdateStudentProfileResult;
  try {
    result = await updateStudentProfileUpstream({
      db: db(),
      client,
      config,
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
    return reportPcoFailure(error, 'save this profile to Planning Center');
  }

  /*
   * The whole cache, not just this student's details: a renamed or regraded
   * person changes the *roster* — how they sort, whether the grade band still
   * includes them — and that answer is held under a different key on every
   * device that asks. One edit is a fine price for one cold read.
   */
  if (result.status === 'updated') resetSharedCache();

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
>({ secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '256MiB' }, async (request) => {
  await requireCoreTeam(request.auth?.uid);

  const studentId = request.data?.studentId;
  if (typeof studentId !== 'string' || studentId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'studentId is required.');
  }

  const config = await resolveConfig(db());
  const client = clientFor(config);
  if (!client) {
    throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');
  }

  let result: AddParentResult;
  try {
    result = await addParentUpstream({
      db: db(),
      client,
      config,
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
    return reportPcoFailure(error, 'add a parent in Planning Center');
  }

  /*
   * The whole cache, unlike `setParentContact`'s surgical drop. A new household
   * changes who is reachable and who counts as unreachable across every screen
   * that asks — the student's details, the incomplete-profiles sweep keyed by
   * household, and the roster's own view of this family. One cold read is the
   * right price for a family that did not exist a second ago.
   */
  if (result.status === 'added') resetSharedCache();

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
  { secrets: PCO_SECRETS, timeoutSeconds: 300, memory: '256MiB' },
  async (request): Promise<PushPendingResult> => {
    await requireCoreTeam(request.auth?.uid);

    const config = await resolveConfig(db());
    const client = clientFor(config);
    if (!client) return { pushed: 0, skipped: 0, errors: 0 };

    const result = await pushPendingStudents({ db: db(), client, config, logger });
    if (result.pushed > 0) resetSharedCache();
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
    secrets: PCO_SECRETS,
    timeoutSeconds: 120,
    memory: '256MiB',
    retry: false,
  },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.pcoPushPending !== true || typeof data.pcoPersonId === 'string') return;

    const config = await resolveConfig(db());
    const client = clientFor(config);
    if (!client || config.writeBack === 'off') return;

    try {
      const result = await pushStudent({
        db: db(),
        client,
        config,
        studentId: event.params.studentId,
        logger,
      });
      // The roster cache predates this person; without the drop they would be
      // missing from the next read for up to the TTL.
      if (result.status !== 'skipped') resetSharedCache();
      logger.info('Pushed a new student to Planning Center', {
        studentId: event.params.studentId,
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
  } else if (scope === 'chain') {
    const chain = request.data?.chain;
    if (typeof chain !== 'string' || chain.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'chain is required.');
    }
    target = { scope: 'chain', chain };
  } else {
    throw new HttpsError('invalid-argument', "scope must be 'event' or 'chain'.");
  }

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
