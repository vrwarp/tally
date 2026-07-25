/**
 * Firebase bootstrap.
 *
 * Two modes:
 *  - Emulated (`VITE_USE_EMULATORS=true`) — points Auth and Firestore at the
 *    local Emulator Suite. Firebase config values are not required; a demo
 *    project id is synthesised so `firebase emulators:start` and the app agree.
 *  - Live — reads the web config from `VITE_FIREBASE_*`.
 *
 * PRD 6 mandates the Emulator Suite for all local development, so the emulated
 * path is the default developer experience (`npm run dev:emulated`).
 */
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
  type PopupRedirectResolver,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
  type FirestoreLocalCache,
} from 'firebase/firestore';

const env = import.meta.env;

export const USE_EMULATORS = env.VITE_USE_EMULATORS === 'true';

/** Project id used when running fully emulated and none was supplied. */
const DEMO_PROJECT_ID = 'demo-tally';

function readConfig(): FirebaseOptions {
  const projectId = env.VITE_FIREBASE_PROJECT_ID || (USE_EMULATORS ? DEMO_PROJECT_ID : '');

  if (!projectId) {
    throw new Error(
      'Missing Firebase configuration. Copy .env.example to .env.local and fill in the ' +
        'VITE_FIREBASE_* values, or set VITE_USE_EMULATORS=true to run against the ' +
        'Firebase Emulator Suite.',
    );
  }

  return {
    // The emulators never validate these, but the SDK insists on non-empty strings.
    apiKey: env.VITE_FIREBASE_API_KEY || (USE_EMULATORS ? 'demo-api-key' : ''),
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
    appId: env.VITE_FIREBASE_APP_ID || '1:000000000000:web:0000000000000000000000',
  };
}

export const firebaseApp: FirebaseApp = initializeApp(readConfig());

/**
 * The best cache this browser can actually run.
 *
 * A persistent multi-tab cache is what Tally wants: the roster stays readable
 * when the church wifi drops mid-check-in, `onSnapshot` resolves from cache
 * instantly on reopen, and writes queue locally and flush when the connection
 * returns.
 *
 * But `persistentMultipleTabManager` needs the Web Locks API to coordinate
 * between tabs, and Safari did not ship `navigator.locks` until version 16. On
 * anything older the tab manager never acquires its lock, so *no listener ever
 * fires* — no error, no rejection, just silence. Tally's own symptom was a
 * counselor sitting on a spinner forever, because the screen waits for the
 * `users/{uid}` snapshot that was never coming. Safari is the browser a youth
 * volunteer is most likely to be holding, which makes this the worst possible
 * place to assume a modern API.
 *
 * So: multi-tab where it works, single-tab where it does not, memory as the
 * floor. Losing multi-tab coordination costs a little cross-tab freshness.
 * Losing the whole app costs the check-in.
 */
function bestLocalCache(): FirestoreLocalCache {
  const hasWebLocks = typeof navigator !== 'undefined' && 'locks' in navigator;

  if (hasWebLocks) {
    return persistentLocalCache({ tabManager: persistentMultipleTabManager() });
  }

  /*
   * Measured, not assumed: single-tab persistence was tried here first, on the
   * reasoning that a counselor has one tab open so the lease is uncontended.
   * It wedges the same way — the listener never fires and never errors, and the
   * app sits on "restoring your session" forever.
   *
   * So on these browsers Tally gives up offline persistence entirely. That is a
   * genuine loss: no cached roster when the church wifi drops, no writes queued
   * across a reload. It is the smaller loss. An app that works while online
   * beats an app that does not start, and the roster has its own copy in
   * localStorage (see services/roster.ts) so the door still has names.
   */
  console.info('[tally] No Web Locks API — offline persistence is off on this browser.');
  return memoryLocalCache();
}

function createDb(): Firestore {
  try {
    return initializeFirestore(firebaseApp, { localCache: bestLocalCache() });
  } catch (cause) {
    // Private browsing, a blocked IndexedDB, a quota refusal. An in-memory
    // cache means no offline support, which is a real loss — and still
    // enormously better than an app that does not start.
    console.warn('[tally] Offline persistence unavailable; falling back to memory.', cause);
    return initializeFirestore(firebaseApp, { localCache: memoryLocalCache() });
  }
}

export const db: Firestore = createDb();

/**
 * Auth, built *without* a popup/redirect resolver.
 *
 * `getAuth()` is the obvious call, and it is the wrong one here. It bundles
 * `browserPopupRedirectResolver`, and Firebase initialises that resolver while
 * it is working out who is signed in — which means every cold start, for every
 * user, opens a hidden iframe against `apis.google.com` before the app renders
 * anything. On a network that cannot reach Google (church guest wifi behind a
 * captive portal, a school filter, a phone with one bar) that request does not
 * fail fast; it hangs for the better part of fifteen seconds, several times
 * over, while a counselor watches a spinner on the check-in screen.
 *
 * Almost nobody needs it: the magic link is the primary path and never touches
 * the resolver. So it is left out here and passed explicitly to the three calls
 * that genuinely require it — see `popupRedirectResolver()` below.
 *
 * Persistence is listed in preference order. IndexedDB survives an iOS home
 * screen launch where `localStorage` sometimes does not; `localStorage` is the
 * fallback for browsers that block IndexedDB in private mode.
 */
export const auth: Auth = initializeAuth(firebaseApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});

/**
 * Loads the popup/redirect resolver, on demand.
 *
 * Dynamically imported so the iframe machinery is neither initialised nor even
 * downloaded until somebody actually chooses Google sign-in.
 */
export async function popupRedirectResolver(): Promise<PopupRedirectResolver> {
  const { browserPopupRedirectResolver } = await import('firebase/auth');
  return browserPopupRedirectResolver;
}

if (USE_EMULATORS) {
  const host = env.VITE_EMULATOR_HOST || '127.0.0.1';
  const authPort = Number(env.VITE_EMULATOR_AUTH_PORT ?? 9099);
  const firestorePort = Number(env.VITE_EMULATOR_FIRESTORE_PORT ?? 8080);

  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, firestorePort);

  console.info(
    `[tally] Using Firebase emulators — auth :${authPort}, firestore :${firestorePort}`,
  );
}
