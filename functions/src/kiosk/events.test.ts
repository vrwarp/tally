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

  /*
   * The row is where the colour maths happens, so it is where it has to be
   * checked. The kiosk is handed finished hex and does no colour work at all —
   * see the comment on `KioskEventEntry.palette`.
   */
  it('resolves a theme into finished hex on the way out', async () => {
    const db = new FakeFirestore();
    seedEvent(
      db,
      'nursery',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { kioskTheme: { ground: 'light', accent: 'ember', confirm: 'teal', backdrop: 'amber' } },
    );

    const entry = (await listKioskEvents(db, NOW, logger))[0];
    expect(entry?.ground).toBe('light');
    // Names went in; colours come out, and nothing that is not a colour.
    for (const [key, value] of Object.entries(entry?.palette ?? {})) {
      expect(key).toMatch(/^--color-(ink|brand|present)-\d+$/);
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(entry?.palette?.['--color-brand-400']).toBeDefined();
  });

  /*
   * The backdrop travels as its pointer and nothing else: the pixels live in
   * `kioskBackdrops/{id}` and the kiosk reads them once at bind — a chooser
   * that carried them would be megabytes answering a question about titles.
   */
  it('carries the backdrop id onto the row, and no key at all without one', async () => {
    const db = new FakeFirestore();
    seedEvent(
      db,
      'nursery',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { kioskBackdropId: 'b0123456789abcdef' },
    );
    seedEvent(db, 'youth', {
      start: '2026-08-09T18:00:00Z',
      end: '2026-08-09T20:00:00Z',
      closes: '2026-08-09T21:00:00Z',
    });

    const entries = await listKioskEvents(db, NOW, logger);
    const nursery = entries.find((entry) => entry.id === 'nursery');
    const youth = entries.find((entry) => entry.id === 'youth');
    expect(nursery?.backdropId).toBe('b0123456789abcdef');
    expect(youth && 'backdropId' in youth).toBe(false);
  });

  /* An id only vandalism could have written is dropped on the way out. */
  it('drops a malformed backdrop id rather than handing it to a shelf', async () => {
    const db = new FakeFirestore();
    seedEvent(
      db,
      'nursery',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { kioskBackdropId: 'kioskBackdrops/../users' },
    );
    const entry = (await listKioskEvents(db, NOW, logger))[0];
    expect(entry && 'backdropId' in entry).toBe(false);
  });

  /*
   * The icon is looked up here for the same reason the palette is resolved
   * here: the catalogue is sixty kilobytes, the kiosk needs one glyph out of
   * it, and its first-paint budget is the tightest number in the repo.
   */
  it('resolves an icon name into path data on the way out', async () => {
    const db = new FakeFirestore();
    seedEvent(
      db,
      'campfire',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { icon: 'local_fire_department' },
    );

    const entry = (await listKioskEvents(db, NOW, logger))[0];
    // A name went in; a path comes out, on Material's own viewBox.
    expect(entry?.iconPath).toMatch(/^[Mm]/);
  });

  it('sends no icon for a name the catalogue no longer holds', async () => {
    // `findEventIcon`'s rule, carried onto the wire: a gathering whose icon was
    // dropped should look like one that never had an icon, not like one wearing
    // somebody else's.
    const db = new FakeFirestore();
    seedEvent(
      db,
      'retired',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { icon: 'no_such_glyph' },
    );

    const entry = (await listKioskEvents(db, NOW, logger))[0];
    expect(entry && 'iconPath' in entry).toBe(false);
  });

  it('says nothing at all about a gathering nobody themed', async () => {
    // Most gatherings, and the chooser can list a month of them: the ordinary
    // case has to cost this payload nothing.
    const db = new FakeFirestore();
    seedEvent(db, 'youth', {
      start: '2026-08-09T18:00:00Z',
      end: '2026-08-09T20:00:00Z',
      closes: '2026-08-09T21:00:00Z',
    });

    const entry = (await listKioskEvents(db, NOW, logger))[0];
    expect(entry && 'ground' in entry).toBe(false);
    expect(entry && 'palette' in entry).toBe(false);
    // And nothing about one nobody gave an icon, which is the same gathering.
    expect(entry && 'iconPath' in entry).toBe(false);
  });

  it('keeps the ground when a gathering moved only that', async () => {
    // A light nursery that liked Tally's own colours is themed, not unthemed:
    // there is no palette to send, and `data-theme` still has to move.
    const db = new FakeFirestore();
    seedEvent(
      db,
      'nursery',
      {
        start: '2026-08-09T10:00:00Z',
        end: '2026-08-09T12:00:00Z',
        closes: '2026-08-09T13:00:00Z',
      },
      { kioskTheme: { ground: 'light', accent: 'sky', confirm: 'forest', backdrop: 'indigo' } },
    );

    const entry = (await listKioskEvents(db, NOW, logger))[0];
    expect(entry?.ground).toBe('light');
    expect(entry?.palette).toBeUndefined();
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
      kioskTheme: { ground: 'light', accent: 'ember', confirm: 'teal', backdrop: 'amber' },
    });

    const entries = await listKioskEvents(db, NOW, logger);
    const projected = entries.filter((entry) => entry.id === null);

    expect(projected.length).toBeGreaterThan(0);
    for (const entry of projected) {
      expect(entry.labelTemplate).toEqual(DEFAULT_LABEL_TEMPLATE);
      expect(entry.requiresCheckOut).toBe(true);
      expect(entry.ground).toBe('light');
      expect(entry.palette?.['--color-brand-400']).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  /*
   * The write-back answer rides every row for the same reason the template
   * does: the binding is the only thing a kiosk keeps, so a capability that
   * misses a row — either branch — is a wizard that cannot know whether the
   * allergies question is safe to ask. Both branches asserted, like the
   * template above, and the default asserted false: a caller that says
   * nothing must produce a wizard that asks nothing.
   */
  it('stamps the write-back answer on every row, projected occurrences included', async () => {
    const db = new FakeFirestore();
    seedEvent(db, 'friday', {
      start: '2026-08-09T10:00:00Z',
      end: '2026-08-09T12:00:00Z',
      closes: '2026-08-09T13:00:00Z',
    });
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
    });

    const supported = await listKioskEvents(db, NOW, logger, { allergiesSupported: true });
    expect(supported.length).toBeGreaterThan(1);
    expect(supported.some((entry) => entry.id === null)).toBe(true);
    for (const entry of supported) expect(entry.allergiesSupported).toBe(true);

    const unstated = await listKioskEvents(db, NOW, logger);
    for (const entry of unstated) expect(entry.allergiesSupported).toBe(false);
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
