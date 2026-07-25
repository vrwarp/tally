/**
 * `provisionAccess` — the door between "signed in to Firebase" and "allowed to
 * use Tally".
 *
 * A counselor who has just signed in has a uid and nothing else: security rules
 * forbid creating your own `users/{uid}` document, because that would let anyone
 * with a Google account grant themselves a role. This callable is the only code
 * that may create one, and it takes the role from the Planning-Center-derived
 * `accessRoster` — never from anything the caller sent.
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { emailKey, type Role } from './pco/mapping.js';
import { asFirestoreLike, PATHS, type FirestoreLike } from './sync/state.js';

/** Mirrors `ProvisionAccessResult` in src/services/functions.ts. */
export interface ProvisionAccessResult {
  status: 'granted' | 'not-on-roster' | 'inactive';
  role: Role | null;
  message: string;
}

export interface VerifiedCaller {
  uid: string;
  email: string;
  displayName: string | null;
}

function readRole(value: unknown): Role | null {
  return value === 'admin' || value === 'core' || value === 'counselor' ? value : null;
}

/**
 * Decides whether the token's email address has actually been proven.
 *
 * A magic link inherently proves the address (the user had to open mail sent to
 * it), and Google has already verified it. A password account whose
 * `email_verified` is false has not proven anything — accepting it would let
 * somebody register `youth.pastor@church.org` and inherit their role.
 */
export function isVerifiedEmail(token: {
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}): boolean {
  if (!token.email) return false;
  if (token.email_verified === true) return true;
  const provider = token.firebase?.sign_in_provider;
  return provider === 'google.com' || provider === 'emailLink';
}

/**
 * The provisioning itself, split out from the callable so it can be driven with
 * a Firestore double.
 */
export async function provisionAccessForCaller(
  db: FirestoreLike,
  caller: VerifiedCaller,
  now: Date,
): Promise<ProvisionAccessResult> {
  const key = emailKey(caller.email);
  const rosterSnapshot = await db.doc(`${PATHS.accessRoster}/${key}`).get();

  if (!rosterSnapshot.exists) {
    return {
      status: 'not-on-roster',
      role: null,
      message: `${caller.email} is not on the Planning Center roster for Footprints. Ask a leader to add you in Planning Center, then try again.`,
    };
  }

  const roster = rosterSnapshot.data() ?? {};
  if (roster.active !== true) {
    return {
      status: 'inactive',
      role: null,
      message: 'Your Planning Center profile is inactive, so access is paused.',
    };
  }

  const userRef = db.doc(`${PATHS.users}/${caller.uid}`);
  const existingSnapshot = await userRef.get();
  const existing = existingSnapshot.exists ? (existingSnapshot.data() ?? {}) : {};

  // An admin who promoted somebody inside Tally must not be demoted by the next
  // sync, so an existing role always wins over the roster's.
  const role = readRole(existing.role) ?? readRole(roster.role) ?? 'counselor';
  const assignedGroupId =
    (typeof existing.assignedGroupId === 'string' ? existing.assignedGroupId : null) ??
    (typeof roster.assignedGroupId === 'string' ? roster.assignedGroupId : null);

  await userRef.set(
    {
      email: caller.email,
      displayName:
        caller.displayName ?? (typeof roster.displayName === 'string' ? roster.displayName : null),
      role,
      assignedGroupId,
      active: true,
      // Preserved so "member since" does not reset every time they sign in.
      createdAt: existing.createdAt ?? Timestamp.fromDate(now),
      lastSeenAt: Timestamp.fromDate(now),
      pcoPersonId: typeof roster.pcoPersonId === 'string' ? roster.pcoPersonId : null,
    },
    { merge: true },
  );

  return { status: 'granted', role, message: 'Welcome to Tally.' };
}

/* -------------------------------------------------------------------------- */
/* Callable                                                                    */
/* -------------------------------------------------------------------------- */

export const provisionAccess = onCall<void, Promise<ProvisionAccessResult>>(
  { timeoutSeconds: 30, memory: '256MiB' },
  async (request: CallableRequest<void>): Promise<ProvisionAccessResult> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in before requesting access.');
    }

    const token = request.auth.token;
    if (!isVerifiedEmail(token)) {
      throw new HttpsError(
        'failed-precondition',
        'Verify your email address before requesting access.',
      );
    }

    const displayName = typeof token.name === 'string' && token.name.trim() ? token.name.trim() : null;

    return provisionAccessForCaller(
      asFirestoreLike(getFirestore()),
      { uid: request.auth.uid, email: token.email as string, displayName },
      new Date(),
    );
  },
);
