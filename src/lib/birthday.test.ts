/**
 * Dates are built with `new Date(y, m, d)` so the suite asserts local
 * wall-clock behaviour and passes in any timezone, like the rest of `lib`.
 */
import { describe, expect, it } from 'vitest';
import {
  birthdayState,
  daysToBirthday,
  formatBirthdayLong,
  formatBirthdayShort,
} from '@/lib/birthday';

/** Sat 14 March 2026. */
const MARCH_14 = new Date(2026, 2, 14, 10, 0);

describe('birthdayState', () => {
  it('calls the day itself today', () => {
    expect(birthdayState('03-14', MARCH_14)).toBe('today');
  });

  it('reaches a week forward and a week back, and stops', () => {
    expect(birthdayState('03-15', MARCH_14)).toBe('soon');
    expect(birthdayState('03-21', MARCH_14)).toBe('soon');
    expect(birthdayState('03-22', MARCH_14)).toBe('quiet');

    expect(birthdayState('03-13', MARCH_14)).toBe('recent');
    expect(birthdayState('03-07', MARCH_14)).toBe('recent');
    expect(birthdayState('03-06', MARCH_14)).toBe('quiet');
  });

  it('says missing when Planning Center holds no birthdate', () => {
    expect(birthdayState(null, MARCH_14)).toBe('missing');
    expect(birthdayState(undefined, MARCH_14)).toBe('missing');
    // A half-typed date upstream reads as missing rather than as some
    // arbitrary day — see `birthdayOf` on the server.
    expect(birthdayState('', MARCH_14)).toBe('missing');
    expect(birthdayState('1990-03-14', MARCH_14)).toBe('missing');
    expect(birthdayState('13-40', MARCH_14)).toBe('missing');
  });

  it('reads across the year boundary in both directions', () => {
    const jan2 = new Date(2026, 0, 2, 9, 0);
    // Three days ago, and last year's date.
    expect(birthdayState('12-30', jan2)).toBe('recent');
    expect(daysToBirthday('12-30', jan2)).toBe(-3);

    const dec29 = new Date(2025, 11, 29, 9, 0);
    // Four days away, and next year's.
    expect(birthdayState('01-02', dec29)).toBe('soon');
    expect(daysToBirthday('01-02', dec29)).toBe(4);
  });

  it('does not care what time of day it is asked', () => {
    expect(birthdayState('03-14', new Date(2026, 2, 14, 0, 1))).toBe('today');
    expect(birthdayState('03-14', new Date(2026, 2, 14, 23, 59))).toBe('today');
    // One minute later is tomorrow, and the birthday was yesterday.
    expect(birthdayState('03-14', new Date(2026, 2, 15, 0, 0))).toBe('recent');
  });

  it('puts a 29 February birthday on 1 March in a year without one', () => {
    // 2026 is not a leap year, so the nearest occurrence is 1 March.
    expect(birthdayState('02-29', new Date(2026, 2, 1, 9, 0))).toBe('today');
    // 2028 is, so it falls where it belongs.
    expect(birthdayState('02-29', new Date(2028, 1, 29, 9, 0))).toBe('today');
  });
});

describe('formatting a birthday', () => {
  it('gives the badge a short form and a sentence a long one', () => {
    expect(formatBirthdayShort('03-14', MARCH_14)).toBe('14 Mar');
    expect(formatBirthdayLong('03-14')).toBe('14 March');
  });

  it('formats 29 February as itself rather than rolling it forward', () => {
    expect(formatBirthdayLong('02-29')).toBe('29 February');
  });

  it('has nothing to say when there is no birthday', () => {
    expect(formatBirthdayShort(null, MARCH_14)).toBeNull();
    expect(formatBirthdayLong(null)).toBeNull();
  });
});
