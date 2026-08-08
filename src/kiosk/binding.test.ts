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
  readBinding,
  windowHasClosed,
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

describe('windowHasClosed', () => {
  it('is the advisory line, nothing more', () => {
    expect(windowHasClosed(DOORS_CLOSE_EARLY, 2999)).toBe(false);
    expect(windowHasClosed(DOORS_CLOSE_EARLY, 3001)).toBe(true);
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

  it('reads a binding written before pickup existed, rather than logging out', () => {
    // No `requiresCheckOut` key at all — a lobby screen paired before this
    // shipped must survive the deploy and simply not offer pickup.
    writeBinding(DOORS_CLOSE_EARLY);
    expect(readBinding()?.requiresCheckOut).toBeUndefined();
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
