/**
 * The binding's lifetime is a product decision made verbatim: the kiosk works
 * "until the event ends" — the check-in window closing is advisory copy, never
 * a lock.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bindingIsLive,
  clearBinding,
  readBinding,
  windowHasClosed,
  writeBinding,
  type KioskBinding,
} from '@/kiosk/binding';

const BINDING: KioskBinding = {
  eventId: 'event-1',
  seriesId: 'friday',
  title: 'Friday Fellowship',
  startAtMs: 1000,
  endAtMs: 5000,
  checkInClosesAtMs: 3000,
  boundAtMs: 500,
};

describe('bindingIsLive', () => {
  it('lives through the closed check-in window and dies at the event end', () => {
    expect(bindingIsLive(BINDING, 2999)).toBe(true);
    // Window closed, event still running: the kiosk keeps working.
    expect(bindingIsLive(BINDING, 3001)).toBe(true);
    expect(bindingIsLive(BINDING, 4999)).toBe(true);
    expect(bindingIsLive(BINDING, 5000)).toBe(false);
  });
});

describe('windowHasClosed', () => {
  it('is the advisory line, nothing more', () => {
    expect(windowHasClosed(BINDING, 2999)).toBe(false);
    expect(windowHasClosed(BINDING, 3001)).toBe(true);
  });
});

describe('persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips through localStorage', () => {
    writeBinding(BINDING);
    expect(readBinding()).toEqual(BINDING);
    clearBinding();
    expect(readBinding()).toBeNull();
  });

  it('answers null for a corrupt or foreign value rather than throwing', () => {
    localStorage.setItem('tally:kiosk:binding', 'not json {');
    expect(readBinding()).toBeNull();
    localStorage.setItem('tally:kiosk:binding', JSON.stringify({ eventId: '' }));
    expect(readBinding()).toBeNull();
  });
});
