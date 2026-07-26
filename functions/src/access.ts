/**
 * `provisionAccess` — the door between "signed in to Google" and "allowed to
 * use Tally".
 *
 * A counselor who has just signed in has a uid and nothing else: security rules
 * forbid creating your own `users/{uid}` document, because that would let anyone
 * with a Google account grant themselves a role. This callable is the only code
 * that may create one, and it takes the role from Tally's own records — never
 * from anything the caller sent.
 *
 * ## Where the answer comes from
 *
 * Three sources, checked in this order:
 *
 *   1. `TALLY_ADMIN_EMAILS` — a standing admin grant that the app cannot
 *      revoke. This is the break-glass, and it is re-asserted on every sign-in
 *      so a mis-click inside Tally can never lock the ministry out of it.
 *   2. An existing `users/{uid}` profile — somebody already provisioned. Their
 *      role is whatever an admin has since made it, so this path deliberately
 *      does *not* reset it from the invitation they arrived on.
 *   3. `invitations/{emailKey}` — an admin said this address may sign in, and
 *      with what starting role. Consumed on first sign-in.
 *
 * Anything else is "not on the roster", which is reported as a refusal rather
 * than an error: a volunteer who has not been added yet is a normal thing to
 * be, not a failure.
 *
 * ## Why this no longer asks Planning Center
 *
 * It used to look the address up in a Planning Center List. A List is generated
 * from filter rules, so "these particular twelve adults may sign in" was only
 * expressible by inventing a custom field on every person and filtering on it.
 * The allowlist was never really Planning Center's to hold; it is Tally's, and
 * now it lives here.
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { seededAdminEmails } from './config.js';
import { emailKey, type Role } from './pco/mapping.js';
import { asFirestoreLike, PATHS, type FirestoreLike } from './firestore.js';

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

/** One invitation, as an admin left it. */
export interface Invitation {
  role: Role;
  active: boolean;
}

function readRole(value: unknown): Role | null {
  return value === 'admin' || value === 'core' || value === 'counselor' ? value : null;
}

/**
 * Decides whether the caller signed in the one way Tally accepts.
 *
 * Google only, deliberately. Tally's entire authorisation model is keyed on an
 * email address, so what matters is not that the caller *typed* one but that a
 * provider Tally trusts has confirmed it is theirs. An unverified password
 * registration proves nothing — it would let somebody register
 * `youth.pastor@church.org` and inherit their invitation.
 *
 * Email links used to be accepted too, on the grounds that opening the mail
 * proves the address. That is true, and it is also a second way in to maintain,
 * a second set of failure modes to explain at a church door, and a mailbox
 * somebody can leave signed in on a shared phone. One door is easier to watch.
 */
export function isGoogleSignIn(token: {
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}): boolean {
  if (!token.email) return false;
  return token.firebase?.sign_in_provider === 'google.com';
}

/**
 * The provisioning itself, split out from the callable so it can be driven with
 * a Firestore double.
 */
export async function provisionAccessForCaller(
  db: FirestoreLike,
  caller: VerifiedCaller,
  now: Date,
  seededAdmins: readonly string[],
): Promise<ProvisionAccessResult> {
  const email = caller.email.trim().toLowerCase();
  const seeded = seededAdmins.includes(email);

  const userRef = db.doc(`${PATHS.users}/${caller.uid}`);
  const existingSnapshot = await userRef.get();
  const existing = existingSnapshot.exists ? (existingSnapshot.data() ?? {}) : {};
  const existingRole = readRole(existing.role);

  /*
   * A seeded admin is provisioned before anything else is even read.
   *
   * Including when their profile says `active: false`. That combination is
   * exactly the accident this list exists for — somebody deactivated the last
   * admin — and honouring it would mean the break-glass breaks with everything
   * else.
   */
  if (seeded) {
    await writeProfile(userRef, caller, email, 'admin', existing, now);
    return { status: 'granted', role: 'admin', message: 'Welcome to Tally.' };
  }

  if (existingSnapshot.exists) {
    if (existing.active !== true) {
      return {
        status: 'inactive',
        role: null,
        message: 'Your access to Tally has been paused. Ask an admin to turn it back on.',
      };
    }

    // An admin who promoted somebody inside Tally must not be demoted by the
    // invitation they originally arrived on, so the profile wins over it.
    const role = existingRole ?? 'counselor';
    await writeProfile(userRef, caller, email, role, existing, now);
    return { status: 'granted', role, message: 'Welcome back to Tally.' };
  }

  const inviteSnapshot = await db.doc(`${PATHS.invitations}/${emailKey(email)}`).get();
  if (!inviteSnapshot.exists) {
    return {
      status: 'not-on-roster',
      role: null,
      message: `${caller.email} has not been given access to Tally. Ask an admin to add you, then sign in again.`,
    };
  }

  const invitation = inviteSnapshot.data() ?? {};
  if (invitation.active === false) {
    return {
      status: 'inactive',
      role: null,
      message: 'Your invitation to Tally has been paused. Ask an admin to turn it back on.',
    };
  }

  const role = readRole(invitation.role) ?? 'counselor';
  await writeProfile(userRef, caller, email, role, existing, now);
  return { status: 'granted', role, message: 'Welcome to Tally.' };
}

/**
 * Writes the authorisation document.
 *
 * `createdAt` is preserved so "member since" does not reset every time somebody
 * signs in, and `assignedGroupId` is left alone because it is the counselor's
 * own choice of small group, not something a sign-in has an opinion about.
 */
async function writeProfile(
  userRef: { set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<unknown> },
  caller: VerifiedCaller,
  email: string,
  role: Role,
  existing: Record<string, unknown>,
  now: Date,
): Promise<void> {
  await userRef.set(
    {
      email,
      displayName: caller.displayName ?? existing.displayName ?? null,
      role,
      active: true,
      createdAt: existing.createdAt ?? Timestamp.fromDate(now),
      lastSeenAt: Timestamp.fromDate(now),
    },
    { merge: true },
  );
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
    if (!isGoogleSignIn(token)) {
      throw new HttpsError('failed-precondition', 'Tally only accepts Google sign-in.');
    }

    const displayName = typeof token.name === 'string' && token.name.trim() ? token.name.trim() : null;

    return provisionAccessForCaller(
      asFirestoreLike(getFirestore()),
      { uid: request.auth.uid, email: token.email as string, displayName },
      new Date(),
      seededAdminEmails(),
    );
  },
);
