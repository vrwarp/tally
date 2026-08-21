/**
 * Unit tests for the temporal-awareness helpers (PRD 4.3).
 *
 * All dates are built with the `new Date(y, m, d, …)` constructor rather than
 * ISO strings so the suite asserts *local* wall-clock behaviour and passes in
 * any timezone — which is the whole point of the module.
 */
import { describe, expect, it } from 'vitest';
import {
  addMinutes,
  atTimeOfDay,
  daysAgo,
  formatEventWindow,
  formatSeenShort,
  fromDateTimeLocalValue,
  isCheckInOpen,
  nextSeriesOccurrence,
  parseTimeOfDay,
  pickActiveEvent,
  recentChainInstances,
  startOfDay,
  toDateTimeLocalValue,
} from '@/lib/time';
import { makeEvent } from '../../tests/factories';

/** Fri 13 Feb 2026, 19:30 local. */
const FRIDAY_EVENING = new Date(2026, 1, 13, 19, 30);

describe('parseTimeOfDay', () => {
  it('parses zero-padded and single-digit hours', () => {
    expect(parseTimeOfDay('19:00')).toEqual({ hours: 19, minutes: 0 });
    expect(parseTimeOfDay('09:05')).toEqual({ hours: 9, minutes: 5 });
    expect(parseTimeOfDay('9:05')).toEqual({ hours: 9, minutes: 5 });
    expect(parseTimeOfDay('00:00')).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeOfDay('23:59')).toEqual({ hours: 23, minutes: 59 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseTimeOfDay('  19:00 ')).toEqual({ hours: 19, minutes: 0 });
  });

  it('rejects malformed input', () => {
    expect(() => parseTimeOfDay('')).toThrow(/Invalid time-of-day/);
    expect(() => parseTimeOfDay('7pm')).toThrow(/Invalid time-of-day/);
    expect(() => parseTimeOfDay('19:0')).toThrow(/Invalid time-of-day/);
    expect(() => parseTimeOfDay('1900')).toThrow(/Invalid time-of-day/);
    expect(() => parseTimeOfDay('19:00:00')).toThrow(/Invalid time-of-day/);
  });

  it('rejects out-of-range hours and minutes', () => {
    expect(() => parseTimeOfDay('24:00')).toThrow(/out of range/);
    expect(() => parseTimeOfDay('19:60')).toThrow(/out of range/);
    expect(() => parseTimeOfDay('99:99')).toThrow(/out of range/);
  });
});

describe('atTimeOfDay', () => {
  it('keeps the calendar day and replaces the clock', () => {
    const result = atTimeOfDay(new Date(2026, 1, 13, 3, 17, 42, 500), '19:00');
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(1);
    expect(result.getDate()).toBe(13);
    expect(result.getHours()).toBe(19);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it('does not mutate the day it was given', () => {
    const day = new Date(2026, 1, 13, 3, 0);
    atTimeOfDay(day, '19:00');
    expect(day.getHours()).toBe(3);
  });
});

describe('addMinutes', () => {
  it('shifts forwards and backwards', () => {
    const base = new Date(2026, 1, 13, 19, 0);
    expect(addMinutes(base, 30).getHours()).toBe(19);
    expect(addMinutes(base, 30).getMinutes()).toBe(30);
    expect(addMinutes(base, -60).getHours()).toBe(18);
    expect(addMinutes(base, 0).getTime()).toBe(base.getTime());
  });

  it('does not mutate its input', () => {
    const base = new Date(2026, 1, 13, 19, 0);
    addMinutes(base, 90);
    expect(base.getHours()).toBe(19);
  });
});

describe('startOfDay', () => {
  it('zeroes the time components', () => {
    const result = startOfDay(new Date(2026, 1, 13, 23, 59, 59, 999));
    expect(result.getDate()).toBe(13);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it('does not mutate its input', () => {
    const base = new Date(2026, 1, 13, 23, 0);
    startOfDay(base);
    expect(base.getHours()).toBe(23);
  });
});

describe('daysAgo', () => {
  it('walks back across a month boundary', () => {
    const result = daysAgo(new Date(2026, 1, 2, 12, 0), 5);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(28);
  });
});

describe('isCheckInOpen', () => {
  const event = makeEvent({
    checkInOpensAt: new Date(2026, 1, 13, 18, 0),
    checkInClosesAt: new Date(2026, 1, 13, 22, 0),
  });

  it('is open at the exact opening instant', () => {
    expect(isCheckInOpen(event, new Date(2026, 1, 13, 18, 0, 0, 0))).toBe(true);
  });

  it('is open at the exact closing instant', () => {
    expect(isCheckInOpen(event, new Date(2026, 1, 13, 22, 0, 0, 0))).toBe(true);
  });

  it('is shut one millisecond either side', () => {
    expect(isCheckInOpen(event, new Date(2026, 1, 13, 17, 59, 59, 999))).toBe(false);
    expect(isCheckInOpen(event, new Date(2026, 1, 13, 22, 0, 0, 1))).toBe(false);
  });

  it('is open in the middle', () => {
    expect(isCheckInOpen(event, FRIDAY_EVENING)).toBe(true);
  });
});

describe('pickActiveEvent', () => {
  const fellowship = makeEvent({
    id: 'fellowship',
    title: 'Friday Fellowship',
    startAt: new Date(2026, 1, 13, 19, 0),
    endAt: new Date(2026, 1, 13, 21, 0),
    checkInOpensAt: new Date(2026, 1, 13, 18, 0),
    checkInClosesAt: new Date(2026, 1, 13, 22, 0),
  });

  it('returns null when there are no events at all', () => {
    expect(pickActiveEvent([], FRIDAY_EVENING)).toBeNull();
  });

  it('picks the event whose check-in window is open right now', () => {
    const lastWeek = makeEvent({
      id: 'last-week',
      startAt: new Date(2026, 1, 6, 19, 0),
      endAt: new Date(2026, 1, 6, 21, 0),
      checkInOpensAt: new Date(2026, 1, 6, 18, 0),
      checkInClosesAt: new Date(2026, 1, 6, 22, 0),
    });
    expect(pickActiveEvent([lastWeek, fellowship], FRIDAY_EVENING)?.id).toBe('fellowship');
  });

  it('prefers the most recently started event when two windows overlap', () => {
    // Sunday School running long into the afternoon outing's check-in window.
    const morning = makeEvent({
      id: 'sunday-school',
      seriesId: 'sunday-school',
      startAt: new Date(2026, 1, 15, 9, 0),
      endAt: new Date(2026, 1, 15, 10, 30),
      checkInOpensAt: new Date(2026, 1, 15, 8, 30),
      checkInClosesAt: new Date(2026, 1, 15, 14, 0),
    });
    const outing = makeEvent({
      id: 'outing',
      mode: 'oneoff',
      seriesId: null,
      startAt: new Date(2026, 1, 15, 12, 0),
      endAt: new Date(2026, 1, 15, 17, 0),
      checkInOpensAt: new Date(2026, 1, 15, 11, 30),
      checkInClosesAt: new Date(2026, 1, 15, 18, 0),
    });
    const noonish = new Date(2026, 1, 15, 12, 15);

    expect(pickActiveEvent([morning, outing], noonish)?.id).toBe('outing');
    // Order of the input array must not change the answer.
    expect(pickActiveEvent([outing, morning], noonish)?.id).toBe('outing');
  });

  it('falls back to the next event later today when nothing is open yet', () => {
    const earlyAfternoon = new Date(2026, 1, 13, 14, 0);
    const later = makeEvent({
      id: 'later-tonight',
      startAt: new Date(2026, 1, 13, 21, 30),
      endAt: new Date(2026, 1, 13, 23, 0),
      checkInOpensAt: new Date(2026, 1, 13, 21, 0),
      checkInClosesAt: new Date(2026, 1, 13, 23, 30),
    });

    expect(pickActiveEvent([later, fellowship], earlyAfternoon)?.id).toBe('fellowship');
  });

  it('ignores events on other days and events already finished', () => {
    const tomorrow = makeEvent({
      id: 'tomorrow',
      startAt: new Date(2026, 1, 14, 10, 0),
      endAt: new Date(2026, 1, 14, 12, 0),
      checkInOpensAt: new Date(2026, 1, 14, 9, 0),
      checkInClosesAt: new Date(2026, 1, 14, 13, 0),
    });
    const finished = makeEvent({
      id: 'finished',
      startAt: new Date(2026, 1, 13, 8, 0),
      endAt: new Date(2026, 1, 13, 9, 0),
      checkInOpensAt: new Date(2026, 1, 13, 7, 0),
      checkInClosesAt: new Date(2026, 1, 13, 10, 0),
    });

    expect(pickActiveEvent([tomorrow, finished], new Date(2026, 1, 13, 14, 0))).toBeNull();
  });

  it('never auto-selects a cancelled event, even one that is open', () => {
    const cancelled = makeEvent({ ...fellowship, id: 'cancelled', status: 'cancelled' });
    expect(pickActiveEvent([cancelled], FRIDAY_EVENING)).toBeNull();
  });

  it('skips a cancelled open event in favour of a live one later today', () => {
    const cancelled = makeEvent({ ...fellowship, id: 'cancelled', status: 'cancelled' });
    const replacement = makeEvent({
      id: 'replacement',
      startAt: new Date(2026, 1, 13, 20, 0),
      endAt: new Date(2026, 1, 13, 22, 0),
      checkInOpensAt: new Date(2026, 1, 13, 19, 45),
      checkInClosesAt: new Date(2026, 1, 13, 23, 0),
    });

    expect(pickActiveEvent([cancelled, replacement], FRIDAY_EVENING)?.id).toBe('replacement');
  });
});

describe('recentChainInstances', () => {
  /** Weekly Friday instances, each closing check-in at 22:00. */
  const friday = (weeksBack: number) => {
    const startAt = new Date(2026, 1, 13 - weeksBack * 7, 19, 0);
    return makeEvent({
      id: `friday-${weeksBack}`,
      seriesId: 'friday-fellowship',
      startAt,
      endAt: new Date(2026, 1, 13 - weeksBack * 7, 21, 0),
      checkInOpensAt: new Date(2026, 1, 13 - weeksBack * 7, 18, 0),
      checkInClosesAt: new Date(2026, 1, 13 - weeksBack * 7, 22, 0),
    });
  };

  const past = [friday(1), friday(2), friday(3), friday(4)];

  it('returns the most recent closed instances, newest first', () => {
    const result = recentChainInstances(past, 'friday-fellowship', FRIDAY_EVENING, 3);
    expect(result.map((event) => event.id)).toEqual(['friday-1', 'friday-2', 'friday-3']);
  });

  it('excludes an instance whose check-in window has not closed yet', () => {
    // Tonight's gathering is still in progress at 19:30.
    const tonight = friday(0);
    const result = recentChainInstances([tonight, ...past], 'friday-fellowship', FRIDAY_EVENING, 5);
    expect(result.map((event) => event.id)).not.toContain('friday-0');
    expect(result).toHaveLength(4);
  });

  it('excludes other series', () => {
    const sunday = makeEvent({
      id: 'sunday-1',
      seriesId: 'sunday-school',
      startAt: new Date(2026, 1, 8, 9, 0),
      endAt: new Date(2026, 1, 8, 10, 30),
      checkInOpensAt: new Date(2026, 1, 8, 8, 30),
      checkInClosesAt: new Date(2026, 1, 8, 11, 0),
    });
    const result = recentChainInstances([sunday, ...past], 'friday-fellowship', FRIDAY_EVENING, 10);
    expect(result.map((event) => event.seriesId)).toEqual([
      'friday-fellowship',
      'friday-fellowship',
      'friday-fellowship',
      'friday-fellowship',
    ]);
  });

  it('excludes cancelled instances', () => {
    const cancelled = makeEvent({ ...friday(1), status: 'cancelled' });
    const result = recentChainInstances(
      [cancelled, friday(2), friday(3)],
      'friday-fellowship',
      FRIDAY_EVENING,
      5,
    );
    expect(result.map((event) => event.id)).toEqual(['friday-2', 'friday-3']);
  });

  it('respects the requested count, including zero and negatives', () => {
    expect(recentChainInstances(past, 'friday-fellowship', FRIDAY_EVENING, 1)).toHaveLength(1);
    expect(recentChainInstances(past, 'friday-fellowship', FRIDAY_EVENING, 0)).toHaveLength(0);
    expect(recentChainInstances(past, 'friday-fellowship', FRIDAY_EVENING, -3)).toHaveLength(0);
    expect(recentChainInstances(past, 'friday-fellowship', FRIDAY_EVENING, 99)).toHaveLength(4);
  });

  /*
   * A repeating event created in the app: no series document anywhere, the
   * chain held together by the root the occurrences were copied forward from.
   * Its own root counts as history — it is a gathering that happened.
   */
  it('gathers a rootless chain by its recurrence root, root included', () => {
    const rooted = (weeksBack: number) =>
      makeEvent({ ...friday(weeksBack), seriesId: null, recurrenceRootId: 'saturday-root' });

    const root = makeEvent({
      ...friday(3),
      id: 'saturday-root',
      seriesId: null,
      recurrenceRootId: null,
    });

    const result = recentChainInstances(
      [rooted(1), rooted(2), root],
      'saturday-root',
      FRIDAY_EVENING,
      5,
    );

    expect(result.map((event) => event.id)).toEqual(['friday-1', 'friday-2', 'saturday-root']);
  });

  it('keeps two rootless chains apart', () => {
    const ours = makeEvent({ ...friday(1), seriesId: null, recurrenceRootId: 'ours' });
    const theirs = makeEvent({
      ...friday(2),
      id: 'theirs-1',
      seriesId: null,
      recurrenceRootId: 'theirs',
    });

    const result = recentChainInstances([ours, theirs], 'ours', FRIDAY_EVENING, 5);

    expect(result.map((event) => event.id)).toEqual(['friday-1']);
  });
});

describe('nextSeriesOccurrence', () => {
  const fridaySeries = {
    dayOfWeek: 5,
    startTime: '19:00',
    endTime: '21:00',
    checkInOpensMinutesBefore: 60,
    checkInClosesMinutesAfter: 30,
  };

  it('finds the coming Friday from earlier in the week', () => {
    // Wed 11 Feb 2026.
    const { startAt, endAt } = nextSeriesOccurrence(fridaySeries, new Date(2026, 1, 11, 8, 0));
    expect(startAt.getDay()).toBe(5);
    expect(startAt.getDate()).toBe(13);
    expect(startAt.getHours()).toBe(19);
    expect(endAt.getDate()).toBe(13);
    expect(endAt.getHours()).toBe(21);
  });

  it('stays on today when the gathering has not ended yet', () => {
    const { startAt } = nextSeriesOccurrence(fridaySeries, new Date(2026, 1, 13, 20, 59));
    expect(startAt.getDate()).toBe(13);
    expect(startAt.getMonth()).toBe(1);
  });

  it('stays on today at the exact end time', () => {
    const { startAt } = nextSeriesOccurrence(fridaySeries, new Date(2026, 1, 13, 21, 0));
    expect(startAt.getDate()).toBe(13);
  });

  it('rolls to next week once the gathering has ended', () => {
    const { startAt, endAt } = nextSeriesOccurrence(fridaySeries, new Date(2026, 1, 13, 21, 1));
    expect(startAt.getDay()).toBe(5);
    expect(startAt.getDate()).toBe(20);
    expect(startAt.getHours()).toBe(19);
    expect(endAt.getDate()).toBe(20);
    expect(endAt.getHours()).toBe(21);
  });

  it('derives the check-in window from the start and end times', () => {
    const { startAt, endAt, checkInOpensAt, checkInClosesAt } = nextSeriesOccurrence(
      fridaySeries,
      new Date(2026, 1, 11, 8, 0),
    );
    expect(checkInOpensAt.getTime()).toBe(startAt.getTime() - 60 * 60_000);
    expect(checkInOpensAt.getHours()).toBe(18);
    expect(checkInClosesAt.getTime()).toBe(endAt.getTime() + 30 * 60_000);
    expect(checkInClosesAt.getHours()).toBe(21);
    expect(checkInClosesAt.getMinutes()).toBe(30);
  });

  it('handles a Sunday-morning series from mid-week', () => {
    const sundaySeries = {
      dayOfWeek: 0,
      startTime: '09:00',
      endTime: '10:30',
      checkInOpensMinutesBefore: 30,
      checkInClosesMinutesAfter: 15,
    };
    const { startAt, endAt } = nextSeriesOccurrence(sundaySeries, new Date(2026, 1, 11, 8, 0));
    expect(startAt.getDay()).toBe(0);
    expect(startAt.getDate()).toBe(15);
    expect(startAt.getHours()).toBe(9);
    expect(endAt.getHours()).toBe(10);
    expect(endAt.getMinutes()).toBe(30);
  });

  it('does not mutate the date it was given', () => {
    const from = new Date(2026, 1, 11, 8, 0);
    nextSeriesOccurrence(fridaySeries, from);
    expect(from.getTime()).toBe(new Date(2026, 1, 11, 8, 0).getTime());
  });
});

describe('datetime-local round-tripping', () => {
  it('formats a local date without timezone drift', () => {
    expect(toDateTimeLocalValue(new Date(2026, 1, 13, 19, 0))).toBe('2026-02-13T19:00');
    expect(toDateTimeLocalValue(new Date(2026, 0, 2, 9, 5))).toBe('2026-01-02T09:05');
  });

  it('parses back to the same local instant', () => {
    const parsed = fromDateTimeLocalValue('2026-02-13T19:00');
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(1);
    expect(parsed.getDate()).toBe(13);
    expect(parsed.getHours()).toBe(19);
    expect(parsed.getMinutes()).toBe(0);
    expect(parsed.getSeconds()).toBe(0);
  });

  it('round-trips in both directions', () => {
    const original = new Date(2026, 1, 13, 19, 0);
    expect(fromDateTimeLocalValue(toDateTimeLocalValue(original)).getTime()).toBe(
      original.getTime(),
    );
    expect(toDateTimeLocalValue(fromDateTimeLocalValue('2026-07-04T08:15'))).toBe(
      '2026-07-04T08:15',
    );
  });

  it('rejects junk rather than producing an Invalid Date', () => {
    expect(() => fromDateTimeLocalValue('')).toThrow(/Invalid datetime-local/);
    expect(() => fromDateTimeLocalValue('nope')).toThrow(/Invalid datetime-local/);
    expect(() => fromDateTimeLocalValue('2026-02-13')).toThrow(/Invalid datetime-local/);
    expect(() => fromDateTimeLocalValue('2026-02-13T19:00:00')).toThrow(/Invalid datetime-local/);
    expect(() => fromDateTimeLocalValue('2026-02-13 19:00')).toThrow(/Invalid datetime-local/);
  });
});

describe('formatSeenShort', () => {
  /** Fri 13 Feb 2026, 19:30 local — the same "now" the rest of the suite uses. */
  const now = FRIDAY_EVENING;

  it('names the day inside the last week, because that is the useful precision', () => {
    expect(formatSeenShort(new Date(2026, 1, 13, 8, 0), now)).toBe('Today');
    expect(formatSeenShort(new Date(2026, 1, 12, 19, 30), now)).toBe('Yesterday');
    expect(formatSeenShort(new Date(2026, 1, 8, 10, 0), now)).toBe('Sun');
    expect(formatSeenShort(new Date(2026, 1, 7, 10, 0), now)).toBe('Sat');
  });

  it('counts by calendar day, not by elapsed hours', () => {
    // Twenty-three hours earlier, but a different date: a leader reading this
    // means "which day", not "how many hours".
    expect(formatSeenShort(new Date(2026, 1, 12, 20, 30), now)).toBe('Yesterday');
    // Ninety minutes earlier, same date.
    expect(formatSeenShort(new Date(2026, 1, 13, 18, 0), now)).toBe('Today');
  });

  it('coarsens to weeks from a week out, and keeps the singular singular', () => {
    expect(formatSeenShort(new Date(2026, 1, 6, 19, 30), now)).toBe('1 wk ago');
    expect(formatSeenShort(new Date(2026, 0, 23, 19, 30), now)).toBe('3 wks ago');
    expect(formatSeenShort(new Date(2026, 0, 16, 19, 30), now)).toBe('4 wks ago');
  });

  it('lets weeks own everything under thirty days, whatever the calendar says', () => {
    // 28 Jan -> 13 Feb is one calendar month by date-fns and sixteen days by
    // the clock. Sixteen days is not "1 mth ago".
    expect(formatSeenShort(new Date(2026, 0, 28, 19, 30), now)).toBe('2 wks ago');
  });

  it('switches to months at thirty days and to years at twelve', () => {
    expect(formatSeenShort(new Date(2026, 0, 14, 19, 30), now)).toBe('1 mth ago');
    expect(formatSeenShort(new Date(2025, 9, 13, 19, 30), now)).toBe('4 mths ago');
    expect(formatSeenShort(new Date(2025, 1, 13, 19, 30), now)).toBe('1 yr ago');
    expect(formatSeenShort(new Date(2023, 1, 13, 19, 30), now)).toBe('3 yrs ago');
  });

  it('does not describe a future date in the past tense', () => {
    // A clock a few minutes out of step must not produce "-1 wks ago".
    expect(formatSeenShort(new Date(2026, 1, 14, 9, 0), now)).toBe('Today');
  });

  it('stays inside the width the column is drawn at', () => {
    const samples = [0, 1, 3, 6, 8, 20, 29, 45, 200, 400, 1200].map((days) =>
      formatSeenShort(new Date(now.getTime() - days * 24 * 60 * 60 * 1000), now),
    );
    for (const sample of samples) expect(sample.length).toBeLessThanOrEqual(10);
  });
});

/**
 * When a gathering runs, said so that "when does it end" is answerable.
 *
 * The bug these pin down was a real one on real seeded data: the Winter
 * Retreat leaves on a Friday afternoon and comes back on a Sunday afternoon,
 * and the event page printed "5:00 PM – 3:00 PM" — a window that appears to
 * close fourteen hours before it opens, on the one screen a leader opens to
 * find out when the bus gets back, directly under a description saying "two
 * nights at Camp Silverpine".
 *
 * The assertions are about the *end* date appearing and the same-day form not
 * changing. Nearly every caller already prints the start day beside this
 * string, so a start date in here would be the same fact twice.
 */
describe('formatEventWindow', () => {
  it('prints two clock times for a gathering that starts and ends the same day', () => {
    expect(
      formatEventWindow({
        startAt: new Date(2026, 1, 13, 19, 0),
        endAt: new Date(2026, 1, 13, 21, 0),
      }),
    ).toBe('7:00 PM – 9:00 PM');
  });

  it('says which day a lock-in ends on when it runs past midnight', () => {
    // Fri 24 Oct 7:00 PM -> Sat 25 Oct 8:00 AM. Five hours short of a day and
    // still a different date, which is the only thing that decides this.
    expect(
      formatEventWindow({
        startAt: new Date(2025, 9, 24, 19, 0),
        endAt: new Date(2025, 9, 25, 8, 0),
      }),
    ).toBe('7:00 PM – Sat, Oct 25, 8:00 AM');
  });

  it('says which day a multi-day trip ends on', () => {
    // The Winter Retreat: two nights, and the end time alone reads as earlier
    // than the start.
    expect(
      formatEventWindow({
        startAt: new Date(2026, 8, 11, 17, 0),
        endAt: new Date(2026, 8, 13, 15, 0),
      }),
    ).toBe('5:00 PM – Sun, Sep 13, 3:00 PM');
  });

  it('crosses a month and a year boundary without losing the date', () => {
    expect(
      formatEventWindow({
        startAt: new Date(2025, 11, 31, 21, 0),
        endAt: new Date(2026, 0, 1, 1, 0),
      }),
    ).toBe('9:00 PM – Thu, Jan 1, 1:00 AM');
  });

  it('states the start alone when there is no end, rather than throwing', () => {
    const startAt = new Date(2026, 1, 13, 19, 0);
    expect(formatEventWindow({ startAt })).toBe('7:00 PM');
    expect(formatEventWindow({ startAt, endAt: null })).toBe('7:00 PM');
    expect(formatEventWindow({ startAt, endAt: undefined })).toBe('7:00 PM');
  });

  it('counts calendar days, not elapsed hours', () => {
    // Two minutes long, and on two different dates. The second date is the
    // whole point of the line, so it is written.
    expect(
      formatEventWindow({
        startAt: new Date(2026, 1, 13, 23, 59),
        endAt: new Date(2026, 1, 14, 0, 1),
      }),
    ).toBe('11:59 PM – Sat, Feb 14, 12:01 AM');

    // Twenty-three hours long, and on one date.
    expect(
      formatEventWindow({
        startAt: new Date(2026, 1, 13, 0, 30),
        endAt: new Date(2026, 1, 13, 23, 30),
      }),
    ).toBe('12:30 AM – 11:30 PM');
  });

  it('takes a whole event, so every caller can pass the one it already has', () => {
    const event = makeEvent({
      startAt: new Date(2026, 1, 13, 19, 0),
      endAt: new Date(2026, 1, 14, 7, 0),
    });
    expect(formatEventWindow(event)).toBe('7:00 PM – Sat, Feb 14, 7:00 AM');
  });
});
