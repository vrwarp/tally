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
import { getFirestore } from 'firebase-admin/firestore';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { PCO_SECRETS, resolveConfig, type PcoConfig } from './config.js';
import { asFirestoreLike, PATHS, type FirestoreLike } from './firestore.js';
import { createPcoClient, PcoApiError, type PcoClient } from './pco/client.js';
import { fetchList, fetchLists, type PcoListSummary } from './pco/lists.js';
import {
  fetchPersonDetails,
  fetchYouthRoster,
  type PersonDetails,
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
 */
function reportPcoFailure(error: unknown, what: string): never {
  if (error instanceof HttpsError) throw error;

  if (error instanceof PcoApiError) {
    if (error.status === 429) {
      throw new HttpsError(
        'resource-exhausted',
        'Planning Center is rate-limiting us. Try again in a moment.',
      );
    }
    if (error.status === 401 || error.status === 403) {
      throw new HttpsError(
        'permission-denied',
        "Planning Center rejected Tally's credentials. A leader needs to check the connection in Settings.",
      );
    }
  }

  logger.error(`Failed to ${what}`, { error: String(error) });
  throw new HttpsError('unavailable', `Could not reach Planning Center to ${what}.`);
}

/* -------------------------------------------------------------------------- */
/* Reading people                                                              */
/* -------------------------------------------------------------------------- */

/** Mirrors `RosterResponse` in src/services/functions.ts. */
interface RosterResponse {
  people: RosterPerson[];
  cached: boolean;
  fetchedAt: string;
  /** Echoed so the app can say how stale what it is showing might be. */
  cacheTtlSeconds: number;
}

/**
 * The youth roster, read from Planning Center on demand.
 *
 * Open to any active member of the team, not just the core: a door volunteer
 * cannot check anybody in without it. It returns names and grades only — parent
 * contact and allergies come from `getPersonDetails`, one person at a time, to
 * somebody with a reason to look.
 */
export const getRoster = onCall<{ force?: boolean } | undefined, Promise<RosterResponse>>(
  { secrets: PCO_SECRETS, timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<RosterResponse> => {
    await requireMember(request.auth?.uid);

    const config = await resolveConfig(db());
    const client = clientFor(config);
    if (!client) throw new HttpsError('failed-precondition', config.configError ?? 'Not configured.');

    try {
      const result = await fetchYouthRoster({
        client,
        config,
        cache: sharedCache(config),
        force: request.data?.force === true,
      });
      return { ...result, cacheTtlSeconds: config.cacheTtlSeconds };
    } catch (error) {
      return reportPcoFailure(error, 'load the roster');
    }
  },
);

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
  rosterSource: 'list' | 'grade';
  writeBack: 'off' | 'create' | 'full';
  cacheTtlSeconds: number;
  baseUrlOverridden: boolean;
  peopleVisible: number | null;
  /**
   * The effective settings, so Settings can both describe the connection and
   * open an editor already filled in with what is actually in force — rather
   * than with what the browser guesses is in force.
   *
   * Everything here is non-secret by construction: the token pair is never
   * part of this shape, and `baseUrl` is an API root, not a credential.
   */
  settings: {
    rosterSource: 'list' | 'grade';
    studentListId: string | null;
    counselorListId: string | null;
    minGrade: number;
    maxGrade: number;
    writeBack: 'off' | 'create' | 'full';
    smallGroupField: string | null;
    cacheTtlSeconds: number;
    baseUrl: string;
    /** True when these came from `config/planningCenter` rather than a deploy. */
    managedInApp: boolean;
  };
  /**
   * The names behind the configured list ids, when they could be read.
   *
   * A bare id is exactly as opaque on a status screen as it was in a deploy
   * parameter, and "Footprints Students (47 people)" is the difference between
   * a leader recognising their own configuration and hoping it is right.
   */
  studentList: PcoListSummary | null;
  counselorList: PcoListSummary | null;
}

/**
 * Looks up the configured lists so the screen can name them.
 *
 * Never allowed to fail the status call: a deleted list, a token without
 * permission to read Lists, or a slow response are all things the roster
 * question itself answers better. The names are a nicety on top.
 */
async function describeConfiguredLists(
  client: PcoClient,
  config: PcoConfig,
): Promise<{ studentList: PcoListSummary | null; counselorList: PcoListSummary | null }> {
  const lookup = async (listId: string | null): Promise<PcoListSummary | null> => {
    if (!listId) return null;
    try {
      return await fetchList(client, listId);
    } catch {
      return null;
    }
  };

  const [studentList, counselorList] = await Promise.all([
    lookup(config.rosterSource === 'list' ? config.studentListId : null),
    lookup(config.counselorListId),
  ]);
  return { studentList, counselorList };
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
      rosterSource: config.rosterSource,
      writeBack: config.writeBack,
      cacheTtlSeconds: config.cacheTtlSeconds,
      baseUrlOverridden: config.baseUrlOverridden,
      // Echoed even when the connection is broken: the editor this feeds is
      // exactly where somebody goes to fix a broken connection, so it must open
      // filled in rather than empty.
      settings: {
        rosterSource: config.rosterSource,
        studentListId: config.studentListId,
        counselorListId: config.counselorListId,
        minGrade: config.minGrade,
        maxGrade: config.maxGrade,
        writeBack: config.writeBack,
        smallGroupField: config.smallGroupField,
        cacheTtlSeconds: config.cacheTtlSeconds,
        baseUrl: config.baseUrl,
        managedInApp: config.managedInApp,
      },
      studentList: null,
      counselorList: null,
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
      const [result, lists] = await Promise.all([
        fetchYouthRoster({
          client,
          config,
          cache: sharedCache(config),
          force: request.data?.force === true,
        }),
        describeConfiguredLists(client, config),
      ]);
      return {
        ...base,
        ...lists,
        configured: true,
        reachable: true,
        problem:
          result.people.length === 0
            ? 'Planning Center answered, but no students matched. Check the roster source and grade range.'
            : null,
        peopleVisible: result.people.length,
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
