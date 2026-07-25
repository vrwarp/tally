/**
 * Cloud Functions entry points.
 *
 * The exported names are a contract with src/services/functions.ts — renaming
 * one here silently breaks a button in the app, because `httpsCallable` resolves
 * by string. Everything a handler does lives in ./sync and ./access; this file
 * is only wiring, permission checks and the shapes the client expects back.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger, setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { loadConfig, PCO_SECRETS, syncSchedule, type PcoConfig } from './config.js';
import { createPcoClient, type PcoClient } from './pco/client.js';
import { pushPendingStudents, pushStudent, type PushStudentResult } from './sync/pushStudents.js';
import {
  asFirestoreLike,
  createSyncStateStore,
  emptyCounts,
  isRunActive,
  PATHS,
  readSyncState,
  type FirestoreLike,
  type PcoSyncCounts,
} from './sync/state.js';
import { syncPeople } from './sync/syncPeople.js';

export { provisionAccess } from './access.js';

initializeApp();

// The whole ministry is in one place, so co-locating with Firestore is the only
// latency decision that matters here.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

/** Mirrors `SyncNowResult` in src/services/functions.ts. */
interface SyncNowResult {
  status: 'ok' | 'error' | 'already-running';
  counts: PcoSyncCounts;
  durationMs: number;
  message: string;
}

function db(): FirestoreLike {
  return asFirestoreLike(getFirestore());
}

/**
 * Builds a client, or returns the reason it cannot be built. Missing
 * credentials are reported to the caller and recorded in `config/pcoSync`
 * rather than thrown, so the Settings screen can name the missing value.
 */
function clientFor(config: PcoConfig): PcoClient | null {
  if (config.configError) return null;
  return createPcoClient({
    appId: config.appId,
    secret: config.secret,
    baseUrl: config.baseUrl,
  });
}

async function recordConfigError(config: PcoConfig, triggeredBy: string | null): Promise<void> {
  const now = new Date();
  const state = createSyncStateStore(db());
  const prior = await readSyncState(db());
  await state.begin({
    rosterSource: config.rosterSource,
    writeBack: config.writeBack,
    triggeredBy,
    now,
  });
  await state.finish({
    status: 'error',
    counts: emptyCounts(),
    cursor: prior.cursor,
    lastFullSyncAt: prior.lastFullSyncAt,
    lastError: config.configError,
    now,
  });
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

/* -------------------------------------------------------------------------- */
/* Scheduled pull                                                              */
/* -------------------------------------------------------------------------- */

export const syncPlanningCenter = onSchedule(
  {
    schedule: syncSchedule(),
    secrets: PCO_SECRETS,
    timeoutSeconds: 540,
    memory: '512MiB',
    // A retry would start a second sweep on top of the one that just failed;
    // the next tick is soon enough and starts from a clean cursor.
    retryCount: 0,
  },
  async () => {
    const config = loadConfig();
    const client = clientFor(config);
    if (!client) {
      logger.error('Planning Center sync skipped', { reason: config.configError });
      await recordConfigError(config, 'schedule');
      return;
    }

    // `syncPeople` promotes itself to a full sweep once a day; the schedule
    // never has to decide.
    const result = await syncPeople({ db: db(), client, config, triggeredBy: 'schedule', logger });
    // Reconciling after the pull means a student Planning Center just told us
    // about is already linked and no longer looks pending.
    const pushed = await pushPendingStudents({ db: db(), client, config, logger });
    logger.info('Planning Center sync finished', { ...result.counts, pushed: pushed.pushed });
  },
);

/* -------------------------------------------------------------------------- */
/* Manual pull                                                                 */
/* -------------------------------------------------------------------------- */

export const syncPlanningCenterNow = onCall<{ full?: boolean } | undefined, Promise<SyncNowResult>>(
  { secrets: PCO_SECRETS, timeoutSeconds: 540, memory: '512MiB' },
  async (request): Promise<SyncNowResult> => {
    await requireCoreTeam(request.auth?.uid);

    const config = loadConfig();
    const client = clientFor(config);
    if (!client) {
      await recordConfigError(config, request.auth?.uid ?? null);
      return {
        status: 'error',
        counts: emptyCounts(),
        durationMs: 0,
        message: config.configError ?? 'Planning Center is not configured.',
      };
    }

    // Two concurrent sweeps would fight over the cursor and double every count.
    const prior = await readSyncState(db());
    if (isRunActive(prior, new Date())) {
      return {
        status: 'already-running',
        counts: emptyCounts(),
        durationMs: 0,
        message: 'A Planning Center sync is already running.',
      };
    }

    const result = await syncPeople({
      db: db(),
      client,
      config,
      full: request.data?.full === true,
      triggeredBy: request.auth?.uid ?? null,
      logger,
    });

    if (result.status === 'ok') {
      const pushed = await pushPendingStudents({ db: db(), client, config, logger });
      result.counts.visitorsPushed = pushed.pushed;
      result.counts.errors += pushed.errors;
    }

    return {
      status: result.status,
      counts: result.counts,
      durationMs: result.durationMs,
      message: result.message,
    };
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

  const config = loadConfig();
  const client = clientFor(config);
  if (!client) {
    return {
      status: 'skipped',
      pcoPersonId: null,
      message: config.configError ?? 'Planning Center is not configured.',
    };
  }

  return pushStudent({ db: db(), client, config, studentId, logger });
});

/**
 * A quick-added visitor should exist in Planning Center before the counselor
 * has walked back to the door. Best effort only: the scheduled run reconciles
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

    const config = loadConfig();
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
      logger.info('Pushed a new student to Planning Center', {
        studentId: event.params.studentId,
        ...result,
      });
    } catch (error) {
      logger.warn('Immediate push failed; the scheduled sync will retry', {
        studentId: event.params.studentId,
        error: String(error),
      });
    }
  },
);
