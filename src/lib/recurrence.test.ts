/**
 * Unit tests for the recurrence engine.
 *
 * As in `time.test.ts`, every date is built with the `new Date(y, m, d, …)`
 * constructor rather than an ISO string, so the suite asserts *local*
 * wall-clock behaviour and passes in any timezone.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_INTERVAL,
  defaultRuleForFrequency,
  describeMonthlyWeekday,
  describeRecurrence,
  fromDateOnlyValue,
  matchRecurrencePreset,
  monthlyWeekdayPosition,
  nextRecurrenceOccurrence,
  normalizeRecurrence,
  nthWeekdayOfMonth,
  recurrenceOccurrences,
  recurrencePresets,
  retimeRecurrence,
  suggestedRecurrenceEnd,
  toDateOnlyValue,
  validateRecurrence,
  weekdayOrdinalInMonth,
} from '@/lib/recurrence';
import type { RecurrenceRule } from '@/types';

/** Fri 24 Jul 2026, 19:00 local — the fourth Friday of the month. */
const FRIDAY = new Date(2026, 6, 24, 19, 0);
/** Tue 21 Jul 2026, 19:00 local — the third Tuesday, matching the screenshots. */
const TUESDAY = new Date(2026, 6, 21, 19, 0);

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    frequency: 'weekly',
    interval: 1,
    weekdays: [FRIDAY.getDay()],
    monthlyMode: 'dayOfMonth',
    until: null,
    count: null,
    ...overrides,
  };
}

/** `[2026-07-31, …]` -> `['Jul 31', …]`, so failures read as dates. */
function days(dates: readonly Date[]): string[] {
  return dates.map((date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`);
}

describe('calendar arithmetic', () => {
  it('counts which occurrence of its weekday a date is', () => {
    expect(weekdayOrdinalInMonth(new Date(2026, 6, 1))).toBe(1);
    expect(weekdayOrdinalInMonth(new Date(2026, 6, 7))).toBe(1);
    expect(weekdayOrdinalInMonth(new Date(2026, 6, 8))).toBe(2);
    expect(weekdayOrdinalInMonth(new Date(2026, 6, 21))).toBe(3);
    expect(weekdayOrdinalInMonth(new Date(2026, 6, 31))).toBe(5);
  });

  it('phrases a fifth weekday as "last", because a fifth does not exist every month', () => {
    expect(monthlyWeekdayPosition(new Date(2026, 6, 21))).toBe(3);
    expect(monthlyWeekdayPosition(new Date(2026, 6, 31))).toBe(-1);
  });

  it('finds the nth weekday of a month', () => {
    // July 2026 starts on a Wednesday.
    expect(nthWeekdayOfMonth(2026, 6, 3, 1)).toBe(1); // first Wednesday
    expect(nthWeekdayOfMonth(2026, 6, 4, 1)).toBe(2); // first Thursday
    expect(nthWeekdayOfMonth(2026, 6, 2, 3)).toBe(21); // third Tuesday
    expect(nthWeekdayOfMonth(2026, 6, 5, -1)).toBe(31); // last Friday
  });

  it('returns null when the month has no such occurrence', () => {
    // February 2026 has exactly four of every weekday.
    expect(nthWeekdayOfMonth(2026, 1, 1, 5)).toBeNull();
    expect(nthWeekdayOfMonth(2026, 1, 1, 4)).toBe(23);
  });
});

describe('date-only values', () => {
  it('round-trips a calendar day', () => {
    expect(toDateOnlyValue(FRIDAY)).toBe('2026-07-24');
    expect(fromDateOnlyValue('2026-07-24')).toEqual(new Date(2026, 6, 24));
  });

  it('rejects a date the calendar does not have', () => {
    // The `Date` constructor would roll this forward to 3 March in silence.
    expect(fromDateOnlyValue('2026-02-31')).toBeNull();
    expect(fromDateOnlyValue('2026-13-01')).toBeNull();
    expect(fromDateOnlyValue('nonsense')).toBeNull();
    expect(fromDateOnlyValue('')).toBeNull();
  });
});

describe('normalizeRecurrence', () => {
  it('falls back to the anchor weekday when a weekly rule names no days', () => {
    expect(normalizeRecurrence(rule({ weekdays: [] }), FRIDAY).weekdays).toEqual([5]);
  });

  it('sorts, dedupes and discards impossible weekdays', () => {
    expect(normalizeRecurrence(rule({ weekdays: [3, 1, 3, 9, -1, 1.5] }), FRIDAY).weekdays).toEqual(
      [1, 3],
    );
  });

  it('clears weekdays that no other frequency can mean', () => {
    expect(
      normalizeRecurrence(rule({ frequency: 'monthly', weekdays: [1, 2] }), FRIDAY).weekdays,
    ).toEqual([]);
  });

  it('clamps a nonsensical interval', () => {
    expect(normalizeRecurrence(rule({ interval: 0 }), FRIDAY).interval).toBe(1);
    expect(normalizeRecurrence(rule({ interval: -4 }), FRIDAY).interval).toBe(1);
    expect(normalizeRecurrence(rule({ interval: 5000 }), FRIDAY).interval).toBe(MAX_INTERVAL);
    expect(normalizeRecurrence(rule({ interval: 2.7 }), FRIDAY).interval).toBe(2);
  });

  it('never keeps an end date and a count together, as RFC 5545 requires', () => {
    const both = normalizeRecurrence(rule({ until: '2026-10-20', count: 13 }), FRIDAY);
    expect(both.count).toBe(13);
    expect(both.until).toBeNull();
  });
});

describe('describeRecurrence', () => {
  it('names the presets the way a calendar does', () => {
    expect(describeRecurrence(null, TUESDAY)).toBe('Does not repeat');
    expect(describeRecurrence(rule({ frequency: 'daily' }), TUESDAY)).toBe('Daily');
    expect(describeRecurrence(rule({ weekdays: [2] }), TUESDAY)).toBe('Weekly on Tuesday');
    expect(describeRecurrence(rule({ frequency: 'monthly' }), TUESDAY)).toBe('Monthly on day 21');
    expect(
      describeRecurrence(rule({ frequency: 'monthly', monthlyMode: 'dayOfWeek' }), TUESDAY),
    ).toBe('Monthly on the third Tuesday');
    expect(describeRecurrence(rule({ frequency: 'yearly' }), TUESDAY)).toBe('Annually on July 21');
    expect(describeRecurrence(rule({ weekdays: [1, 2, 3, 4, 5] }), TUESDAY)).toBe(
      'Every weekday (Monday to Friday)',
    );
  });

  it('phrases intervals and multi-day weeks', () => {
    expect(describeRecurrence(rule({ frequency: 'daily', interval: 10 }), TUESDAY)).toBe(
      'Every 10 days',
    );
    expect(describeRecurrence(rule({ interval: 2, weekdays: [1, 3] }), TUESDAY)).toBe(
      'Every 2 weeks on Monday and Wednesday',
    );
    // Three or more days switch to short names so the line stays readable.
    expect(describeRecurrence(rule({ weekdays: [1, 3, 5] }), TUESDAY)).toBe(
      'Weekly on Mon, Wed and Fri',
    );
    expect(
      describeRecurrence(
        rule({ frequency: 'monthly', interval: 3, monthlyMode: 'dayOfWeek' }),
        TUESDAY,
      ),
    ).toBe('Every 3 months on the third Tuesday');
  });

  it('appends the end condition', () => {
    expect(describeRecurrence(rule({ until: '2026-10-20' }), FRIDAY)).toBe(
      'Weekly on Friday, until Oct 20, 2026',
    );
    expect(describeRecurrence(rule({ count: 13 }), FRIDAY)).toBe('Weekly on Friday, 13 times');
    expect(describeRecurrence(rule({ count: 1 }), FRIDAY)).toBe('Weekly on Friday, 1 time');
  });

  it('says "last" for a weekday in the final week of its month', () => {
    const lastFriday = new Date(2026, 6, 31, 19, 0);
    expect(describeMonthlyWeekday(lastFriday)).toBe('the last Friday');
  });
});

describe('recurrencePresets', () => {
  it('phrases every option against the chosen date', () => {
    expect(recurrencePresets(TUESDAY).map((preset) => preset.label)).toEqual([
      'Does not repeat',
      'Daily',
      'Weekly on Tuesday',
      'Monthly on day 21',
      'Monthly on the third Tuesday',
      'Annually on July 21',
      'Every weekday (Monday to Friday)',
    ]);
  });

  it('re-phrases when the date moves', () => {
    expect(recurrencePresets(FRIDAY).map((preset) => preset.label)).toContain(
      'Monthly on the fourth Friday',
    );
    expect(recurrencePresets(FRIDAY).map((preset) => preset.label)).toContain('Weekly on Friday');
  });
});

describe('matchRecurrencePreset', () => {
  it('reopens the dropdown on the entry a rule was saved from', () => {
    expect(matchRecurrencePreset(null, FRIDAY)).toBe('none');
    expect(matchRecurrencePreset(rule(), FRIDAY)).toBe('weekly');
    expect(matchRecurrencePreset(rule({ frequency: 'daily' }), FRIDAY)).toBe('daily');
    expect(matchRecurrencePreset(rule({ weekdays: [1, 2, 3, 4, 5] }), FRIDAY)).toBe('weekdays');
  });

  it('falls to custom for anything the shortlist cannot say', () => {
    expect(matchRecurrencePreset(rule({ interval: 2 }), FRIDAY)).toBe('custom');
    expect(matchRecurrencePreset(rule({ count: 13 }), FRIDAY)).toBe('custom');
    expect(matchRecurrencePreset(rule({ weekdays: [1, 3] }), FRIDAY)).toBe('custom');
  });

  it('follows the anchor: the same rule stops being "weekly" once the day moves', () => {
    expect(matchRecurrencePreset(rule({ weekdays: [5] }), TUESDAY)).toBe('custom');
  });
});

describe('recurrenceOccurrences', () => {
  it('treats the event itself as the first occurrence', () => {
    const found = recurrenceOccurrences(rule(), FRIDAY, { limit: 3 });
    expect(days(found)).toEqual(['2026-7-24', '2026-7-31', '2026-8-7']);
  });

  it('keeps the wall-clock time of the anchor', () => {
    const [, next] = recurrenceOccurrences(rule(), FRIDAY, { limit: 2 });
    expect(next?.getHours()).toBe(19);
    expect(next?.getMinutes()).toBe(0);
  });

  it('walks a daily interval', () => {
    const found = recurrenceOccurrences(rule({ frequency: 'daily', interval: 10 }), FRIDAY, {
      limit: 3,
    });
    expect(days(found)).toEqual(['2026-7-24', '2026-8-3', '2026-8-13']);
  });

  it('fires on every selected day of a multi-day week', () => {
    // Anchor is a Friday; the rule also names Monday and Wednesday.
    const found = recurrenceOccurrences(rule({ weekdays: [1, 3, 5] }), FRIDAY, { limit: 4 });
    expect(days(found)).toEqual(['2026-7-24', '2026-7-27', '2026-7-29', '2026-7-31']);
  });

  it('measures a >1 week interval from the anchor’s own week', () => {
    const found = recurrenceOccurrences(rule({ interval: 2 }), FRIDAY, { limit: 3 });
    expect(days(found)).toEqual(['2026-7-24', '2026-8-7', '2026-8-21']);
  });

  it('skips months too short for a day-of-month rule rather than sliding', () => {
    const jan31 = new Date(2026, 0, 31, 19, 0);
    const found = recurrenceOccurrences(rule({ frequency: 'monthly' }), jan31, { limit: 4 });
    // No 31 February, April, June — the rule means the 31st.
    expect(days(found)).toEqual(['2026-1-31', '2026-3-31', '2026-5-31', '2026-7-31']);
  });

  it('tracks the nth weekday across months of different shapes', () => {
    const found = recurrenceOccurrences(
      rule({ frequency: 'monthly', monthlyMode: 'dayOfWeek' }),
      TUESDAY,
      { limit: 3 },
    );
    // Third Tuesday of July, August, September 2026.
    expect(days(found)).toEqual(['2026-7-21', '2026-8-18', '2026-9-15']);
  });

  it('tracks "last weekday of the month"', () => {
    const lastFriday = new Date(2026, 6, 31, 19, 0);
    const found = recurrenceOccurrences(
      rule({ frequency: 'monthly', monthlyMode: 'dayOfWeek' }),
      lastFriday,
      { limit: 3 },
    );
    expect(days(found)).toEqual(['2026-7-31', '2026-8-28', '2026-9-25']);
  });

  it('skips common years for a 29 February rule', () => {
    const leapDay = new Date(2028, 1, 29, 19, 0);
    const found = recurrenceOccurrences(rule({ frequency: 'yearly' }), leapDay, { limit: 3 });
    expect(days(found)).toEqual(['2028-2-29', '2032-2-29', '2036-2-29']);
  });

  it('stops at the end date, inclusive of the whole day', () => {
    const found = recurrenceOccurrences(rule({ until: '2026-08-07' }), FRIDAY, { limit: 10 });
    expect(days(found)).toEqual(['2026-7-24', '2026-7-31', '2026-8-7']);
  });

  it('counts the anchor toward the total', () => {
    const found = recurrenceOccurrences(rule({ count: 3 }), FRIDAY, { limit: 10 });
    expect(days(found)).toEqual(['2026-7-24', '2026-7-31', '2026-8-7']);
  });

  it('tallies count from the anchor even when asked for a later window', () => {
    // Three total, two of them already past `from` — not three more.
    const found = recurrenceOccurrences(rule({ count: 3 }), FRIDAY, {
      limit: 10,
      from: new Date(2026, 6, 31),
    });
    expect(days(found)).toEqual(['2026-7-31', '2026-8-7']);
  });

  it('terminates on a rule that never lands again', () => {
    // Day 31 of a February-anchored month: nothing after it can match, and the
    // walk has to give up rather than spin.
    const found = recurrenceOccurrences(
      rule({ frequency: 'monthly', until: '2026-02-28' }),
      new Date(2026, 0, 31, 19, 0),
      { limit: 5 },
    );
    expect(days(found)).toEqual(['2026-1-31']);
  });
});

describe('nextRecurrenceOccurrence', () => {
  it('is strictly after the instant asked about', () => {
    expect(days([nextRecurrenceOccurrence(rule(), FRIDAY, FRIDAY)!])).toEqual(['2026-7-31']);
  });

  it('is null once the rule is spent', () => {
    expect(nextRecurrenceOccurrence(rule({ count: 1 }), FRIDAY, FRIDAY)).toBeNull();
    expect(nextRecurrenceOccurrence(rule({ until: '2026-07-25' }), FRIDAY, FRIDAY)).toBeNull();
  });
});

describe('retimeRecurrence', () => {
  it('follows a plain weekly rule to the event’s new day', () => {
    const moved = retimeRecurrence(rule({ weekdays: [5] }), FRIDAY, new Date(2026, 6, 25, 19, 0));
    expect(moved?.weekdays).toEqual([6]);
  });

  it('leaves a deliberately multi-day rule alone', () => {
    const picked = rule({ weekdays: [1, 3] });
    expect(retimeRecurrence(picked, FRIDAY, new Date(2026, 6, 25))).toBe(picked);
  });

  it('leaves rules with no weekday of their own alone', () => {
    const monthly = rule({ frequency: 'monthly' });
    expect(retimeRecurrence(monthly, FRIDAY, new Date(2026, 6, 25))).toBe(monthly);
    expect(retimeRecurrence(null, FRIDAY, new Date(2026, 6, 25))).toBeNull();
  });
});

describe('validateRecurrence', () => {
  it('accepts what the form can produce', () => {
    expect(validateRecurrence(null, FRIDAY)).toBeNull();
    expect(validateRecurrence(rule(), FRIDAY)).toBeNull();
    expect(validateRecurrence(rule({ until: '2026-07-24' }), FRIDAY)).toBeNull();
  });

  it('rejects a weekly rule with every day unticked', () => {
    expect(validateRecurrence(rule({ weekdays: [] }), FRIDAY)).toMatch(/at least one day/);
  });

  it('rejects an end date before the gathering it repeats', () => {
    expect(validateRecurrence(rule({ until: '2026-07-01' }), FRIDAY)).toMatch(/has to end on/);
    expect(validateRecurrence(rule({ until: '' }), FRIDAY)).toMatch(/Pick a date/);
  });
});

describe('suggestedRecurrenceEnd', () => {
  it('offers a horizon proportional to the frequency', () => {
    // The same defaults Google Calendar lands on: 13 weekly occurrences is one
    // school term, and the suggested date is where that tally runs out.
    expect(suggestedRecurrenceEnd(rule(), FRIDAY)).toEqual({
      count: 13,
      until: '2026-10-16',
    });
    expect(suggestedRecurrenceEnd(rule({ frequency: 'yearly' }), FRIDAY)).toEqual({
      count: 5,
      until: '2030-07-24',
    });
  });
});

describe('defaultRuleForFrequency', () => {
  it('seeds a weekly rule with the day the event is on', () => {
    expect(defaultRuleForFrequency('weekly', FRIDAY, null).weekdays).toEqual([5]);
  });

  it('carries the interval and end condition across a frequency change', () => {
    const previous = rule({ interval: 3, count: 8 });
    const next = defaultRuleForFrequency('monthly', FRIDAY, previous);
    expect(next.interval).toBe(3);
    expect(next.count).toBe(8);
    expect(next.weekdays).toEqual([]);
  });
});
