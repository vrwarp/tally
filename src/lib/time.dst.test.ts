/**
 * The two nights a year when a day is not twenty-four hours long.
 *
 * Its own file because it pins the process's time zone, which `vitest`
 * isolates per file. Everything in `lib/time.ts` is written in wall-clock
 * time, and the one place that added a fixed day of milliseconds instead was
 * an hour out on exactly these nights.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextSeriesOccurrence } from '@/lib/time';

const ORIGINAL_TZ = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'America/Los_Angeles';
});

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('nextSeriesOccurrence across a clock change', () => {
  const lockIn = {
    dayOfWeek: 6,
    startTime: '22:00',
    endTime: '03:00',
    checkInOpensMinutesBefore: 0,
    checkInClosesMinutesAfter: 0,
  };

  it('is running in a zone that observes daylight saving', () => {
    // 8 Mar 2026 02:00 does not exist in Los Angeles; the day is 23 hours.
    const before = new Date(2026, 2, 7, 12, 0);
    const after = new Date(2026, 2, 8, 12, 0);
    expect(after.getTime() - before.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('ends an overnight series at its wall-clock time on the spring-forward night', () => {
    // Sat 7 Mar 2026 22:00 -> Sun 8 Mar 03:00, a night of 4 hours on the clock.
    const { endAt } = nextSeriesOccurrence(lockIn, new Date(2026, 2, 6, 8, 0));
    expect([endAt.getDate(), endAt.getHours(), endAt.getMinutes()]).toEqual([8, 3, 0]);
  });

  it('ends an overnight series at its wall-clock time on the fall-back night', () => {
    // Sat 31 Oct 2026 22:00 -> Sun 1 Nov 03:00, a night of 6 hours on the clock.
    const { endAt } = nextSeriesOccurrence(lockIn, new Date(2026, 9, 30, 8, 0));
    expect([endAt.getDate(), endAt.getHours(), endAt.getMinutes()]).toEqual([1, 3, 0]);
  });
});
