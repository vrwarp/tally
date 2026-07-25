/**
 * Callable Cloud Function clients.
 *
 * Anything that needs the Planning Center credentials runs server-side: the
 * Personal Access Token must never reach a browser, and Planning Center does
 * not serve CORS headers for API clients anyway. These wrappers are the app's
 * only door into that code.
 */
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { USE_EMULATORS, firebaseApp } from '@/lib/firebase';
import type { PcoSyncCounts } from '@/types';

const functions = getFunctions(firebaseApp);

if (USE_EMULATORS) {
  const host = import.meta.env.VITE_EMULATOR_HOST || '127.0.0.1';
  const port = Number(import.meta.env.VITE_EMULATOR_FUNCTIONS_PORT ?? 5001);
  connectFunctionsEmulator(functions, host, port);
}

export interface ProvisionAccessResult {
  /** `granted` — a `users/{uid}` document now exists and is active. */
  status: 'granted' | 'not-on-roster' | 'inactive';
  role: 'counselor' | 'core' | 'admin' | null;
  message: string;
}

/**
 * Exchanges a freshly authenticated session for a Tally profile.
 *
 * A counselor who has just signed in has a Firebase uid but no `users/{uid}`
 * document — and cannot create one, because rules forbid self-granted access.
 * This callable matches their verified email against the Planning-Center-derived
 * allowlist and provisions the profile server-side.
 */
export const provisionAccess = httpsCallable<void, ProvisionAccessResult>(
  functions,
  'provisionAccess',
);

export interface SyncNowResult {
  status: 'ok' | 'error' | 'already-running';
  counts: PcoSyncCounts;
  durationMs: number;
  message: string;
}

/** Core-team button in Settings: pull Planning Center now rather than waiting. */
export const syncPlanningCenterNow = httpsCallable<
  { full?: boolean } | void,
  SyncNowResult
>(functions, 'syncPlanningCenterNow');

export interface PushStudentResult {
  status: 'created' | 'updated' | 'skipped';
  pcoPersonId: string | null;
  message: string;
}

/**
 * Pushes one Tally-created student into Planning Center immediately, instead of
 * waiting for the next scheduled reconcile. Used by the core team when they
 * finish a visitor's profile during an event.
 */
export const pushStudentToPlanningCenter = httpsCallable<
  { studentId: string },
  PushStudentResult
>(functions, 'pushStudentToPlanningCenter');
