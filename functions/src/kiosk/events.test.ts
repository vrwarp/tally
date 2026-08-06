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
import { DEFAULT_LABEL_TEMPLATE } from '../generated/labelTemplate.js';
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

  /*
   * The label template, on the same argument as `requiresCheckOut` and one step
   * further: the kiosk never reads an event document at all, so a template that
   * is not on this row is a template no lobby screen can print.
   *
   * Both branches are checked. `entryFromSource` builds the row for a gathering
   * that has a document, and the projection loop builds one *again*, inline, for
   * a Sunday the recurrence rule describes that nothing stands for yet — which
   * is the ordinary case for a weekly nursery, and the one a field added to only
   * the first branch would silently miss.
   */
  it('carries a label template through, because nothing else tells the kiosk', async () => {
    const db = new FakeFirestore();
    seedEvent(
      db,
      'nursery',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { labelTemplate: DEFAULT_LABEL_TEMPLATE },
    );
    const entries = await listKioskEvents(db, NOW, logger);
    expect(entries[0]?.labelTemplate).toEqual(DEFAULT_LABEL_TEMPLATE);
  });

  it('carries it onto an occurrence nothing stands for yet', async () => {
    const db = new FakeFirestore();
    // A weekly Sunday whose latest instance is last week: this week's is
    // projected, has no document, and is what the kiosk will bind to.
    db.seed('events/sunday-nursery', {
      title: 'Sunday Nursery',
      mode: 'recurring',
      seriesId: 'sunday-nursery',
      recurrence: {
        frequency: 'weekly',
        interval: 1,
        weekdays: [0],
        monthlyMode: 'dayOfMonth',
        until: null,
        count: null,
      },
      recurrenceRootId: null,
      status: 'scheduled',
      startAt: at('2026-08-02T10:00:00Z'),
      endAt: at('2026-08-02T12:00:00Z'),
      checkInOpensAt: at('2026-08-02T10:00:00Z'),
      checkInClosesAt: at('2026-08-02T13:00:00Z'),
      location: null,
      notes: null,
      requiresCheckOut: true,
      labelTemplate: DEFAULT_LABEL_TEMPLATE,
    });

    const entries = await listKioskEvents(db, NOW, logger);
    const projected = entries.filter((entry) => entry.id === null);

    expect(projected.length).toBeGreaterThan(0);
    for (const entry of projected) {
      expect(entry.labelTemplate).toEqual(DEFAULT_LABEL_TEMPLATE);
      expect(entry.requiresCheckOut).toBe(true);
    }
  });

  it('reads a gathering with no template as printing nothing', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'friday', {
      start: '2026-08-09T10:00:00Z',
      end: '2026-08-09T12:00:00Z',
      closes: '2026-08-09T13:00:00Z',
    });
    const entries = await listKioskEvents(db, NOW, logger);
    expect(entries[0]?.labelTemplate).toBeNull();
  });

  it('reads a malformed template as printing nothing rather than failing', async () => {
    // A kiosk that throws on a bad template is a kiosk somebody has to drive
    // out and reboot. The whole row must survive.
    const db = new FakeFirestore();
    seedEvent(
      db,
      'friday',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { labelTemplate: { lines: 'the name', copies: 'lots' } },
    );
    const entries = await listKioskEvents(db, NOW, logger);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.labelTemplate).toBeNull();
  });
});

/**
 * Which chain the kiosk scopes its search to, which is not the same question as
 * which chain the occurrence belongs to.
 *
 * `chain` is identity — what `materializeOccurrence` takes. `predictsFrom` is
 * evidence: whose past instances say who comes to this. They differ exactly
 * where `predictionChain` differs from `chainKey`, and the kiosk has to agree
 * with the check-in screen about the same evening.
 */
describe('predictsFrom', () => {
  const times = {
    start: '2026-08-09T12:00:00Z',
    end: '2026-08-09T14:00:00Z',
    closes: '2026-08-09T15:00:00Z',
  };

  async function only(db: FakeFirestore) {
    const entries = await listKioskEvents(db, NOW, logger);
    return entries[0]!;
  }

  it('is a recurring gathering’s own chain', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'friday', times, { mode: 'recurring', seriesId: 'friday-fellowship' });
    const entry = await only(db);
    expect(entry.chain).toBe('friday-fellowship');
    expect(entry.predictsFrom).toBe('friday-fellowship');
  });

  it('follows a recurrence root when there is no series document', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'sat-3', times, { mode: 'recurring', recurrenceRootId: 'sat' });
    expect(await only(db)).toMatchObject({ chain: 'sat', predictsFrom: 'sat' });
  });

  it('is null for a one-off pointed at nothing', async () => {
    const db = new FakeFirestore();
    // A nursery under a series id is still a one-off: it is not the latest
    // instance of anything, so nothing predicts for it — and the kiosk searches
    // the whole roster, exactly as the check-in screen shows all of it.
    seedEvent(db, 'nursery', times, { seriesId: 'sunday-school' });
    expect(await only(db)).toMatchObject({ chain: 'sunday-school', predictsFrom: null });
  });

  it('is the chain a leader pointed a one-off at', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'retreat', times, { predictFromChain: 'friday-fellowship' });
    // Identity is still its own; the evidence is borrowed.
    expect(await only(db)).toMatchObject({
      chain: 'retreat',
      predictsFrom: 'friday-fellowship',
    });
  });

  it('ignores an empty predictFromChain rather than scoping to nothing', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'retreat', times, { predictFromChain: '' });
    expect(await only(db)).toMatchObject({ predictsFrom: null });
  });
});
