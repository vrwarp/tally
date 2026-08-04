/**
 * The pairing handshake's claims, driven against the in-memory Firestore.
 *
 * What matters here is the shape of the trust: the code is public, the secret
 * is what collects the token, expiry is enforced everywhere, and a lost claim
 * response can be retried without bricking the pairing.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import {
  approvePairing,
  claimPairing,
  startPairing,
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_LIVE_PAIRINGS,
  PAIRING_TTL_MS,
  type StartPairingResult,
} from './pairing.js';

const NOW = new Date('2026-08-07T18:00:00Z');
const LATER = new Date(NOW.getTime() + PAIRING_TTL_MS + 1);

async function started(db: FakeFirestore, now = NOW): Promise<StartPairingResult> {
  const result = await startPairing(db, now);
  if (result === 'busy') throw new Error('unexpected busy');
  return result;
}

describe('startPairing', () => {
  it('issues a code from the confusion-free alphabet and stores only a hash', async () => {
    const db = new FakeFirestore();
    const { code, secret } = await started(db);

    expect(code).toHaveLength(CODE_LENGTH);
    for (const char of code) expect(CODE_ALPHABET).toContain(char);

    const stored = db.get(`kioskPairings/${code}`)!;
    expect(stored.status).toBe('pending');
    expect(stored.secretHash).not.toContain(secret);
    expect(JSON.stringify(stored)).not.toContain(secret);
  });

  it('sweeps expired pairings and refuses past the live cap', async () => {
    const db = new FakeFirestore();
    const stale = await started(db);

    for (let i = 0; i < MAX_LIVE_PAIRINGS; i += 1) await started(db, LATER);
    // The stale one was swept by the first later call rather than counted.
    expect(db.get(`kioskPairings/${stale.code}`)).toBeUndefined();

    expect(await startPairing(db, LATER)).toBe('busy');
  });
});

describe('approvePairing', () => {
  it('records the approver and normalizes what they typed', async () => {
    const db = new FakeFirestore();
    const { code } = await started(db);

    expect(await approvePairing(db, ` ${code.toLowerCase()} `, 'staff-1', NOW)).toBe('approved');
    expect(db.get(`kioskPairings/${code}`)).toMatchObject({
      status: 'approved',
      approvedBy: 'staff-1',
    });
  });

  it('answers not-found and expired as statuses, not throws', async () => {
    const db = new FakeFirestore();
    const { code } = await started(db);

    expect(await approvePairing(db, 'AAAAAA', 'staff-1', NOW)).toBe('not-found');
    expect(await approvePairing(db, 'short', 'staff-1', NOW)).toBe('not-found');
    expect(await approvePairing(db, code, 'staff-1', LATER)).toBe('expired');
  });
});

describe('claimPairing', () => {
  it('is pending before approval, ready after, and repeatable — the lost-response retry', async () => {
    const db = new FakeFirestore();
    const { code, secret } = await started(db);

    expect(await claimPairing(db, code, secret, NOW)).toEqual({ status: 'pending' });

    await approvePairing(db, code, 'staff-1', NOW);
    expect(await claimPairing(db, code, secret, NOW)).toEqual({ status: 'ready', uid: 'staff-1' });
    // The kiosk's first claim response fell on the floor; the retry succeeds.
    expect(await claimPairing(db, code, secret, NOW)).toEqual({ status: 'ready', uid: 'staff-1' });
  });

  it('treats a wrong secret exactly like an unknown code', async () => {
    const db = new FakeFirestore();
    const { code } = await started(db);
    await approvePairing(db, code, 'staff-1', NOW);

    expect(await claimPairing(db, code, 'wrong-secret', NOW)).toEqual({ status: 'not-found' });
  });

  it('refuses an expired pairing even with the right secret', async () => {
    const db = new FakeFirestore();
    const { code, secret } = await started(db);
    await approvePairing(db, code, 'staff-1', NOW);

    expect(await claimPairing(db, code, secret, LATER)).toEqual({ status: 'expired' });
  });
});
