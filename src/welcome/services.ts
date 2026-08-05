/**
 * The welcome page's whole back end: two callables, and no database at all.
 *
 * Deliberately narrower than the kiosk's services module, which at least reads
 * Firestore. This page holds no session, reads no documents and subscribes to
 * nothing — it asks whether its code is live, and it submits one form. Importing
 * `firebase/firestore` here would be both dead weight on a phone in a foyer and
 * a claim about what an unauthenticated page may read, so neither the lite SDK
 * nor the full one appears in this graph.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { missingKeys, parseFirebaseConfig } from '@/lib/firebaseConfig';
import type { RegisterFamilyRequest, RegisterFamilyResult } from '@/types';

const env = import.meta.env;
const USE_EMULATORS = env.VITE_USE_EMULATORS === 'true';
const DEMO_PROJECT_ID = 'demo-tally';

function readConfig() {
  const raw = env.VITE_FIREBASE_CONFIG?.trim();
  const demo = {
    apiKey: 'demo-api-key',
    authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
    projectId: DEMO_PROJECT_ID,
    storageBucket: `${DEMO_PROJECT_ID}.firebasestorage.app`,
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
  };

  if (!raw) {
    if (USE_EMULATORS) return demo;
    throw new Error('Missing VITE_FIREBASE_CONFIG. See src/lib/firebase.ts.');
  }
  const config = parseFirebaseConfig(raw);
  if (USE_EMULATORS) return { ...demo, ...config };

  const missing = missingKeys(config as Record<string, unknown>);
  if (missing.length > 0) {
    throw new Error(`VITE_FIREBASE_CONFIG is missing ${missing.join(', ')}.`);
  }
  return config;
}

const app: FirebaseApp = initializeApp(readConfig(), 'welcome');
const functions = getFunctions(app);

if (USE_EMULATORS) {
  const host = env.VITE_EMULATOR_HOST || '127.0.0.1';
  connectFunctionsEmulator(functions, host, Number(env.VITE_EMULATOR_FUNCTIONS_PORT ?? 5001));
}

export interface CodeCheck {
  valid: boolean;
  reason?: 'not-found' | 'expired' | 'exhausted' | 'ok';
  /** Whether there is an upstream record to put a medical note on. */
  allergiesSupported: boolean;
}

const validateRegistrationCodeCallable = httpsCallable<{ code: string }, CodeCheck>(
  functions,
  'validateRegistrationCode',
);
const registerFamilyCallable = httpsCallable<
  RegisterFamilyRequest & { code: string; allergies?: (string | null)[] },
  RegisterFamilyResult
>(functions, 'registerFamily');

/**
 * Asked before somebody types their children's names rather than after.
 *
 * A network failure answers "valid" rather than refusing: the code may well be
 * fine, and a family who is told to go back to the kiosk because the foyer wifi
 * blinked has been sent away for nothing. The submit is where a dead code is
 * actually refused, and that refusal comes from the server.
 */
export async function validateCode(code: string): Promise<CodeCheck> {
  try {
    const { data } = await validateRegistrationCodeCallable({ code });
    return data;
  } catch {
    return { valid: true, allergiesSupported: false };
  }
}

export async function registerFamily(
  request: RegisterFamilyRequest & { code: string; allergies?: (string | null)[] },
): Promise<RegisterFamilyResult> {
  const { data } = await registerFamilyCallable(request);
  return data;
}
