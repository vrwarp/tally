/**
 * How long a kiosk stays on one gathering.
 *
 * The binding used to die at `endAt`, which on a nursery Sunday is the moment
 * the parents arrive: the screen unbound itself exactly when pickup began. It
 * now lasts until the later of the event ending and the check-in window
 * closing, so both shapes of gathering are covered here — the ordinary one
 * whose window trails the event, and the "doors close at 09:45, service ends
 * at 10:45" one, which `max` must not shorten.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bindingEndsAt,
  bindingIsLive,
  clearBinding,
  eventWindow,
  opensAtLabel,
  readBinding,
  windowHasClosed,
  windowHasOpened,
  writeBinding,
  type KioskBinding,
} from '@/kiosk/binding';

/** Doors close before the gathering ends. The editor refuses to save this, but
 *  `firestore.rules` permits it, so a seed or a migration can produce one. */
const DOORS_CLOSE_EARLY: KioskBinding = {
  eventId: 'event-1',
  seriesId: 'friday',
  title: 'Friday Fellowship',
  startAtMs: 1000,
  endAtMs: 5000,
  checkInClosesAtMs: 3000,
  boundAtMs: 500,
};

/** The ordinary shape: the window trails the event by an hour. */
const WINDOW_TRAILS: KioskBinding = {
  ...DOORS_CLOSE_EARLY,
  eventId: 'event-2',
  endAtMs: 5000,
  checkInClosesAtMs: 9000,
};

describe('bindingIsLive', () => {
  it('outlives the event when the check-in window does — this is pickup', () => {
    // The old rule died here, with a queue of parents in the lobby.
    expect(bindingIsLive(WINDOW_TRAILS, 5000)).toBe(true);
    expect(bindingIsLive(WINDOW_TRAILS, 8999)).toBe(true);
    expect(bindingIsLive(WINDOW_TRAILS, 9000)).toBe(false);
  });

  it('still runs to the end of a gathering whose doors closed early', () => {
    expect(bindingIsLive(DOORS_CLOSE_EARLY, 2999)).toBe(true);
    // Window closed, event still running: the kiosk keeps working, exactly as
    // it always has. Taking `checkInClosesAt` alone would have cut this short.
    expect(bindingIsLive(DOORS_CLOSE_EARLY, 3001)).toBe(true);
    expect(bindingIsLive(DOORS_CLOSE_EARLY, 4999)).toBe(true);
    expect(bindingIsLive(DOORS_CLOSE_EARLY, 5000)).toBe(false);
  });

  it('takes the later of the two, whichever way round they are', () => {
    expect(bindingEndsAt(DOORS_CLOSE_EARLY)).toBe(5000);
    expect(bindingEndsAt(WINDOW_TRAILS)).toBe(9000);
  });
});

describe('eventWindow', () => {
  /*
   * The clock strings come from the device's own locale — a kiosk in Taipei is
   * as ordinary as one in Texas — so what is asserted is the join rather than
   * the times. These run under en-US, where the shape is "6:30 PM".
   */
  const at = (hour: number, minute = 0) => Date.UTC(2026, 1, 13, hour, minute);

  it('says the meridiem once when both ends share it', () => {
    // 62mm of tape and a lobby screen read from four feet away: "6:30 PM –
    // 8:30 PM" spends a third of the line saying PM twice.
    expect(
      eventWindow({ ...DOORS_CLOSE_EARLY, startAtMs: at(18, 30), endAtMs: at(20, 30) }),
    ).toBe('6:30 – 8:30 PM');
  });

  it('says it twice when the gathering crosses noon', () => {
    expect(
      eventWindow({ ...DOORS_CLOSE_EARLY, startAtMs: at(11, 30), endAtMs: at(13, 0) }),
    ).toBe('11:30 AM – 1:00 PM');
  });

  it('leaves no doubled space where the meridiem was', () => {
    const window = eventWindow({
      ...DOORS_CLOSE_EARLY,
      startAtMs: at(9, 0),
      endAtMs: at(10, 45),
    });

    expect(window).toBe('9:00 – 10:45 AM');
    expect(window).not.toMatch(/\s\s/);
  });

  it('crosses midnight without pretending the two ends agree', () => {
    expect(
      eventWindow({ ...DOORS_CLOSE_EARLY, startAtMs: at(23, 0), endAtMs: at(0, 30) }),
    ).toBe('11:00 PM – 12:30 AM');
  });
});

describe('windowHasClosed', () => {
  it('is the advisory line, nothing more', () => {
    expect(windowHasClosed(DOORS_CLOSE_EARLY, 2999)).toBe(false);
    // The closing instant itself is still open: a family arriving on the
    // minute the doors close is a family arriving on time.
    expect(windowHasClosed(DOORS_CLOSE_EARLY, 3000)).toBe(false);
    expect(windowHasClosed(DOORS_CLOSE_EARLY, 3001)).toBe(true);
  });
});

describe('windowHasOpened', () => {
  /** Doors at 2000, gathering at 3000. The half hour a tablet is set up in. */
  const OPENS_LATER: KioskBinding = { ...WINDOW_TRAILS, checkInOpensAtMs: 2000 };

  it('is the floor the binding never had', () => {
    expect(windowHasOpened(OPENS_LATER, 1999)).toBe(false);
    expect(windowHasOpened(OPENS_LATER, 2000)).toBe(true);
    expect(windowHasOpened(OPENS_LATER, 8999)).toBe(true);
  });

  it('lets a kiosk be bound before it may take anybody — the setup case', () => {
    // Both true at once is the point: the tablet is on the right gathering an
    // hour early and simply will not write until the doors open.
    expect(bindingIsLive(OPENS_LATER, 1999)).toBe(true);
    expect(windowHasOpened(OPENS_LATER, 1999)).toBe(false);
  });

  it('answers open for a binding written before the field existed', () => {
    // The safe direction: the failure of guessing the other way is a lobby
    // full of families a tablet refuses over a key it never stored.
    expect(WINDOW_TRAILS.checkInOpensAtMs).toBeUndefined();
    expect(windowHasOpened(WINDOW_TRAILS, 0)).toBe(true);
  });

  it('is not the mirror of windowHasClosed, and that is deliberate', () => {
    // Late still writes; early does not. See the note on `windowHasOpened`.
    expect(windowHasClosed(WINDOW_TRAILS, 9001)).toBe(true);
    expect(windowHasOpened(WINDOW_TRAILS, 9001)).toBe(true);
  });
});

describe('opensAtLabel', () => {
  const NOON = new Date('2026-08-12T12:00:00Z').getTime();
  const at = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  it('gives the clock alone when it opens today', () => {
    const later = NOON + 2 * 3_600_000;
    const binding: KioskBinding = { ...WINDOW_TRAILS, checkInOpensAtMs: later };
    expect(opensAtLabel(binding, NOON)).toBe(at(later));
  });

  it('carries the day when it does not — the misbinding this is for', () => {
    const nextWeek = NOON + 7 * 24 * 3_600_000;
    const binding: KioskBinding = { ...WINDOW_TRAILS, checkInOpensAtMs: nextWeek };
    const label = opensAtLabel(binding, NOON);
    expect(label).toContain(at(nextWeek));
    expect(label).toMatch(/^\w+day, /);
  });

  it('falls back to the start when there is no window on file', () => {
    // Nothing else to say, and saying nothing would be worse: a legacy binding
    // never reaches this label anyway, so the fallback only has to be honest.
    expect(WINDOW_TRAILS.checkInOpensAtMs).toBeUndefined();
    expect(opensAtLabel(WINDOW_TRAILS, WINDOW_TRAILS.startAtMs)).toBe(at(WINDOW_TRAILS.startAtMs));
  });
});

describe('persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through localStorage', () => {
    writeBinding(DOORS_CLOSE_EARLY);
    expect(readBinding()).toEqual(DOORS_CLOSE_EARLY);
    clearBinding();
    expect(readBinding()).toBeNull();
  });

  it('answers null for a corrupt or foreign value rather than throwing', () => {
    localStorage.setItem('tally:kiosk:binding', 'not json {');
    expect(readBinding()).toBeNull();
    localStorage.setItem('tally:kiosk:binding', JSON.stringify({ eventId: '' }));
    expect(readBinding()).toBeNull();
  });

  it('needs every field the screen reads before it will call it a binding', () => {
    /*
     * A kiosk that half-reads a binding is worse than one that unbinds: the
     * screen would open on a gathering with no title and clock times of `NaN`,
     * and the volunteer has no way to tell that from a real one.
     */
    const required = [
      'eventId',
      'title',
      'startAtMs',
      'endAtMs',
      'checkInClosesAtMs',
    ] as const;

    for (const field of required) {
      const partial: Record<string, unknown> = { ...DOORS_CLOSE_EARLY };
      delete partial[field];
      localStorage.setItem('tally:kiosk:binding', JSON.stringify(partial));
      expect(readBinding(), `missing ${field}`).toBeNull();
    }
  });

  it('refuses a field of the wrong type, which is what an older shape looks like', () => {
    const wrong: Array<[string, unknown]> = [
      ['eventId', 42],
      ['title', null],
      ['startAtMs', '1000'],
      ['endAtMs', '5000'],
      ['checkInClosesAtMs', '3000'],
    ];

    for (const [field, value] of wrong) {
      localStorage.setItem(
        'tally:kiosk:binding',
        JSON.stringify({ ...DOORS_CLOSE_EARLY, [field]: value }),
      );
      expect(readBinding(), `${field} = ${String(value)}`).toBeNull();
    }
  });

  it('refuses an empty event id, which would bind the kiosk to nothing', () => {
    localStorage.setItem(
      'tally:kiosk:binding',
      JSON.stringify({ ...DOORS_CLOSE_EARLY, eventId: '' }),
    );

    expect(readBinding()).toBeNull();
  });

  it('reads a binding whose optional halves are absent', () => {
    localStorage.setItem('tally:kiosk:binding', JSON.stringify(DOORS_CLOSE_EARLY));

    expect(readBinding()).toEqual(DOORS_CLOSE_EARLY);
  });

  it('reads a binding written before pickup existed, rather than logging out', () => {
    // No `requiresCheckOut` key at all — a lobby screen paired before this
    // shipped must survive the deploy and simply not offer pickup.
    writeBinding(DOORS_CLOSE_EARLY);
    expect(readBinding()?.requiresCheckOut).toBeUndefined();
  });

  it('reads one written before the check-in floor existed, and simply has none', () => {
    // Same bargain again: absent reads as "already open", which is the kiosk
    // that shipped, and the next rebind picks the real answer up.
    writeBinding(DOORS_CLOSE_EARLY);
    expect(readBinding()?.checkInOpensAtMs).toBeUndefined();
  });

  it('reads one written before themes existed, and simply wears none', () => {
    // Same bargain, one deploy later: a paired kiosk with no colours on its
    // binding is the kiosk that shipped, not a kiosk that has to pair again.
    writeBinding(DOORS_CLOSE_EARLY);
    const stored = readBinding();
    expect(stored?.kioskGround).toBeUndefined();
    expect(stored?.kioskPalette).toBeUndefined();
  });
});
