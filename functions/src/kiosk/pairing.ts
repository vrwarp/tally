/**
 * Pairing a kiosk with a staff member's identity.
 *
 * A kiosk is a browser on a shelf: nobody signs in to Google on it, and nothing
 * about the device itself is trusted. What makes its check-ins legitimate is a
 * staff member standing next to it saying "this screen is mine" — so pairing is
 * an approval performed from a session that is already signed in, and the kiosk
 * ends up holding a custom-token session for *that* staff member's uid (with a
 * `kiosk: true` claim so the rules can narrow what the shelf may do). Every
 * check-in the kiosk writes is attributed to the person who approved it, which
 * is the same attribution a tap on their own phone would carry.
 *
 * The handshake, in three unauthenticated-to-authenticated steps:
 *
 *   1. The kiosk calls `startKioskPairing` (no auth) and receives a short code
 *      to put on screen and a secret it keeps to itself.
 *   2. A staff member types the code into the main app, which calls
 *      `approveKioskPairing` under their real session.
 *   3. The kiosk, polling `claimKioskToken` with its code *and secret*, receives
 *      a custom token minted for the approver's uid and signs in with it.
 *
 * The secret is the half the shoulder-surfer never sees: the code is public by
 * design (it is on a screen in a lobby), so approval alone must not be enough
 * to collect the token — only the device that started the pairing holds the
 * secret, and only its hash is ever stored. Claiming is deliberately
 * *idempotent* while the pairing lives: a kiosk whose claim response is lost to
 * a wifi blip retries the same call, and refusing the retry would brick the
 * pairing at its very last step. Re-minting to the secret's holder is harmless;
 * the pairing document expires either way.
 *
 * Nothing here is written by a browser. The documents live under
 * `kioskPairings/{code}`, which the security rules deny to every client — these
 * callables and the Admin SDK are the only readers and writers.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type { FirestoreLike } from '../firestore.js';
import { toDateOrNull } from '../firestore.js';

export const PAIRING_COLLECTION = 'kioskPairings';

/**
 * No I/L/O/0/1 — the code is read off one screen and typed into another, and
 * those five are the characters people mistake for each other while doing it.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** How long a pairing may sit unapproved or unclaimed. */
export const PAIRING_TTL_MS = 10 * 60_000;

/**
 * The most unexpired pairings allowed to exist at once. The ministry owns a
 * handful of kiosks; twenty simultaneous pairings is not a busy night, it is
 * somebody's script hammering an unauthenticated endpoint.
 */
export const MAX_LIVE_PAIRINGS = 20;

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Codes arrive typed by hand; case and stray spaces are not the user's problem. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

interface PairingDocView {
  secretHash: string;
  status: 'pending' | 'approved';
  approvedBy: string | null;
  expiresAt: Date | null;
  claimedAt: Date | null;
}

function readPairing(data: Record<string, unknown>): PairingDocView {
  return {
    secretHash: typeof data.secretHash === 'string' ? data.secretHash : '',
    status: data.status === 'approved' ? 'approved' : 'pending',
    approvedBy: typeof data.approvedBy === 'string' ? data.approvedBy : null,
    expiresAt: toDateOrNull(data.expiresAt),
    claimedAt: toDateOrNull(data.claimedAt),
  };
}

function isExpired(pairing: PairingDocView, now: Date): boolean {
  return pairing.expiresAt === null || pairing.expiresAt.getTime() <= now.getTime();
}

export interface StartPairingResult {
  code: string;
  secret: string;
  expiresInSeconds: number;
}

/**
 * Opens a pairing and returns what the kiosk needs: the code for the screen and
 * the secret for its pocket.
 *
 * Every call also sweeps expired documents. This is the collection's only
 * garbage collector — cheap because the collection is bounded by
 * `MAX_LIVE_PAIRINGS`, and placed here because starting a pairing is the one
 * moment the collection is guaranteed to have somebody's attention.
 *
 * Returns `'busy'` when the live-pairing cap is reached, which the callable
 * turns into a resource-exhausted refusal. The cap is the rate limit for an
 * endpoint that anyone on the internet may call.
 */
export async function startPairing(
  db: FirestoreLike,
  now: Date,
): Promise<StartPairingResult | 'busy'> {
  const snapshot = await db.collection(PAIRING_COLLECTION).get();

  let live = 0;
  for (const doc of snapshot.docs) {
    const pairing = readPairing(doc.data() ?? {});
    if (isExpired(pairing, now)) {
      await db.doc(`${PAIRING_COLLECTION}/${doc.id}`).delete();
    } else {
      live += 1;
    }
  }
  if (live >= MAX_LIVE_PAIRINGS) return 'busy';

  const secret = randomBytes(16).toString('hex');
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);

  // `create()` is the collision check: the odds of two live pairings drawing
  // the same six characters are astronomical, but astronomical is not zero and
  // the retry costs one line.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      await db.doc(`${PAIRING_COLLECTION}/${code}`).create({
        secretHash: hashSecret(secret),
        status: 'pending',
        createdAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(expiresAt),
        approvedBy: null,
        approvedAt: null,
        claimedAt: null,
      });
      return { code, secret, expiresInSeconds: Math.floor(PAIRING_TTL_MS / 1000) };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  // Five collisions in a 30^6 space means the collection is full of something
  // other than honest pairings.
  return 'busy';
}

export type ApprovePairingStatus = 'approved' | 'not-found' | 'expired';

/**
 * A staff member vouching for the code on the shelf. `uid` is the session that
 * typed it — the identity the kiosk will inherit.
 *
 * Approving twice is fine and the second approver wins; the interesting
 * outcomes are the two refusals, which the screen shows as sentences.
 */
export async function approvePairing(
  db: FirestoreLike,
  rawCode: string,
  uid: string,
  now: Date,
): Promise<ApprovePairingStatus> {
  const code = normalizeCode(rawCode);
  if (code.length !== CODE_LENGTH) return 'not-found';

  const ref = db.doc(`${PAIRING_COLLECTION}/${code}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) return 'not-found';

  const pairing = readPairing(snapshot.data() ?? {});
  if (isExpired(pairing, now)) return 'expired';

  await ref.set(
    { status: 'approved', approvedBy: uid, approvedAt: Timestamp.fromDate(now) },
    { merge: true },
  );
  return 'approved';
}

export type ClaimPairingResult =
  | { status: 'pending' | 'not-found' | 'expired' }
  | { status: 'ready'; uid: string };

/**
 * The kiosk collecting its identity. Returns the uid to mint a token for —
 * minting itself stays in the callable, next to the Admin SDK.
 *
 * A wrong secret answers `not-found` rather than anything more specific:
 * distinguishing "no such code" from "right code, wrong secret" only helps
 * somebody probing codes they saw on a screen.
 */
export async function claimPairing(
  db: FirestoreLike,
  rawCode: string,
  secret: string,
  now: Date,
): Promise<ClaimPairingResult> {
  const code = normalizeCode(rawCode);
  if (code.length !== CODE_LENGTH) return { status: 'not-found' };

  const ref = db.doc(`${PAIRING_COLLECTION}/${code}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) return { status: 'not-found' };

  const pairing = readPairing(snapshot.data() ?? {});
  if (pairing.secretHash !== hashSecret(secret)) return { status: 'not-found' };
  if (isExpired(pairing, now)) return { status: 'expired' };
  if (pairing.status !== 'approved' || !pairing.approvedBy) return { status: 'pending' };

  // First successful claim is worth remembering; later ones are retries.
  if (pairing.claimedAt === null) {
    await ref.set({ claimedAt: Timestamp.fromDate(now) }, { merge: true });
  }
  return { status: 'ready', uid: pairing.approvedBy };
}
