/**
 * The one line that says where a gathering is in its own evening.
 *
 * Order matters: a cancelled night is cancelled even inside its window, and a
 * count is only ever offered once the window has closed.
 */
import { describe, expect, it } from 'vitest';
import { eventStatusLine, type EventStatusTranslator } from '@/features/events/eventStatus';
import type { TimeStrings } from '@/lib/time';
import { makeEvent } from '../../../tests/factories';

const strings: TimeStrings = { locale: 'en-US', t: () => '' };

const t: EventStatusTranslator = (key, values = {}) =>
  Object.keys(values).length > 0 ? `${key}:${JSON.stringify(values)}` : key;

// makeEvent: 7-9 PM on Friday 13 Feb 2026, check-in open 6-10 PM.
const event = makeEvent();

describe('eventStatusLine', () => {
  it('says cancelled even while the window is open', () => {
    const cancelled = makeEvent({ status: 'cancelled' });
    expect(eventStatusLine(t, strings, cancelled, new Date('2026-02-13T19:30:00'), 5)).toBe(
      'cancelled',
    );
  });

  it('says check-in is open inside the window, including at both edges', () => {
    expect(eventStatusLine(t, strings, event, new Date('2026-02-13T19:30:00'), undefined)).toBe(
      'checkInOpen',
    );
    expect(eventStatusLine(t, strings, event, event.checkInOpensAt, undefined)).toBe('checkInOpen');
    expect(eventStatusLine(t, strings, event, event.checkInClosesAt, undefined)).toBe(
      'checkInOpen',
    );
  });

  it('names the opening time before the window opens', () => {
    const line = eventStatusLine(t, strings, event, new Date('2026-02-13T12:00:00'), undefined);
    expect(line).toMatch(/^checkInOpensAt:/);
    expect(line).toContain('6:00');
  });

  it('says check-in is closed once it is over and no count has been read', () => {
    expect(eventStatusLine(t, strings, event, new Date('2026-02-14T09:00:00'), undefined)).toBe(
      'checkInClosed',
    );
  });

  it('gives the count for a finished night that had people', () => {
    expect(eventStatusLine(t, strings, event, new Date('2026-02-14T09:00:00'), 12)).toBe(
      'finishedWithCount:{"count":12}',
    );
  });

  it('says finished-empty for a finished night with nobody', () => {
    expect(eventStatusLine(t, strings, event, new Date('2026-02-14T09:00:00'), 0)).toBe(
      'finishedEmpty',
    );
  });
});
