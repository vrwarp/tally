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
import type { PcoRosterPerson, PcoStatus, PcoPersonDetails } from '@/types';

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
 * This callable looks their verified email up in Planning Center — live, not
 * against a mirrored allowlist — and provisions the profile server-side.
 */
export const provisionAccess = httpsCallable<void, ProvisionAccessResult>(
  functions,
  'provisionAccess',
);

/* -------------------------------------------------------------------------- */
/* Reading people                                                              */
/* -------------------------------------------------------------------------- */

export interface RosterResponse {
  people: PcoRosterPerson[];
  /** True when Planning Center was not asked, because a recent answer was reused. */
  cached: boolean;
  fetchedAt: string;
  /** Seconds an answer may be reused server-side. `0` means never. */
  cacheTtlSeconds: number;
}

/**
 * The youth roster, read from Planning Center on demand.
 *
 * Tally keeps no copy of the church's people, so this is where the roster comes
 * from — not a Firestore collection somebody swept into shape overnight. Names
 * and grades only; parent contact and allergies are a separate call.
 */
export const getRoster = httpsCallable<{ force?: boolean } | void, RosterResponse>(
  functions,
  'getRoster',
);

/**
 * Parent contact and allergies for one student, for a screen that shows them.
 *
 * Split from the roster so a door volunteer's device never receives a minor's
 * medical notes: the screen they are on does not ask.
 */
export const getPersonDetails = httpsCallable<{ pcoPersonId: string }, PcoPersonDetails | null>(
  functions,
  'getPersonDetails',
);

/** What Settings shows about the connection, asked for rather than watched. */
export const getPlanningCenterStatus = httpsCallable<{ force?: boolean } | void, PcoStatus>(
  functions,
  'getPlanningCenterStatus',
);

/** Drops the server's cached roster, for a leader who just changed something upstream. */
export const refreshPlanningCenter = httpsCallable<void, { status: 'ok' }>(
  functions,
  'refreshPlanningCenter',
);

export interface PushStudentResult {
  status: 'created' | 'updated' | 'skipped';
  pcoPersonId: string | null;
  message: string;
}

/**
 * Pushes one Tally-created student into Planning Center. Used by the core team
 * when they finish a visitor's profile during an event.
 */
export const pushStudentToPlanningCenter = httpsCallable<
  { studentId: string },
  PushStudentResult
>(functions, 'pushStudentToPlanningCenter');

export interface PushPendingResult {
  pushed: number;
  skipped: number;
  errors: number;
}

/**
 * Retries every visitor whose push has not landed.
 *
 * The queue only ever holds students created while Planning Center was
 * unreachable or write-back was off — both things a person notices — so this is
 * a button rather than a schedule.
 */
export const pushPendingVisitors = httpsCallable<void, PushPendingResult>(
  functions,
  'pushPendingVisitors',
);
