/**
 * The short-lived code behind the kiosk's QR.
 *
 * A family with a phone in their hand would rather type on it than on a tablet
 * bolted to a shelf — their own keyboard, their own autocorrect, and the queue
 * behind them does not have to watch. So the kiosk offers a QR code, and the
 * page it points at is the only unauthenticated *write* surface Tally has.
 *
 * That is exactly why the link is not a link anybody can keep. A stable public
 * registration URL is a form on the open internet whose submissions land in a
 * church's real people database — and it would sit in browser history, in a
 * screenshot, on whatever the QR was photographed onto. Instead the kiosk mints
 * a code with a short life and a submission cap, shows it, and re-mints it
 * while it is on screen. Registering remotely means being in the room.
 *
 * The guardrails are the pairing flow's, for the same reasons and in the same
 * shape: a TTL, a cap on how many codes may be live at once, and a sweep run
 * from the one call that is guaranteed to have somebody's attention. What is
 * deliberately *not* borrowed is the device secret — a pairing secret exists so
 * that seeing the code on a lobby screen is not enough to claim a staff
 * identity, whereas here seeing the code is the entire point, and what it buys
 * is the ability to do what a family standing at the kiosk could already do.
 */
import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { toDateOrNull, type FirestoreLike } from '../firestore.js';
import { CODE_ALPHABET, CODE_LENGTH, normalizeCode } from './pairing.js';

export const REGISTRATION_CODES_COLLECTION = 'kioskRegistrationCodes';

/**
 * How long a code lasts.
 *
 * Long enough to walk away from the kiosk, find the camera app, mistype a
 * child's name and start again; short enough that a photograph of the screen is
 * worth nothing by the end of the service. The kiosk re-mints every ten minutes
 * while the QR is showing, so a code scanned just before a rotation still has
 * ten-odd minutes of form-filling left on it.
 */
export const REGISTRATION_CODE_TTL_MS = 20 * 60_000;

/** Rotation cadence, for the screen — half the TTL, so codes always overlap. */
export const REGISTRATION_CODE_ROTATE_MS = 10 * 60_000;

/**
 * Registrations one code may carry before it stops answering.
 *
 * A code belongs to one kiosk for twenty minutes, and twenty families through
 * one QR in twenty minutes is not a busy lobby — it is somebody replaying the
 * form. The families keep registering; the next code is one tap away on the
 * screen they are standing at.
 */
export const MAX_CODE_SUBMISSIONS = 20;

/** Live codes allowed at once, across every kiosk. Same argument as pairing. */
export const MAX_LIVE_CODES = 10;

function randomCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

interface CodeRecord {
  expiresAt: Date | null;
  submissions: number;
  maxSubmissions: number;
}

function readCode(data: Record<string, unknown>): CodeRecord {
  return {
    expiresAt: toDateOrNull(data.expiresAt),
    submissions: typeof data.submissions === 'number' ? data.submissions : 0,
    maxSubmissions:
      typeof data.maxSubmissions === 'number' ? data.maxSubmissions : MAX_CODE_SUBMISSIONS,
  };
}

function isExpired(record: CodeRecord, now: Date): boolean {
  return record.expiresAt === null || record.expiresAt.getTime() <= now.getTime();
}

export interface MintCodeResult {
  code: string;
  expiresAt: number;
  rotateAfterMs: number;
}

/**
 * Opens a code for the kiosk to put in a QR, sweeping the dead ones on the way.
 *
 * Returns `'busy'` at the cap, which the callable turns into a
 * resource-exhausted refusal — the same shape `startPairing` uses, and the same
 * reason: an endpoint that mints things needs a ceiling that is not the
 * database's patience.
 */
export async function mintCode(
  db: FirestoreLike,
  uid: string,
  now: Date,
): Promise<MintCodeResult | 'busy'> {
  const snapshot = await db.collection(REGISTRATION_CODES_COLLECTION).get();

  let live = 0;
  for (const doc of snapshot.docs) {
    const record = readCode(doc.data() ?? {});
    if (isExpired(record, now)) {
      await db.doc(`${REGISTRATION_CODES_COLLECTION}/${doc.id}`).delete();
    } else {
      live += 1;
    }
  }
  if (live >= MAX_LIVE_CODES) return 'busy';

  const expiresAt = new Date(now.getTime() + REGISTRATION_CODE_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode();
    try {
      await db.doc(`${REGISTRATION_CODES_COLLECTION}/${code}`).create({
        createdAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(expiresAt),
        mintedBy: uid,
        submissions: 0,
        maxSubmissions: MAX_CODE_SUBMISSIONS,
      });
      return {
        code,
        expiresAt: expiresAt.getTime(),
        rotateAfterMs: REGISTRATION_CODE_ROTATE_MS,
      };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  return 'busy';
}

export type CodeStatus = 'ok' | 'not-found' | 'expired' | 'exhausted';

/**
 * Whether this code may still be registered against.
 *
 * `not-found` covers a code that never existed and one already swept, and does
 * not distinguish them: the page says "ask at the kiosk for a fresh one" either
 * way, and telling somebody probing codes which of their guesses were once real
 * helps only them.
 */
export async function checkCode(
  db: FirestoreLike,
  rawCode: string,
  now: Date,
): Promise<CodeStatus> {
  const code = normalizeCode(rawCode);
  if (code.length !== CODE_LENGTH) return 'not-found';

  const snapshot = await db.doc(`${REGISTRATION_CODES_COLLECTION}/${code}`).get();
  if (!snapshot.exists) return 'not-found';

  const record = readCode(snapshot.data() ?? {});
  if (isExpired(record, now)) return 'expired';
  if (record.submissions >= record.maxSubmissions) return 'exhausted';
  return 'ok';
}

/**
 * Spends one of a code's submissions.
 *
 * Called *after* the registration lands rather than before it: a call that
 * failed validation, or hit the already-on-the-roster guard, has cost the
 * church nothing and should not cost the family one of the twenty either.
 */
export async function consumeCode(db: FirestoreLike, rawCode: string): Promise<void> {
  const code = normalizeCode(rawCode);
  const ref = db.doc(`${REGISTRATION_CODES_COLLECTION}/${code}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) return;
  const record = readCode(snapshot.data() ?? {});
  await ref.set({ submissions: record.submissions + 1 }, { merge: true });
}
