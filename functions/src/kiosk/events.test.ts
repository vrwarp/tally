/**
 * Which gatherings a lobby screen is offered.
 *
 * The interesting claim is the one that used to be false: a gathering that has
 * *finished* but whose check-in window has not must stay on the list. Without
 * it, a kiosk that reboots or unbinds during pickup cannot get back to the
 * gathering it was collecting for — it sits at an empty chooser while a queue
 * forms in the lobby, which is precisely when it is needed most.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { listKioskEvents } from './events.js';

const NOW = new Date('2026-08-09T11:00:00Z');
const logger = { info: () => {}, warn: () => {}, error: () => {} };

function at(iso: string): Date {
  return new Date(iso);
}

/** A one-off, so nothing is projected and the list is exactly what is seeded. */
function seedEvent(
  db: FakeFirestore,
  id: string,
  times: { start: string; end: string; closes: string },
  extra: Record<string, unknown> = {},
): void {
  db.seed(`events/${id}`, {
    title: id,
    mode: 'oneoff',
    seriesId: null,
    recurrence: null,
    recurrenceRootId: null,
    status: 'scheduled',
    startAt: at(times.start),
    endAt: at(times.end),
    checkInOpensAt: at(times.start),
    checkInClosesAt: at(times.closes),
    location: null,
    notes: null,
    ...extra,
  });
}

async function titles(db: FakeFirestore): Promise<string[]> {
  const entries = await listKioskEvents(db, NOW, logger);
  return entries.map((entry) => entry.title);
}

describe('listKioskEvents', () => {
  it('offers a gathering that is still running', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'running', {
      start: '2026-08-09T10:00:00Z',
      end: '2026-08-09T12:00:00Z',
      closes: '2026-08-09T13:00:00Z',
    });
    expect(await titles(db)).toEqual(['running']);
  });

  it('keeps one that has ended while its check-in window is still open', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'pickup-time', {
      start: '2026-08-09T09:00:00Z',
      end: '2026-08-09T10:30:00Z',
      // Half an hour of pickup left.
      closes: '2026-08-09T11:30:00Z',
    });
    expect(await titles(db)).toEqual(['pickup-time']);
  });

  it('drops one whose window has closed too', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'over', {
      start: '2026-08-09T08:00:00Z',
      end: '2026-08-09T09:30:00Z',
      closes: '2026-08-09T10:30:00Z',
    });
    expect(await titles(db)).toEqual([]);
  });

  it('runs to the event end when the doors closed early', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'doors-closed-early', {
      start: '2026-08-09T09:00:00Z',
      end: '2026-08-09T12:00:00Z',
      // The window shut an hour ago; the gathering has not.
      closes: '2026-08-09T10:00:00Z',
    });
    expect(await titles(db)).toEqual(['doors-closed-early']);
  });

  it('never offers a cancelled night to a shelf in a lobby', async () => {
    const db = new FakeFirestore();
    seedEvent(
      db,
      'called-off',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { status: 'cancelled' },
    );
    expect(await titles(db)).toEqual([]);
  });

  it('carries requiresCheckOut through, because nothing else tells the kiosk', async () => {
    const db = new FakeFirestore();
    seedEvent(
      db,
      'nursery',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { requiresCheckOut: true },
    );
    const entries = await listKioskEvents(db, NOW, logger);
    expect(entries[0]?.requiresCheckOut).toBe(true);
  });

  it('reads a gathering with no flag as not tracking check-out', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'friday', {
      start: '2026-08-09T10:00:00Z',
      end: '2026-08-09T12:00:00Z',
      closes: '2026-08-09T13:00:00Z',
    });
    const entries = await listKioskEvents(db, NOW, logger);
    expect(entries[0]?.requiresCheckOut).toBe(false);
  });
});
