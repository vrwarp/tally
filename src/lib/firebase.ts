/**
 * Firebase bootstrap.
 *
 * Two modes:
 *  - Emulated (`VITE_USE_EMULATORS=true`) — points Auth and Firestore at the
 *    local Emulator Suite. Firebase config values are not required; a demo
 *    project id is synthesised so `firebase emulators:start` and the app agree.
 *  - Live — reads the whole web config from `VITE_FIREBASE_CONFIG`, either as
 *    JSON or exactly as the Firebase console prints it (see `firebaseConfig.ts`).
 *    One variable rather than six: the console hands it over as an object, so
 *    transcribing it field by field only creates opportunities to get it wrong.
 *
 * PRD 6 mandates the Emulator Suite for all local development, so the emulated
 * path is the default developer experience (`npm run dev:emulated`).
 */
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';

/**
 * Injected by Vite (`define` in vite.config.ts). `true` only for the build the
 * end-to-end suite makes; `false` everywhere else, which is what lets the test
 * hook below be dead-code-eliminated rather than merely unreachable.
 */
declare const __E2E_HOOKS__: boolean;
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
  type Firestore,
} from 'firebase/firestore';

import { parseAuthDomains, resolveAuthDomain } from './authDomain';
import { missingKeys, parseFirebaseConfig } from './firebaseConfig';

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

  const config = parseFirebaseConfig(raw) as FirebaseOptions;

  // An emulated run may still supply a partial config; fill the rest with the
  // synthetic values rather than making the developer write fields nothing reads.
  if (USE_EMULATORS) return { ...demoConfig(), ...config };

  const missing = missingKeys(config as Record<string, unknown>);
  if (missing.length > 0) {
    throw new Error(
      `VITE_FIREBASE_CONFIG is missing ${missing.join(', ')}. Copy the whole object from the ` +
        'Firebase console rather than assembling it by hand.',
    );
  }

  /*
   * Serve the sign-in handler from this very origin where we can.
   *
   * The console's `authDomain` is `<project>.firebaseapp.com`, which makes the
   * redirect flow third-party and therefore dead on iOS — and the redirect is
   * the only flow an installed home-screen app has. Firebase Hosting answers
   * `/__/auth/*` on every domain attached to the site, so naming the domain is
   * the entire fix. `VITE_AUTH_DOMAINS` is the operator's statement that the
   * handler there is registered with Google; see `authDomain.ts` for why that
   * cannot be inferred.
   */
  const authDomain = resolveAuthDomain({
    configured: typeof config.authDomain === 'string' ? config.authDomain : undefined,
    publicDomains: parseAuthDomains(env.VITE_AUTH_DOMAINS),
    host: typeof window === 'undefined' ? undefined : window.location.host,
  });

  return authDomain ? { ...config, authDomain } : config;
}

export const firebaseApp: FirebaseApp = initializeApp(readConfig());

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

  /*
   * In-memory cache, always. Tally is an online-only app.
   *
   * The persistent multi-tab cache used to be the default here, and it is the
   * one that promises the nice things — a roster still readable when the church
   * wifi drops, writes queued across a reload. It also coordinates tabs through
   * the Web Locks API, and a lock that is never granted takes the whole client
   * down with it: no listener fires, no error is raised, nothing rejects. The
   * symptom was a counselor sitting on a spinner forever with a queue at the
   * door, because the screen waits for a `users/{uid}` snapshot that was never
   * coming. Single-tab persistence was tried and wedges the same way, and there
   * is no way back from inside the page — the cache is chosen once, here.
   *
   * Offline data is not a requirement, so the trade is not worth making. A
   * memory cache cannot wedge and cannot be refused by a browser that blocks
   * IndexedDB in private mode, which is why nothing here needs a fallback. The
   * door still has names when Planning Center is unreachable: the roster keeps
   * its own copy in localStorage (see services/roster.ts), which is a cache of
   * a callable's response and nothing to do with Firestore.
   */
  return initializeFirestore(firebaseApp, { localCache: memoryLocalCache(), ...transport });
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

  /**
   * The end-to-end fallback: mint the Google credential a popup would produce.
   *
   * The suite drives the *real* popup wherever it can — that is the flow a
   * counselor uses, and it is worth testing. It cannot everywhere:
   * `signInWithPopup` boots Firebase's hidden iframe from `apis.google.com`
   * (unconditionally — only the iframe's URL is emulator-aware), so in a
   * sandbox with no route to Google the run dies at Google's front door rather
   * than at anything Tally owns. The suite detects that and comes here instead,
   * saying so loudly.
   *
   * The Auth emulator accepts a JSON "ID token" in place of a real one for
   * exactly this purpose, and the session it mints carries
   * `sign_in_provider: google.com` — which is the only thing `provisionAccess`
   * inspects. So everything downstream is still exercised for real: the
   * invitation lookup, the seeded-admin grant, the role, and every rule that
   * reads the profile. Only the Google round-trip is skipped.
   *
   * Two guards, both required. `__E2E_HOOKS__` is a compile-time constant that
   * is `false` in every build except the suite's own, so this whole block is
   * eliminated from anything a church deploys; `USE_EMULATORS` means even that
   * build refuses to expose it against a real project. A test seam that ships
   * is not a test seam, it is a way in.
   */
  if (__E2E_HOOKS__) {
    (window as unknown as Record<string, unknown>).__tallyEmulatorSignIn = async (
      email: string,
      displayName?: string,
    ): Promise<void> => {
      const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth');
      await signInWithCredential(
        auth,
        GoogleAuthProvider.credential(
          JSON.stringify({
            sub: `google-${email}`,
            email,
            email_verified: true,
            name: displayName ?? email,
          }),
        ),
      );
    };
  }
}
