/**
 * The pulse's claims: a bump is observable, cheap to skip under a storm, and
 * incapable of failing the write path that carries it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FirestoreLike } from '../firestore.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { bumpPulse, PULSE_DEBOUNCE_MS, PULSE_DOC } from './pulse.js';

const NOW = new Date('2026-08-07T19:00:00Z');

function later(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

function channel(db: FakeFirestore, name: string): Record<string, unknown> {
  return (db.get(PULSE_DOC)?.[name] ?? {}) as Record<string, unknown>;
}

describe('bumpPulse', () => {
  it('creates the document on the first bump', async () => {
    const db = new FakeFirestore();
    await bumpPulse(db, ['roster'], NOW);

    expect(db.get(PULSE_DOC)).toMatchObject({ version: 1 });
    expect(channel(db, 'roster').rev).toBe(NOW.getTime());
    expect(channel(db, 'roster').at).toBeDefined();
  });

  it('moves the revision on every bump, and only ever forward', async () => {
    const db = new FakeFirestore();
    await bumpPulse(db, ['roster'], NOW);
    const first = channel(db, 'roster').rev as number;

    await bumpPulse(db, ['roster'], later(1));
    const second = channel(db, 'roster').rev as number;

    // Same millisecond twice: the max(prev + 1, …) arm keeps it moving.
    await bumpPulse(db, ['roster'], later(1));
    const third = channel(db, 'roster').rev as number;

    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it('leaves channels it was not asked about untouched', async () => {
    const db = new FakeFirestore();
    await bumpPulse(db, ['phones'], NOW);
    const phones = channel(db, 'phones').rev;

    await bumpPulse(db, ['roster'], later(5_000));

    expect(channel(db, 'phones').rev).toBe(phones);
    expect(channel(db, 'roster').rev).toBeDefined();
  });

  it('bumps several channels in one write', async () => {
    const db = new FakeFirestore();
    await bumpPulse(db, ['roster', 'phones'], NOW);

    expect(db.writes).toHaveLength(1);
    expect(channel(db, 'roster').rev).toBeDefined();
    expect(channel(db, 'phones').rev).toBeDefined();
  });

  it('leaves a retired channel exactly as the old writer left it', async () => {
    // A live document can still carry `registration`, written for the retired
    // QR flow. Bumps merge whole channel objects and never delete keys, so
    // the stale entry stays byte-for-byte — which is what keeps
    // pre-retirement kiosk bundles parsing this document.
    const db = new FakeFirestore();
    db.seed(PULSE_DOC, {
      version: 1,
      registration: { rev: 7, eventId: 'friday-today' },
    });

    await bumpPulse(db, ['roster'], NOW);
    const held = db.get(PULSE_DOC)! as Record<string, Record<string, unknown>>;
    expect(held.registration).toEqual({ rev: 7, eventId: 'friday-today' });
  });

  describe('the debounce', () => {
    it('skips a bump inside the window', async () => {
      const db = new FakeFirestore();
      await bumpPulse(db, ['roster'], NOW, { debounceMs: PULSE_DEBOUNCE_MS });
      const rev = channel(db, 'roster').rev;

      await bumpPulse(db, ['roster'], later(PULSE_DEBOUNCE_MS - 1), {
        debounceMs: PULSE_DEBOUNCE_MS,
      });

      expect(db.writes).toHaveLength(1);
      expect(channel(db, 'roster').rev).toBe(rev);
    });

    it('writes again once the window has passed', async () => {
      const db = new FakeFirestore();
      await bumpPulse(db, ['roster'], NOW, { debounceMs: PULSE_DEBOUNCE_MS });
      await bumpPulse(db, ['roster'], later(PULSE_DEBOUNCE_MS + 1), {
        debounceMs: PULSE_DEBOUNCE_MS,
      });

      expect(db.writes).toHaveLength(2);
    });

    it('is judged per requested channel set — a fresh roster does not mute phones', async () => {
      const db = new FakeFirestore();
      await bumpPulse(db, ['roster'], NOW, { debounceMs: PULSE_DEBOUNCE_MS });
      await bumpPulse(db, ['phones'], later(1_000), { debounceMs: PULSE_DEBOUNCE_MS });

      expect(channel(db, 'phones').rev).toBeDefined();
    });

    it('does not apply when no debounce is asked for', async () => {
      // A registering family is exactly the event the pulse exists for; their
      // bump must never be swallowed because another landed moments earlier.
      const db = new FakeFirestore();
      await bumpPulse(db, ['roster'], NOW);
      await bumpPulse(db, ['roster'], later(10));

      expect(db.writes).toHaveLength(2);
    });
  });

  it('never throws, and says why it could not write', async () => {
    const warn = vi.fn();
    const broken = {
      doc: () => {
        throw new Error('database is on fire');
      },
    } as unknown as FirestoreLike;

    await expect(
      bumpPulse(broken, ['roster'], NOW, { logger: { info: vi.fn(), warn, error: vi.fn() } }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      'Could not bump the kiosk pulse',
      expect.objectContaining({ channels: ['roster'] }),
    );
  });
});
