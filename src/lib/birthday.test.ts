/**
 * Dates are built with `new Date(y, m, d)` so the suite asserts local
 * wall-clock behaviour and passes in any timezone, like the rest of `lib`.
 */
import { describe, expect, it } from 'vitest';
import {
  birthdayParts,
  birthdayState,
  birthdayYear,
  composeBirthday,
  daysToBirthday,
  formatBirthdayLong,
  formatBirthdayShort,
  isRealBirthday,
  parseBirthday,
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

  it('settles a birthday exactly half a year away the same way every time', () => {
    // Two candidates can be equidistant: 2 July is 183 days either side of
    // 1 January 2024, because a leap day sits between last year's occurrence
    // and this year's. The first candidate wins, which is the one behind — and
    // it is 'quiet' either way, so what this pins is only that the sign
    // `daysToBirthday` hands its callers does not depend on a tiebreak nobody
    // wrote down.
    expect(daysToBirthday('07-02', new Date(2024, 0, 1))).toBe(-183);
    expect(birthdayState('07-02', new Date(2024, 0, 1))).toBe('quiet');
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

describe('taking a birthday apart', () => {
  it('gives the edit form its two boxes back', () => {
    expect(birthdayParts('03-14')).toEqual({ month: 3, day: 14 });
    expect(birthdayParts('12-01')).toEqual({ month: 12, day: 1 });
  });

  it('has nothing to hand back when there is no birthday on file', () => {
    expect(birthdayParts(null)).toBeNull();
    expect(birthdayParts(undefined)).toBeNull();
    expect(birthdayParts('')).toBeNull();
    // A roster row never carries a year, so a date that has one did not come
    // from where this reader thinks it did, and reads as absent rather than
    // being trusted. `parseBirthday` is the one that knows what a year means.
    expect(birthdayParts('2011-03-14')).toBeNull();
    expect(birthdayParts('13-40')).toBeNull();
  });

  it('refuses each half of an impossible date on its own', () => {
    // The pattern only says "two digits": `00` and `99` both match it, so
    // every one of these bounds is reachable from a real stored value.
    expect(birthdayParts('00-14')).toBeNull();
    expect(birthdayParts('13-14')).toBeNull();
    expect(birthdayParts('03-00')).toBeNull();
    expect(birthdayParts('03-32')).toBeNull();
  });

  it('keeps the days at either end of the range', () => {
    expect(birthdayParts('01-01')).toEqual({ month: 1, day: 1 });
    expect(birthdayParts('12-31')).toEqual({ month: 12, day: 31 });
  });

  it('refuses each half of an impossible dated birthday too', () => {
    expect(parseBirthday('2011-00-14')).toBeNull();
    expect(parseBirthday('2011-13-14')).toBeNull();
    expect(parseBirthday('2011-03-00')).toBeNull();
    expect(parseBirthday('2011-03-32')).toBeNull();
  });

  it('keeps the ends of the range with a year on them', () => {
    expect(parseBirthday('2011-01-01')).toEqual({ month: 1, day: 1, year: 2011 });
    expect(parseBirthday('2011-12-31')).toEqual({ month: 12, day: 31, year: 2011 });
  });

  it('refuses a string that is not a date at all', () => {
    expect(parseBirthday('')).toBeNull();
    expect(parseBirthday('March 14')).toBeNull();
    expect(parseBirthday('3-14')).toBeNull();
    expect(parseBirthday('11-03-14')).toBeNull();
  });

  /**
   * The other reader, for the screens that have asked Planning Center about one
   * student and been given the whole date. Both shapes, because which one
   * arrives depends on whether that read has landed — and on whether anybody
   * upstream knows the year at all.
   */
  it('reads the whole date where one was handed over', () => {
    expect(parseBirthday('2011-03-14')).toEqual({ month: 3, day: 14, year: 2011 });
    expect(parseBirthday('03-14')).toEqual({ month: 3, day: 14, year: null });
    expect(parseBirthday('2011-13-40')).toBeNull();
    expect(parseBirthday(null)).toBeNull();

    expect(birthdayYear('2011-03-14')).toBe(2011);
    expect(birthdayYear('03-14')).toBeNull();
    expect(birthdayYear(null)).toBeNull();
  });

  it('says a date with its year, and a day without one', () => {
    expect(formatBirthdayLong('2011-03-14')).toBe('14 March 2011');
    expect(formatBirthdayLong('03-14')).toBe('14 March');
    expect(formatBirthdayLong(null)).toBeNull();
  });
});

describe('isRealBirthday', () => {
  it('accepts the days each month actually has', () => {
    expect(isRealBirthday(1, 31)).toBe(true);
    expect(isRealBirthday(4, 31)).toBe(false);
    expect(isRealBirthday(2, 30)).toBe(false);
  });

  /**
   * The year is optional, so 29 February has to be a day somebody can type
   * before they have said which year they mean.
   */
  it('takes February at its leap-year length without a year', () => {
    expect(isRealBirthday(2, 29)).toBe(true);
  });

  it('checks the real February once a year is given', () => {
    expect(isRealBirthday(2, 29, 2008)).toBe(true);
    expect(isRealBirthday(2, 29, 2011)).toBe(false);
    // Divisible by 100 and not by 400, so not a leap year.
    expect(isRealBirthday(2, 29, 1900)).toBe(false);
    expect(isRealBirthday(2, 29, 2000)).toBe(true);
  });

  it('refuses a month or a day that is not one', () => {
    expect(isRealBirthday(0, 14)).toBe(false);
    expect(isRealBirthday(13, 14)).toBe(false);
    expect(isRealBirthday(3, 0)).toBe(false);
    expect(isRealBirthday(3, 14.5)).toBe(false);
    expect(isRealBirthday(3.5, 14)).toBe(false);
  });

  it('keeps the first day of the first month, and the last of the last', () => {
    // The bounds are inclusive at both ends, and 1 January is a birthday.
    expect(isRealBirthday(1, 1)).toBe(true);
    expect(isRealBirthday(12, 31)).toBe(true);
  });

  it('checks the month’s own length against the year, not February’s', () => {
    // The year narrows February and nothing else: a 31-day month stays 31 days
    // long in every year there has ever been.
    expect(isRealBirthday(1, 31, 2011)).toBe(true);
    expect(isRealBirthday(4, 31, 2011)).toBe(false);
    expect(isRealBirthday(2, 28, 2011)).toBe(true);
  });

  it('refuses a year that is not a whole number', () => {
    expect(isRealBirthday(3, 14, 2011.5)).toBe(false);
  });

  it('refuses a year of birth before anybody alive was born', () => {
    expect(isRealBirthday(3, 14, 1899)).toBe(false);
    expect(isRealBirthday(3, 14, 1900)).toBe(true);
  });
});

describe('composeBirthday', () => {
  /**
   * Two shapes, and the difference is the whole point: `MM-DD` asks the server
   * to keep the year Planning Center holds, because Tally was never shown it.
   */
  it('leaves the year out when it was not given', () => {
    expect(composeBirthday({ month: 3, day: 14 })).toBe('03-14');
    expect(composeBirthday({ month: 3, day: 14, year: null })).toBe('03-14');
  });

  it('pads a single-digit month and day', () => {
    expect(composeBirthday({ month: 1, day: 9, year: 2011 })).toBe('2011-01-09');
  });

  it('has nothing to send for a date that does not exist', () => {
    expect(composeBirthday({ month: 2, day: 31 })).toBeNull();
    expect(composeBirthday({ month: 2, day: 29, year: 2011 })).toBeNull();
  });
});
