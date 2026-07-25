/**
 * Firebase bootstrap.
 *
 * Two modes:
 *  - Emulated (`VITE_USE_EMULATORS=true`) — points Auth and Firestore at the
 *    local Emulator Suite. Firebase config values are not required; a demo
 *    project id is synthesised so `firebase emulators:start` and the app agree.
 *  - Live — reads the whole web config as one JSON object from
 *    `VITE_FIREBASE_CONFIG`, exactly as the Firebase console prints it. One
 *    variable rather than six: the console hands it over as an object, so
 *    transcribing it field by field only creates opportunities to get it wrong.
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

/**
 * The emulators never validate any of this, but the SDK insists on non-empty
 * strings, so emulated runs get a synthetic config and need no real project.
 */
function demoConfig(): FirebaseOptions {
  return {
    apiKey: 'demo-api-key',
    authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
    projectId: DEMO_PROJECT_ID,
    storageBucket: `${DEMO_PROJECT_ID}.firebasestorage.app`,
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
  };
}

/** The three the SDK can neither synthesise nor do without. */
const REQUIRED = ['apiKey', 'projectId', 'appId'] as const;

function readConfig(): FirebaseOptions {
  const raw = env.VITE_FIREBASE_CONFIG?.trim();

  if (!raw) {
    if (USE_EMULATORS) return demoConfig();
    throw new Error(
      'Missing Firebase configuration. Copy .env.example to .env.local and paste the web ' +
        'config object from the Firebase console (Project settings -> General -> Your apps) ' +
        'into VITE_FIREBASE_CONFIG, or set VITE_USE_EMULATORS=true to run against the ' +
        'Firebase Emulator Suite.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'VITE_FIREBASE_CONFIG is not valid JSON. It holds the whole config object from the ' +
        'Firebase console on one line, e.g. {"apiKey":"...","projectId":"...","appId":"..."}. ' +
        'Replacing the six old VITE_FIREBASE_API_KEY / _PROJECT_ID / … variables? All six ' +
        'become this one.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('VITE_FIREBASE_CONFIG must be a JSON object, not a bare value or array.');
  }

  const config = parsed as FirebaseOptions;

  // An emulated run may still supply a partial config; fill the rest with the
  // synthetic values rather than making the developer write fields nothing reads.
  if (USE_EMULATORS) return { ...demoConfig(), ...config };

  const missing = REQUIRED.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(
      `VITE_FIREBASE_CONFIG is missing ${missing.join(', ')}. Copy the whole object from the ` +
        'Firebase console rather than assembling it by hand.',
    );
  }

  return config;
}

export const firebaseApp: FirebaseApp = initializeApp(readConfig());

/**
 * Set when offline persistence has been caught wedging this tab (see
 * `recoverFromWedgedPersistence`). Session-scoped on purpose: the next time the
 * counselor opens Tally it gets another chance at the good path.
 */
const NO_PERSISTENCE_KEY = 'tally:no-persistence';

function persistenceDisabled(): boolean {
  try {
    return window.sessionStorage.getItem(NO_PERSISTENCE_KEY) === '1';
  } catch {
    // Private mode. Nothing was ever stored, so nothing is disabled.
    return false;
  }
}

/**
 * Last resort for a Firestore client that has gone silent.
 *
 * The persistent cache coordinates tabs through the Web Locks API, and a lock
 * that is never granted takes the whole client with it: no listener fires, no
 * error is raised, nothing rejects. There is no way back from inside the page —
 * the cache is chosen at `initializeFirestore` and cannot be swapped — so the
 * only real recovery is to reload having decided not to use it.
 *
 * Returns false when persistence is already off, which means the silence has a
 * different cause and reloading would only cost the user their place.
 */
export function recoverFromWedgedPersistence(): boolean {
  if (persistenceDisabled()) return false;

  try {
    window.sessionStorage.setItem(NO_PERSISTENCE_KEY, '1');
  } catch {
    // Without somewhere to record the decision the reload would come straight
    // back to the same wedge, and then reload again. Better to stay put.
    return false;
  }

  console.warn('[tally] Firestore never responded; reloading without offline persistence.');
  window.location.reload();
  return true;
}

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
 * So: the persistent cache where the browser can be trusted to run it, memory
 * everywhere else — including on a browser that looked capable and then proved
 * otherwise. Losing offline support costs a little. Losing the whole app costs
 * the check-in.
 */
function bestLocalCache(): FirestoreLocalCache {
  const hasWebLocks = typeof navigator !== 'undefined' && 'locks' in navigator;

  if (hasWebLocks && !persistenceDisabled()) {
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
  console.info(
    hasWebLocks
      ? '[tally] Offline persistence is off for this session after it stopped responding.'
      : '[tally] No Web Locks API — offline persistence is off on this browser.',
  );
  return memoryLocalCache();
}

/**
 * Safari, and every browser on an iPhone — all WebKit underneath.
 *
 * Chrome and Edge on macOS both carry "Safari" in their user agent, so the
 * signal is WebKit *without* the Chromium markers.
 */
function isWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
}

function createDb(): Firestore {
  /*
   * Force long-polling on WebKit.
   *
   * Firestore streams over WebChannel and picks its transport by probing the
   * connection once at startup. On WebKit that probe is not reliable, and when
   * it guesses wrong the failure is silent and total: listeners are accepted,
   * never deliver, and never error. Tally's symptom was a counselor signed in
   * and looking at a screen of skeleton rows that would never fill, with no
   * error anywhere to explain it.
   *
   * Long-polling is what the detector settles on for Safari anyway. Naming it
   * up front costs one round trip of latency and removes the guess.
   *
   * Turning the detector *off* is the other half, and it is not optional. Since
   * v10 the SDK auto-detects by default, so forcing long-polling merely added a
   * second mechanism alongside the probe rather than replacing it — and on WebKit
   * the probe then breaks the very stream it is measuring. Every read and every
   * write waits about thirty seconds for an ack that the cycling connection
   * eventually delivers. It looks exactly like a slow server and it is neither:
   * against the emulator the end-to-end suite went from minutes to an hour and
   * timed out browser-wide.
   *
   * The short poll cycle is emulator-only. It makes those acks arrive promptly
   * where a test is waiting on them, and a real counselor's phone keeps the
   * default cycle rather than waking up every five seconds.
   */
  const transport = isWebKit()
    ? {
        experimentalForceLongPolling: true,
        experimentalAutoDetectLongPolling: false,
        ...(USE_EMULATORS ? { experimentalLongPollingOptions: { timeoutSeconds: 5 } } : {}),
      }
    : {};

  try {
    return initializeFirestore(firebaseApp, { localCache: bestLocalCache(), ...transport });
  } catch (cause) {
    // Private browsing, a blocked IndexedDB, a quota refusal. An in-memory
    // cache means no offline support, which is a real loss — and still
    // enormously better than an app that does not start.
    console.warn('[tally] Offline persistence unavailable; falling back to memory.', cause);
    return initializeFirestore(firebaseApp, { localCache: memoryLocalCache(), ...transport });
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
