/**
 * The guardrails on the only unauthenticated write surface Tally has.
 *
 * A registration code is what makes "register on your own phone" mean "register
 * while standing in the room": it is minted by a paired kiosk, shown on that
 * kiosk's screen, and dies twenty minutes later whether or not anybody used it.
 * Every claim here is about what happens when somebody keeps one — a screenshot
 * of the QR, a photograph across the foyer, a script.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import {
  checkCode,
  consumeCode,
  mintCode,
  MAX_CODE_SUBMISSIONS,
  MAX_LIVE_CODES,
  REGISTRATION_CODES_COLLECTION,
  REGISTRATION_CODE_TTL_MS,
} from './registrationCodes.js';

const NOW = new Date('2026-08-07T19:05:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

async function mintOne(db: FakeFirestore, now = NOW): Promise<string> {
  const result = await mintCode(db, 'staff-uid', now);
  if (result === 'busy') throw new Error('unexpectedly busy');
  return result.code;
}

describe('minting', () => {
  it('gives the kiosk a code that reads off a screen without ambiguity', async () => {
    const db = new FakeFirestore();
    const code = await mintOne(db);

    // The pairing alphabet: no I/L/O/0/1, because somebody may be typing this
    // into a phone from across a foyer rather than scanning it.
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(db.get(`${REGISTRATION_CODES_COLLECTION}/${code}`)).toMatchObject({
      mintedBy: 'staff-uid',
      submissions: 0,
      maxSubmissions: MAX_CODE_SUBMISSIONS,
    });
  });

  it('sweeps the dead ones on the way past', async () => {
    const db = new FakeFirestore();
    const stale = await mintOne(db);

    await mintOne(db, later(REGISTRATION_CODE_TTL_MS + 1_000));
    expect(db.get(`${REGISTRATION_CODES_COLLECTION}/${stale}`)).toBeUndefined();
  });

  it('refuses past the live cap rather than minting forever', async () => {
    const db = new FakeFirestore();
    for (let i = 0; i < MAX_LIVE_CODES; i += 1) await mintOne(db);

    // The ceiling is the rate limit for an endpoint that mints things.
    expect(await mintCode(db, 'staff-uid', NOW)).toBe('busy');
  });
});

describe('checking', () => {
  it('accepts a live code, however it was typed', async () => {
    const db = new FakeFirestore();
    const code = await mintOne(db);

    expect(await checkCode(db, code, NOW)).toBe('ok');
    expect(await checkCode(db, ` ${code.toLowerCase()} `, NOW)).toBe('ok');
  });

  it('stops answering once the code is old', async () => {
    const db = new FakeFirestore();
    const code = await mintOne(db);

    expect(await checkCode(db, code, later(REGISTRATION_CODE_TTL_MS - 1_000))).toBe('ok');
    // A photograph of the lobby screen is worth nothing by the end of the
    // service, which is the entire reason this is not a stable link.
    expect(await checkCode(db, code, later(REGISTRATION_CODE_TTL_MS + 1))).toBe('expired');
  });

  it('stops answering once it has carried its share of families', async () => {
    const db = new FakeFirestore();
    const code = await mintOne(db);

    for (let i = 0; i < MAX_CODE_SUBMISSIONS; i += 1) await consumeCode(db, code);
    expect(await checkCode(db, code, NOW)).toBe('exhausted');
  });

  it('says nothing useful to somebody guessing', async () => {
    const db = new FakeFirestore();
    // A code that never existed and one already swept answer alike: telling a
    // prober which of their guesses were once real helps only them.
    expect(await checkCode(db, 'ZZZZZZ', NOW)).toBe('not-found');
    expect(await checkCode(db, 'nope', NOW)).toBe('not-found');
  });
});

describe('spending', () => {
  it('counts a registration, and shrugs at a code that has gone', async () => {
    const db = new FakeFirestore();
    const code = await mintOne(db);

    await consumeCode(db, code);
    expect(db.get(`${REGISTRATION_CODES_COLLECTION}/${code}`)!.submissions).toBe(1);

    // Swept mid-flight is not an error worth failing a family's registration
    // over — by the time this runs, they are already on the roster.
    await expect(consumeCode(db, 'ZZZZZZ')).resolves.toBeUndefined();
  });
});
