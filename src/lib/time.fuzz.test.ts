/**
 * Properties of the time helpers.
 *
 * Temporal awareness is the feature nobody notices until it is wrong: a
 * counselor opens Tally and checks thirty students into last week's Friday.
 * These say what must hold for every clock and every calendar day, including
 * the awkward ones — a lock-in that crosses midnight, a series day that is
 * today, an event whose window has not opened.
 */
import { describe, expect } from 'vitest';
import { forAll } from '../../tests/fuzz/property';
import { arbitraryEvent } from '../../tests/fuzz/arbitrary';
import type { Rng } from '../../tests/fuzz/prng';
import {
  fromDateTimeLocalValue,
  isCheckInOpen,
  nextSeriesOccurrence,
  pickActiveEvent,
  recentSeriesInstances,
  toDateTimeLocalValue,
} from './time';
import type { TallyEvent } from '@/types';

const NOW = new Date('2026-02-13T19:30:00');

function arbitraryEvents(rng: Rng): { events: TallyEvent[]; now: Date } {
  const now = new Date(NOW.getTime() + rng.int(-14, 14) * 86_400_000);
  const events = Array.from({ length: rng.int(0, 15) }, () => arbitraryEvent(rng));
  return { events, now };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

describe('time helper properties', () => {
  forAll('pickActiveEvent never throws and never picks a cancelled event', arbitraryEvents, ({ events, now }) => {
    const chosen = pickActiveEvent(events, now);

    if (chosen) {
      // Checking students into an event the leaders called off is worse than
      // showing nothing at all.
      expect(chosen.status).not.toBe('cancelled');
      expect(events).toContain(chosen);
    }
  });

  forAll('pickActiveEvent prefers an open window over anything else', arbitraryEvents, ({ events, now }) => {
    const chosen = pickActiveEvent(events, now);
    const anyOpen = events.some(
      (event) => event.status !== 'cancelled' && isCheckInOpen(event, now),
    );

    if (anyOpen) {
      expect(chosen).not.toBeNull();
      expect(isCheckInOpen(chosen!, now)).toBe(true);
    }
  });

  forAll('recentSeriesInstances only returns finished events of one series', (rng) => {
    const { events, now } = arbitraryEvents(rng);
    return { events, now, seriesId: rng.pick(['friday', 'sunday']), count: rng.int(0, 6) };
  }, ({ events, now, seriesId, count }) => {
    const history = recentSeriesInstances(events, seriesId, now, count);

    expect(history.length).toBeLessThanOrEqual(count);
    for (const event of history) {
      expect(event.seriesId).toBe(seriesId);
      expect(event.status).not.toBe('cancelled');
      // An event still in progress must never predict its own roster.
      expect(event.checkInClosesAt.getTime()).toBeLessThan(now.getTime());
    }

    // Newest first.
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i - 1]!.startAt.getTime()).toBeGreaterThanOrEqual(history[i]!.startAt.getTime());
    }
  });

  /**
   * The window has to be coherent for every day-of-week and every pair of
   * times, including a 22:00-01:00 lock-in where the end is on the next day. A
   * window that closes before it opens means check-in is never possible.
   */
  forAll('nextSeriesOccurrence always yields a coherent window', (rng) => ({
    series: {
      dayOfWeek: rng.int(0, 6),
      startTime: `${pad(rng.int(0, 23))}:${pad(rng.int(0, 59))}`,
      endTime: `${pad(rng.int(0, 23))}:${pad(rng.int(0, 59))}`,
      checkInOpensMinutesBefore: rng.int(0, 240),
      checkInClosesMinutesAfter: rng.int(0, 240),
    },
    from: new Date(NOW.getTime() + rng.int(-30, 30) * 86_400_000 + rng.int(0, 86_400) * 1000),
  }), ({ series, from }) => {
    const occurrence = nextSeriesOccurrence(series, from);

    for (const date of Object.values(occurrence)) {
      expect(Number.isFinite(date.getTime())).toBe(true);
    }

    expect(occurrence.checkInOpensAt.getTime()).toBeLessThanOrEqual(occurrence.startAt.getTime());
    expect(occurrence.startAt.getTime()).toBeLessThan(occurrence.endAt.getTime());
    expect(occurrence.endAt.getTime()).toBeLessThanOrEqual(occurrence.checkInClosesAt.getTime());
    expect(occurrence.startAt.getDay()).toBe(series.dayOfWeek);
  });

  forAll('nextSeriesOccurrence never schedules something already over', (rng) => ({
    series: {
      dayOfWeek: rng.int(0, 6),
      startTime: `${pad(rng.int(0, 22))}:00`,
      endTime: `${pad(rng.int(0, 22))}:30`,
      checkInOpensMinutesBefore: 60,
      checkInClosesMinutesAfter: 60,
    },
    from: new Date(NOW.getTime() + rng.int(-30, 30) * 86_400_000),
  }), ({ series, from }) => {
    const occurrence = nextSeriesOccurrence(series, from);
    expect(occurrence.endAt.getTime()).toBeGreaterThanOrEqual(from.getTime());
  });

  forAll('a datetime-local value round-trips to the same minute', (rng) => {
    const date = new Date(NOW.getTime() + rng.int(-500, 500) * 86_400_000 + rng.int(0, 1439) * 60_000);
    date.setSeconds(0, 0);
    return date;
  }, (date) => {
    const round = fromDateTimeLocalValue(toDateTimeLocalValue(date));

    expect(round.getFullYear()).toBe(date.getFullYear());
    expect(round.getMonth()).toBe(date.getMonth());
    expect(round.getDate()).toBe(date.getDate());
    expect(round.getHours()).toBe(date.getHours());
    expect(round.getMinutes()).toBe(date.getMinutes());
  });

  forAll('fromDateTimeLocalValue rejects anything that is not a datetime-local value', (rng) =>
    rng.pick([
      '',
      'nope',
      '2026-13-45T99:99',
      '2026-01-02',
      '2026-01-02T25:00',
      '2026-01-02T12:60',
      '2026-1-2T3:4',
      '<script>',
    ]),
  (value) => {
    // Throwing is correct here — the caller is a form and can show the error.
    // Silently inventing a date would put an event on the wrong evening.
    expect(() => fromDateTimeLocalValue(value)).toThrow();
  });

  forAll('isCheckInOpen agrees with the window it was given', (rng) => {
    const event = arbitraryEvent(rng);
    return { event, now: new Date(event.startAt.getTime() + rng.int(-300, 300) * 60_000) };
  }, ({ event, now }) => {
    const open = isCheckInOpen(event, now);
    expect(open).toBe(now >= event.checkInOpensAt && now <= event.checkInClosesAt);
  });
});
