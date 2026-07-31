/**
 * One box, punctuating itself as somebody types into it.
 *
 * Three things come off the same walk over the digits — where the slashes go,
 * what is still owed, and what date it adds up to — so most of these check that
 * the three agree. The greedy cases are the ones worth pinning: `112` is 2
 * November because the month takes two digits whenever two digits are a month,
 * and `13` is 3 January because thirteen is not one.
 */
import { describe, expect, it } from 'vitest';
import {
  birthdayMaskGhost,
  formatBirthdayInput,
  parseBirthdayInput,
} from '@/lib/birthdayInput';

/** Friday 31 July 2026 — the day these are read against. */
const NOW = new Date(2026, 6, 31, 9, 0);

const read = (raw: string) => parseBirthdayInput(raw, NOW);
const state = (raw: string) => read(raw).state;
/** What the box shows in total: the value, then the faded rest of the shape. */
const shown = (raw: string) => formatBirthdayInput(raw) + birthdayMaskGhost(raw);

describe('the box as it fills up', () => {
  it('lays the shape out before anything is typed', () => {
    expect(formatBirthdayInput('')).toBe('');
    expect(birthdayMaskGhost('')).toBe('MM / DD / YYYY');
  });

  it('puts the separators in, and keeps the shape whole while it does', () => {
    expect(shown('1')).toBe('1M / DD / YYYY');
    expect(shown('12')).toBe('12 / DD / YYYY');
    expect(shown('121')).toBe('12 / 1D / YYYY');
    expect(shown('1214')).toBe('12 / 14 / YYYY');
    expect(shown('12142')).toBe('12 / 14 / 2YYY');
    expect(shown('12142011')).toBe('12 / 14 / 2011');
  });

  /**
   * The escape hatch the greed needs. `422013` is 22 April; the slash after the
   * 2 is how somebody says they meant the second.
   */
  it('lets a typed separator close a slot early', () => {
    expect(shown('4/2/2013')).toBe('4 / 2 / 2013');
    expect(shown('422013')).toBe('4 / 22 / 013Y');
    expect(shown('1/')).toBe('1 / DD / YYYY');
    expect(shown('1/1')).toBe('1 / 1D / YYYY');
  });

  /** Whatever it prints has to come back in unchanged, or a keystroke moves it. */
  it('is unchanged by being formatted again', () => {
    for (const raw of ['1', '12', '4', '4/', '1/1', '12142011', '2/29/2012']) {
      const once = formatBirthdayInput(raw);

      expect(formatBirthdayInput(once), raw).toBe(once);
      expect(birthdayMaskGhost(once), raw).toBe(birthdayMaskGhost(raw));
    }
  });

  /**
   * A slot stops taking digits the moment no second digit could land in it, so
   * `4` is April rather than a month still waiting to become the forty-fifth.
   */
  it('closes a slot early when no second digit could fit', () => {
    expect(shown('4')).toBe('4 / DD / YYYY');
    expect(shown('45')).toBe('4 / 5 / YYYY');
    expect(shown('1234')).toBe('12 / 3 / 4YYY');
  });

  it('takes what was already punctuated back without moving it', () => {
    expect(formatBirthdayInput('12 / 14 / 2011')).toBe('12 / 14 / 2011');
    expect(formatBirthdayInput('12/14/2011')).toBe('12 / 14 / 2011');
  });

  it('stops at the eight digits a date has', () => {
    expect(formatBirthdayInput('121420119999')).toBe('12 / 14 / 2011');
  });
});

describe('the date it adds up to', () => {
  /** The instruction this whole thing was written to obey. */
  it('is greedy about the month, so 112 is 2 November', () => {
    expect(read('112')).toEqual({ state: 'read', month: 11, day: 2, year: null });
    expect(formatBirthdayInput('112')).toBe('11 / 2');
    expect(read('11/2')).toEqual({ state: 'read', month: 11, day: 2, year: null });
  });

  it('falls back to a one-digit month only when two are not a month', () => {
    expect(read('131')).toEqual({ state: 'read', month: 1, day: 31, year: null });
    expect(read('45')).toEqual({ state: 'read', month: 4, day: 5, year: null });
    expect(read('229')).toEqual({ state: 'read', month: 2, day: 29, year: null });
  });

  it('reads the same date however it arrived', () => {
    for (const raw of ['1212', '12/12', '12-12', '12 / 12']) {
      expect(read(raw), raw).toEqual({ state: 'read', month: 12, day: 12, year: null });
    }
  });

  it('never disagrees with what the box is showing', () => {
    for (const digits of ['112', '1212', '45', '131', '12142011']) {
      const reading = read(digits);
      const displayed = formatBirthdayInput(digits);

      expect(reading.state, digits).toBe('read');
      // The formatted value parses back to the same date: the separators the box
      // put in are the reading it made, written down.
      expect(read(displayed), displayed).toEqual(reading);
    }
  });

  it('takes the year when the whole of it is there', () => {
    expect(read('12142011')).toEqual({ state: 'read', month: 12, day: 14, year: 2011 });
  });
});

describe('what is not finished yet', () => {
  it('says nothing about an empty box', () => {
    expect(state('')).toBe('empty');
    expect(state('   ')).toBe('empty');
  });

  it('waits through a month with no day', () => {
    expect(state('1')).toBe('partial');
    expect(state('12')).toBe('partial');
    expect(state('0')).toBe('partial');
  });

  /** The year is the half somebody may mean to leave out, so it says so. */
  it('knows the year is what is unfinished', () => {
    expect(read('12142')).toEqual({ state: 'partial', year: true });
    expect(read('1214')).toEqual({ state: 'read', month: 12, day: 14, year: null });
    expect(read('12')).toEqual({ state: 'partial', year: false });
  });
});

describe('dates that cannot be', () => {
  it('separates a day the month never has from a year that cannot be one', () => {
    expect(read('230')).toEqual({ state: 'impossible', reason: 'no-such-day' });
    expect(read('431')).toEqual({ state: 'impossible', reason: 'no-such-day' });
    expect(read('12142999')).toEqual({ state: 'impossible', reason: 'future-year' });
    expect(read('12141800')).toEqual({ state: 'impossible', reason: 'early-year' });
  });

  /** 29 February is a birthday people have, until a year says otherwise. */
  it('keeps a leap day open until a year closes it', () => {
    expect(read('229')).toEqual({ state: 'read', month: 2, day: 29, year: null });
    expect(read('2/29/2012')).toEqual({ state: 'read', month: 2, day: 29, year: 2012 });
    expect(read('02292011')).toEqual({ state: 'impossible', reason: 'not-that-year' });
  });
});
