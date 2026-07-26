/**
 * Cloud Functions entry points.
 *
 * The exported names are a contract with src/services/functions.ts — renaming
 * one here silently breaks a button in the app, because `httpsCallable` resolves
 * by string. Everything a handler does lives in ./pco and ./access; this file is
 * only wiring, permission checks and the shapes the client expects back.
 *
 * There is no scheduled anything. Tally used to sweep Planning Center every six
 * hours and mirror every person into Firestore; it now reads people when it
 * needs them and holds the answer for `PCO_CACHE_TTL_SECONDS` at most. What is
 * left is three reads, one write-back, and the trigger that pushes a
 * quick-added visitor before the counselor has walked back to the door.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PCO_SECRETS, resolveConfig, type PcoConfig } from './config.js';
import { asFirestoreLike, PATHS, type FirestoreLike } from './firestore.js';
import { createPcoClient, PcoApiError, type PcoClient } from './pco/client.js';
import { describePcoFailure } from './pco/debug.js';
import { fetchListMemberIds, fetchLists, type PcoListSummary } from './pco/lists.js';
import {
  fetchPersonDetails,
  fetchRoster,
  pcoStudentId,
  personIdFromStudentId,
  searchPeople,
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

/** Any signed-in, active member of the team. The role is read from Firestore. */
async function requireMember(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const snapshot = await db().doc(`${PATHS.users}/${uid}`).get();
  const data = snapshot.exists ? (snapshot.data() ?? {}) : {};
  if (data.active !== true) {
    throw new HttpsError('permission-denied', 'Your access to Tally is not active.');
  }
}

/** Core-team gate. The role is read from Firestore, never from the request. */
async function requireCoreTeam(uid: string | undefined): Promise<void> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const snapshot = await db().doc(`${PATHS.users}/${uid}`).get();
  const data = snapshot.exists ? (snapshot.data() ?? {}) : {};
  if (data.active !== true || (data.role !== 'core' && data.role !== 'admin')) {
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

/**
 * Every Planning Center person Tally has on its roster.
 *
 * The membership is Tally's own: a `students/{id}` document whose id is
 * `pco_{personId}`. Read here rather than trusted from the caller, because the
 * whole point of the id prefix is that it says which upstream person a row
 * refers to — a browser that could name the ids would be choosing whose
 * personal details the server fetches.
 */
async function rosterPersonIds(database: FirestoreLike): Promise<string[]> {
  const snapshot = await database.collection(PATHS.students).get();
  const ids: string[] = [];
  for (const document of snapshot.docs) {
    const personId = personIdFromStudentId(document.id);
    if (!personId) continue;

    /*
     * A student taken off the roster keeps their document — every attendance
     * record points at it, so deleting the row would drop past head counts —
     * but stops being somebody Tally asks Planning Center about. Skipping them
     * here is what makes "remove" mean anything, and it also means Tally reads
     * no personal data at all about a child who has left the ministry.
     */
    if ((document.data() ?? {}).status === 'inactive') continue;

    ids.push(personId);
  }
  return ids;
}

/**
 * The youth roster: Tally's membership, with Planning Center's names on it.
 *
 * Open to any active member of the team, not just the core: a door volunteer
 * cannot check anybody in without it. It returns names and grades only — parent
 * contact and allergies come from `getPersonDetails`, one person at a time, to
 * somebody with a reason to look.
 *
 * Students Tally created itself — a visitor quick-added at the door who has not
 * been pushed upstream yet — are not here at all. They live entirely in
 * Firestore, which the app already reads live, and merging the two is the
 * client's job (`mergeRoster`).
 */
export const getRoster = onCall<{ force?: boolean } | undefined, Promise<RosterResponse>>(
  { secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<RosterResponse> => {
    await requireMember(request.auth?.uid);

    const config = await resolveConfig(db());
    const client = clientFor(config);
    if (!client) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');

    try {
      const result = await fetchRoster({
        client,
        config,
        cache: sharedCache(config),
        personIds: await rosterPersonIds(db()),
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

/**
 * Parent contact and allergies for one student.
 *
 * Separate from the roster on purpose. This is the data minimisation the PRD
 * asks for made structural: a counselor checking people in at a door never
 * receives a minor's parent's phone number, because the screen they are on
 * never asks for it.
 */
export const getPersonDetails = onCall<{ pcoPersonId: string }, Promise<PersonDetails | null>>(
  { secrets: PCO_SECRETS, timeoutSeconds: 60, memory: '256MiB' },
  async (request): Promise<PersonDetails | null> => {
    await requireCoreTeam(request.auth?.uid);

    const personId = request.data?.pcoPersonId;
    if (typeof personId !== 'string' || personId.length === 0) {
      throw new HttpsError('invalid-argument', 'pcoPersonId is required.');
    }

    const config = await resolveConfig(db());
    const client = clientFor(config);
    if (!client) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');

    try {
      return await fetchPersonDetails({
        client,
        config,
        cache: sharedCache(config),
        personId,
      });
    } catch (error) {
      return reportPcoFailure(error, 'load this student');
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
      const personIds = await rosterPersonIds(db());
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
