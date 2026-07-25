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
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
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
 * Persistent multi-tab cache keeps the roster readable when the church wifi
 * drops mid-check-in, and lets `onSnapshot` resolve from cache instantly on
 * reopen. Writes queue locally and flush when the connection returns.
 */
export const db: Firestore = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

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
