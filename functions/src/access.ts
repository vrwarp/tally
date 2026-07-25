/**
 * `provisionAccess` — the door between "signed in to Firebase" and "allowed to
 * use Tally".
 *
 * A counselor who has just signed in has a uid and nothing else: security rules
 * forbid creating your own `users/{uid}` document, because that would let anyone
 * with a Google account grant themselves a role. This callable is the only code
 * that may create one, and it takes the role from Planning Center — never from
 * anything the caller sent.
 *
 * The lookup is live. Tally used to keep a mirrored `accessRoster` collection,
 * refreshed by a scheduled sweep, which meant a volunteer added in Planning
 * Center on Friday afternoon could not sign in until the next sweep, and a
 * volunteer removed could still sign in until then too. Asking at the moment
 * somebody knocks is both fresher and less to store: Tally now holds no list of
 * church staff email addresses at all.
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { loadConfig, PCO_SECRETS, type PcoConfig } from './config.js';
import { createPcoClient } from './pco/client.js';
import { type Role } from './pco/mapping.js';
import { findTeamMemberByEmail } from './pco/roster.js';
import { sharedCache } from './pco/sharedCache.js';
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

/**
 * Resolves an email address to a team-roster entry, or null when it is not on
 * the roster. Injected so the provisioning logic can be driven without a
 * Planning Center at all.
 */
export type TeamLookup = (email: string) => Promise<TeamEntry | null>;

export interface TeamEntry {
  displayName: string | null;
  role: Role;
  pcoPersonId: string;
  assignedGroupId: string | null;
  active: boolean;
}

/**
 * The real lookup: Planning Center, through the shared short-TTL cache.
 *
 * A failure here is deliberately *not* swallowed into "not on the roster". Those
 * two outcomes look identical to a volunteer standing at the door and mean
 * completely different things — one is "ask a leader to add you", the other is
 * "try again in a minute".
 */
export function planningCenterLookup(config: PcoConfig): TeamLookup {
  return async (email: string) => {
    if (config.configError) throw new HttpsError('failed-precondition', config.configError);

    const client = createPcoClient({
      appId: config.appId,
      secret: config.secret,
      baseUrl: config.baseUrl,
    });

    const entry = await findTeamMemberByEmail({
      client,
      config,
      cache: sharedCache(config),
      email,
    });
    if (!entry) return null;

    return {
      displayName: entry.displayName,
      role: entry.role,
      pcoPersonId: entry.pcoPersonId,
      assignedGroupId: entry.assignedGroupId,
      active: entry.active,
    };
  };
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
  lookup: TeamLookup,
): Promise<ProvisionAccessResult> {
  const roster = await lookup(caller.email);

  if (!roster) {
    return {
      status: 'not-on-roster',
      role: null,
      message: `${caller.email} is not on the Planning Center roster for Footprints. Ask a leader to add you in Planning Center, then try again.`,
    };
  }

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

  // An admin who promoted somebody inside Tally must not be demoted by what
  // Planning Center thinks they are, so an existing role always wins.
  const role = readRole(existing.role) ?? readRole(roster.role) ?? 'counselor';
  const assignedGroupId =
    (typeof existing.assignedGroupId === 'string' ? existing.assignedGroupId : null) ??
    roster.assignedGroupId;

  await userRef.set(
    {
      email: caller.email,
      displayName: caller.displayName ?? roster.displayName,
      role,
      assignedGroupId,
      active: true,
      // Preserved so "member since" does not reset every time they sign in.
      createdAt: existing.createdAt ?? Timestamp.fromDate(now),
      lastSeenAt: Timestamp.fromDate(now),
      pcoPersonId: roster.pcoPersonId,
    },
    { merge: true },
  );

  return { status: 'granted', role, message: 'Welcome to Tally.' };
}

/* -------------------------------------------------------------------------- */
/* Callable                                                                    */
/* -------------------------------------------------------------------------- */

export const provisionAccess = onCall<void, Promise<ProvisionAccessResult>>(
  { secrets: PCO_SECRETS, timeoutSeconds: 60, memory: '256MiB' },
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

    const config = loadConfig();

    try {
      return await provisionAccessForCaller(
        asFirestoreLike(getFirestore()),
        { uid: request.auth.uid, email: token.email as string, displayName },
        new Date(),
        planningCenterLookup(config),
      );
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      // "Planning Center is unreachable" must not read as "you are not allowed
      // in" — that sends a volunteer looking for the wrong person.
      throw new HttpsError(
        'unavailable',
        'Could not reach Planning Center to check the team roster. Try again in a moment.',
      );
    }
  },
);
