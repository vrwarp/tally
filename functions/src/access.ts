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
 *      with what starting role. Read on first sign-in and never again. Keyed by
 *      the canonical address — one id for every spelling of a Gmail mailbox,
 *      see `canonicalEmail` — with a fallback to the exact key invitations were
 *      written under before that rule, which is moved on the way past.
 *
 * Anything else is "not on the roster", which is reported as a refusal rather
 * than an error: a volunteer who has not been added yet is a normal thing to
 * be, not a failure.
 *
 * Every address comparison here goes through the canonical form, the seeded
 * list included: `jo.smith@gmail.com` in the deployment's variable is the
 * mailbox that signs in as `josmith@gmail.com`, and a plain lowercase compare
 * anywhere in this file would re-open the exact bug the canonical key closes.
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
import { emailKey, sameAccount, type Role } from './pco/mapping.js';
import { asFirestoreLike, PATHS, type FirestoreLike } from './firestore.js';
import {
  asToken,
  placeOnGatherings,
  readLink,
  recordRedemption,
  resolveChainNames,
  type GatheringName,
  type InvitationRecord,
  type Placement,
} from './invitations.js';
import type { ServerCode } from './generated/serverCodes.js';

/** Mirrors `ProvisionAccessResult` in src/services/functions.ts. */
export interface ProvisionAccessResult {
  status: 'granted' | 'not-on-roster' | 'inactive';
  role: Role | null;
  message: string;
  /**
   * The gatherings the invitation asked for, and what became of them. Both
   * absent on a sign-in that redeemed no invitation, which is every sign-in
   * after the first.
   *
   * Named rather than keyed because the only reader is a sentence on a grant
   * screen — "You've been put on Sunday School" — and that screen renders
   * before any of the app's data is subscribed. A one-off carries its date,
   * because "the retreat" and "the retreat on the 12th" are different grants
   * and the difference is invisible to the person who was given one.
   */
  placed?: GatheringName[];
  skipped?: GatheringName[];
}

/** What an invitation asked for, carried out at the one moment it can be. */
async function carryOutInvitation(
  db: FirestoreLike,
  invitation: { id: string; data: InvitationRecord },
  caller: VerifiedCaller,
  email: string,
  now: Date,
): Promise<{ placed: GatheringName[]; skipped: GatheringName[] }> {
  const gatherings = Array.isArray(invitation.data.gatherings)
    ? invitation.data.gatherings.filter((key): key is string => typeof key === 'string')
    : [];
  const invitedBy = typeof invitation.data.invitedBy === 'string' ? invitation.data.invitedBy : '';

  const placement: Placement =
    gatherings.length > 0 && invitedBy
      ? await placeOnGatherings(db, { uid: caller.uid, invitedBy, gatherings, now })
      : { placed: [], skipped: gatherings };

  await recordRedemption(db, {
    id: invitation.id,
    uid: caller.uid,
    email,
    name: caller.displayName,
    placement,
    now,
  });

  const names = await resolveChainNames(db, gatherings);
  const named = (key: string): GatheringName => names[key] ?? { title: key, oneOffAt: null };
  return {
    placed: placement.placed.map(named),
    skipped: placement.skipped.map(named),
  };
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
  // Canonical on both sides, so a pinned Gmail address matches however the
  // variable spelled it — dots, a `+tag`, `googlemail.com` — not only when the
  // deployer typed it the way Google's token happens to carry it.
  const seeded = seededAdmins.some((admin) => sameAccount(admin, email));

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
    await writeProfile(userRef, caller, email, 'admin', existing, now, 'deployment');
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

  const invitation = await findInvitation(db, email);
  if (!invitation) {
    return {
      status: 'not-on-roster',
      role: null,
      message: `${caller.email} has not been given access to Tally. Ask an admin to add you, then sign in again.`,
    };
  }

  /*
   * The role, and nothing else.
   *
   * An invitation used to carry an `active` flag an admin could switch off from
   * the Team screen, and this is where it was honoured. It is gone: the flag
   * only ever governed a *first* sign-in — the branch above returns before this
   * one for anybody with a profile — so on the screen it was a switch reading
   * "may sign in" that did nothing for most of the rows it appeared on. An
   * address that should not arrive is withdrawn; somebody already here is
   * deactivated on their profile.
   *
   * Documents written before that removal may still carry the field, and it is
   * deliberately not read: treating a stale `active: false` as a refusal would
   * turn a flag nobody can see any more into a locked door nobody can explain.
   */
  const role = readRole(invitation.data.role) ?? 'counselor';
  await writeProfile(
    userRef,
    caller,
    email,
    role,
    existing,
    now,
    typeof invitation.data.invitedBy === 'string' ? invitation.data.invitedBy : null,
  );
  const outcome = await carryOutInvitation(db, invitation, caller, email, now);
  return { status: 'granted', role, message: 'Welcome to Tally.', ...outcome };
}

/**
 * The other door: a link, redeemed.
 *
 * Everything above decides by *address*, which is the case where the inviter
 * knew which account the person would use. This one decides by the token in
 * the URL, which is the case where nobody knew — and it is why the link exists
 * at all. See `functions/src/invitations.ts` for what the token is and why the
 * document is keyed by its hash.
 *
 * A link is spent here and nowhere else. The screen names the account *before*
 * calling this — a phone's default Google account is not always the one its
 * owner meant, and a link that silently granted the wrong identity would turn
 * a refusal the person fixes in ten seconds into a grant only an admin can
 * undo. So by the time this runs, somebody has read their own address on the
 * glass and pressed **Join**.
 */
export async function redeemLinkForCaller(
  db: FirestoreLike,
  caller: VerifiedCaller,
  rawToken: unknown,
  now: Date,
  seededAdmins: readonly string[],
): Promise<ProvisionAccessResult & { linkStatus: 'ok' | 'expired' | 'spent' | 'not-found' }> {
  const token = asToken(rawToken);
  if (!token) {
    return { status: 'not-on-roster', role: null, message: 'That link is not valid.', linkStatus: 'not-found' };
  }

  const lookup = await readLink(db, token, now);
  if (lookup.status !== 'ok' || !lookup.record) {
    return {
      status: 'not-on-roster',
      role: null,
      message:
        lookup.status === 'spent'
          ? 'That invitation has already been used.'
          : 'That invitation link has expired.',
      linkStatus: lookup.status,
    };
  }

  const email = caller.email.trim().toLowerCase();
  const userRef = db.doc(`${PATHS.users}/${caller.uid}`);
  const existingSnapshot = await userRef.get();
  const existing = existingSnapshot.exists ? (existingSnapshot.data() ?? {}) : {};

  /*
   * Somebody already on the team may redeem a link, and it is not a mistake:
   * "Miriam sent me a link for Sunday School" is a counselor being put on a
   * gathering, which is exactly what the invitation carries. Their role is
   * left alone — a link grants counselor, and demoting an admin who followed
   * one would be the link deciding something it has no business deciding.
   */
  const seeded = seededAdmins.some((admin) => sameAccount(admin, email));
  const existingRole = readRole(existing.role);
  if (existingSnapshot.exists && existing.active !== true && !seeded) {
    return {
      status: 'inactive',
      role: null,
      message: 'Your access to Tally has been paused. Ask an admin to turn it back on.',
      linkStatus: 'ok',
    };
  }

  const role: Role = seeded ? 'admin' : (existingRole ?? 'counselor');
  await writeProfile(
    userRef,
    caller,
    email,
    role,
    existing,
    now,
    seeded ? 'deployment' : (lookup.record.invitedBy ?? null),
  );
  const outcome = await carryOutInvitation(
    db,
    { id: lookup.id, data: lookup.record },
    caller,
    email,
    now,
  );

  return {
    status: 'granted',
    role,
    message: existingSnapshot.exists ? 'Welcome back to Tally.' : 'Welcome to Tally.',
    linkStatus: 'ok',
    ...outcome,
  };
}

/**
 * The invitation id as it was spelled before the canonical form: lowercased,
 * trimmed, dots to commas, and nothing else. Every invitation written before
 * dots and `+tags` stopped counting on Gmail is keyed by this.
 */
function legacyEmailKey(email: string): string {
  return email.trim().toLowerCase().replace(/\./g, ',');
}

/**
 * The invitation for an address, under whichever key it was written.
 *
 * The canonical key first. When nothing is there, the exact key the app used
 * before the Gmail rule — and, on a hit, the document is *moved* to the
 * canonical key rather than read where it lies: the same data under the new
 * id, the old id deleted, in one batch. Moving rather than copying is what
 * keeps the pending list from ever showing one mailbox as two rows, and what
 * makes the next sign-in find it on the first read.
 *
 * For an address whose two keys are the same — every non-Gmail address, and a
 * Gmail one with no dots or tag — the second read is skipped rather than made
 * and ignored.
 */
async function findInvitation(
  db: FirestoreLike,
  email: string,
): Promise<{ id: string; data: InvitationRecord } | null> {
  const canonicalRef = db.doc(`${PATHS.invitations}/${emailKey(email)}`);
  const canonical = await canonicalRef.get();
  if (canonical.exists) return { id: canonicalRef.id, data: (canonical.data() ?? {}) as InvitationRecord };

  const legacyKey = legacyEmailKey(email);
  if (legacyKey === canonicalRef.id) return null;

  const legacyRef = db.doc(`${PATHS.invitations}/${legacyKey}`);
  const legacy = await legacyRef.get();
  if (!legacy.exists) return null;

  const data = legacy.data() ?? {};
  const batch = db.batch();
  batch.set(canonicalRef, data);
  batch.delete(legacyRef);
  await batch.commit();
  return { id: canonicalRef.id, data: data as InvitationRecord };
}

/**
 * Writes the authorisation document.
 *
 * `createdAt` is preserved so "member since" does not reset every time somebody
 * signs in. The write merges, so any field a sign-in has no opinion about is
 * left as it was.
 */
async function writeProfile(
  userRef: { set: (data: Record<string, unknown>, options?: { merge?: boolean }) => Promise<unknown> },
  caller: VerifiedCaller,
  email: string,
  role: Role,
  existing: Record<string, unknown>,
  now: Date,
  /**
   * Who let them in, on the sign-in that first admitted them: the inviter's
   * uid, or the literal `'deployment'` for an address pinned in
   * `TALLY_ADMIN_EMAILS`, whom nobody invited because nobody could have.
   *
   * Stamped once and never again — `existing.invitedBy` wins — because it is a
   * fact about a moment, and re-deciding it on every sign-in would let a
   * withdrawn invitation quietly rewrite how somebody arrived. Absent for
   * everybody who already had a profile when this arrived; the person page
   * says "Not recorded" rather than guessing.
   */
  invitedBy?: string | null,
): Promise<void> {
  await userRef.set(
    {
      email,
      displayName: caller.displayName ?? existing.displayName ?? null,
      role,
      active: true,
      createdAt: existing.createdAt ?? Timestamp.fromDate(now),
      lastSeenAt: Timestamp.fromDate(now),
      ...(existing.invitedBy == null && invitedBy != null ? { invitedBy } : {}),
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
      throw new HttpsError('unauthenticated', 'Sign in before requesting access.', {
        code: 'auth.signInToRequest' satisfies ServerCode,
      });
    }

    const token = request.auth.token;
    if (!isGoogleSignIn(token)) {
      throw new HttpsError('failed-precondition', 'Tally only accepts Google sign-in.', {
        code: 'auth.googleOnly' satisfies ServerCode,
      });
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
