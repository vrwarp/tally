/**
 * The print server's claims: the token never lands anywhere a client can read,
 * a save moves the pulse, a blank token keeps the one already saved, and a
 * kiosk reads null for anything less than a whole configuration. The address
 * normalisation itself is `src/lib/printServerAddress.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { PATHS } from '../firestore.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import {
  PrintServerInputError,
  parsePrintServerInput,
  readPrintServerForKiosk,
  savePrintServer,
} from './printServer.js';
import { PULSE_DOC } from './pulse.js';

const NOW = new Date('2026-11-01T17:00:00Z');
const INPUT = { url: 'https://print.church.example', token: 'bql_abcdef0123456789' };

function problemOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof PrintServerInputError ? error.problem : `unexpected: ${String(error)}`;
  }
}

describe('parsing what the card sent', () => {
  it('reads null as "clear"', () => {
    expect(parsePrintServerInput(null)).toBeNull();
    expect(parsePrintServerInput(undefined)).toBeNull();
  });

  it('trims and keeps a well-formed pair', () => {
    expect(parsePrintServerInput({ url: INPUT.url, token: `  ${INPUT.token}\n` })).toEqual({
      url: 'wss://print.church.example/ws',
      token: INPUT.token,
    });
  });

  it('reads a missing or blank token as "keep the saved one"', () => {
    expect(parsePrintServerInput({ url: INPUT.url })?.token).toBeNull();
    expect(parsePrintServerInput({ url: INPUT.url, token: '   ' })?.token).toBeNull();
  });

  it('refuses a token padded inside, or a paragraph', () => {
    expect(problemOf(() => parsePrintServerInput({ url: INPUT.url, token: 'bql_ab cd' }))).toBe('badToken');
    expect(problemOf(() => parsePrintServerInput({ url: INPUT.url, token: 'x'.repeat(201) }))).toBe('badToken');
  });

  it('refuses a bad address, whatever the token', () => {
    expect(problemOf(() => parsePrintServerInput({ url: 'nope', token: INPUT.token }))).toBe('badAddress');
    expect(problemOf(() => parsePrintServerInput({ url: 'https://u:p@x.example', token: INPUT.token }))).toBe('badAddress');
    expect(problemOf(() => parsePrintServerInput('https://print.church.example'))).toBe('badAddress');
  });
});

describe('saving', () => {
  it('keeps the token out of the document the core team can read', async () => {
    const db = new FakeFirestore();
    expect(await savePrintServer(db, parsePrintServerInput(INPUT), 'uid-core', NOW)).toBe('saved');

    const config = db.get(PATHS.printServerConfig)!;
    expect(config).toMatchObject({ url: 'wss://print.church.example/ws', rev: NOW.getTime(), updatedBy: 'uid-core' });
    expect(JSON.stringify(config)).not.toContain(INPUT.token);
    expect(db.get(PATHS.printServerSecret)).toMatchObject({ token: INPUT.token });
  });

  it('moves the pulse, so kiosks re-read', async () => {
    const db = new FakeFirestore();
    await savePrintServer(db, parsePrintServerInput(INPUT), 'uid-core', NOW);
    const first = (db.get(PULSE_DOC)?.printServer as { rev: number }).rev;

    await savePrintServer(db, parsePrintServerInput({ ...INPUT, token: 'bql_rotated' }), 'uid-core', new Date(NOW.getTime() + 1));
    const second = (db.get(PULSE_DOC)?.printServer as { rev: number }).rev;

    expect(first).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('keeps the saved token when the card sends none, and refuses when there is none to keep', async () => {
    const db = new FakeFirestore();
    await savePrintServer(db, parsePrintServerInput(INPUT), 'uid-core', NOW);

    const moved = { url: 'https://print2.church.example', token: '' };
    await savePrintServer(db, parsePrintServerInput(moved), 'uid-core', new Date(NOW.getTime() + 1));
    expect(await readPrintServerForKiosk(db)).toMatchObject({
      url: 'wss://print2.church.example/ws',
      token: INPUT.token,
    });

    const fresh = new FakeFirestore();
    await expect(
      savePrintServer(fresh, parsePrintServerInput(moved), 'uid-core', NOW),
    ).rejects.toMatchObject({ problem: 'badToken' });
    expect(fresh.get(PATHS.printServerConfig)).toBeUndefined();
  });

  it('clearing removes both documents and still moves the pulse', async () => {
    const db = new FakeFirestore();
    await savePrintServer(db, parsePrintServerInput(INPUT), 'uid-core', NOW);
    expect(await savePrintServer(db, null, 'uid-core', new Date(NOW.getTime() + 5))).toBe('cleared');

    expect(db.get(PATHS.printServerConfig)).toBeUndefined();
    expect(db.get(PATHS.printServerSecret)).toBeUndefined();
    expect(db.get(PULSE_DOC)?.printServer).toBeDefined();
  });
});

describe('what a kiosk reads', () => {
  it('is the whole pair, with the save as its revision', async () => {
    const db = new FakeFirestore();
    await savePrintServer(db, parsePrintServerInput(INPUT), 'uid-core', NOW);

    expect(await readPrintServerForKiosk(db)).toEqual({
      url: 'wss://print.church.example/ws',
      token: INPUT.token,
      rev: NOW.getTime(),
    });
  });

  it('is null on a fresh install, after a clear, and for half a pair', async () => {
    const db = new FakeFirestore();
    expect(await readPrintServerForKiosk(db)).toBeNull();

    await savePrintServer(db, parsePrintServerInput(INPUT), 'uid-core', NOW);
    await savePrintServer(db, null, 'uid-core', NOW);
    expect(await readPrintServerForKiosk(db)).toBeNull();

    db.seed(PATHS.printServerConfig, { url: 'wss://print.church.example/ws', rev: 1 });
    expect(await readPrintServerForKiosk(db)).toBeNull();
  });

  it('reads a revision that is not a number as zero', async () => {
    const db = new FakeFirestore();
    db.seed(PATHS.printServerConfig, { url: 'wss://print.church.example/ws', rev: 'seven' });
    db.seed(PATHS.printServerSecret, { token: INPUT.token });

    expect((await readPrintServerForKiosk(db))?.rev).toBe(0);
  });
});
