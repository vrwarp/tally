/**
 * One box, and every shape a birthday arrives in.
 *
 * The cases worth pinning are the greedy ones and the half-typed ones: `112` is
 * 2 November because the month is taken longest-first, and `12` is not yet
 * anything at all. The second is what makes live feedback bearable — a form
 * that shouted on the first keystroke would teach a leader to ignore it.
 */
import { describe, expect, it } from 'vitest';
import { parseBirthdayInput } from '@/lib/birthdayInput';

/** Friday 31 July 2026 — the day these are read against. */
const NOW = new Date(2026, 6, 31, 9, 0);

const read = (raw: string) => parseBirthdayInput(raw, NOW);
const state = (raw: string) => read(raw).state;

describe('separators', () => {
  it('reads the same date however it was punctuated', () => {
    for (const raw of ['12/12', '12-12', '12.12', '12 12', '1212', '12,12']) {
      expect(read(raw), raw).toEqual({ state: 'read', month: 12, day: 12, year: null });
    }
  });

  it('is not thrown by the spaces around a date somebody pasted', () => {
    expect(read('  12 / 14  ')).toEqual({ state: 'read', month: 12, day: 14, year: null });
  });
});

describe('a bare run of digits', () => {
  /** The instruction this whole parser was written to obey. */
  it('is greedy about the month, so 112 is 2 November', () => {
    expect(read('112')).toEqual({ state: 'read', month: 11, day: 2, year: null });
  });

  it('falls back to a one-digit month only when two are not a month', () => {
    expect(read('131')).toEqual({ state: 'read', month: 1, day: 31, year: null });
    expect(read('45')).toEqual({ state: 'read', month: 4, day: 5, year: null });
    expect(read('229')).toEqual({ state: 'read', month: 2, day: 29, year: null });
  });

  it('takes a leading zero as part of the month', () => {
    expect(read('0102')).toEqual({ state: 'read', month: 1, day: 2, year: null });
  });

  it('takes a whole year off the end', () => {
    expect(read('12142011')).toEqual({ state: 'read', month: 12, day: 14, year: 2011 });
  });

  /** `12|12|011` has no year in it, so the day gives a digit back. */
  it('gives up the second digit of the day to make the year work', () => {
    expect(read('1212011')).toEqual({ state: 'read', month: 12, day: 1, year: 2011 });
  });

  it('reads a pasted ISO date, without mistaking 12122011 for the year 1212', () => {
    expect(read('20111214')).toEqual({ state: 'read', month: 12, day: 14, year: 2011 });
    expect(read('12122011')).toEqual({ state: 'read', month: 12, day: 12, year: 2011 });
  });

  /**
   * The month is decided once, from the front. Re-reading `12` as January the
   * moment the day failed would swing the date under the box from December to
   * January and back on consecutive keystrokes.
   */
  it('does not re-read the month when the rest of the run is not ready', () => {
    expect(state('120')).toBe('partial');
    expect(state('1212')).toBe('read');
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
    expect(state('12/')).toBe('partial');
  });

  it('waits through a year being typed rather than calling it a mistake', () => {
    expect(state('12/14/2')).toBe('partial');
    expect(state('12/14/201')).toBe('partial');
    expect(state('12120')).toBe('partial');
    expect(state('121201')).toBe('partial');
  });

  it('waits through a month name being typed', () => {
    expect(state('j')).toBe('partial');
    expect(state('ju')).toBe('partial');
    expect(state('dec')).toBe('partial');
  });
});

describe('a month somebody spelled', () => {
  it('takes a name, an abbreviation or a prefix of one', () => {
    expect(read('dec 14')).toEqual({ state: 'read', month: 12, day: 14, year: null });
    expect(read('December 14')).toEqual({ state: 'read', month: 12, day: 14, year: null });
    expect(read('sept 3')).toEqual({ state: 'read', month: 9, day: 3, year: null });
    expect(read('may 1')).toEqual({ state: 'read', month: 5, day: 1, year: null });
  });

  it('does not mind which side the day is on, or an ordinal on it', () => {
    expect(read('14 December 2011')).toEqual({ state: 'read', month: 12, day: 14, year: 2011 });
    expect(read('December 14th, 2011')).toEqual({ state: 'read', month: 12, day: 14, year: 2011 });
    expect(read('2011 December 14')).toEqual({ state: 'read', month: 12, day: 14, year: 2011 });
  });

  it('refuses a word that is not a month', () => {
    expect(state('hello')).toBe('unreadable');
    expect(state('dec 14 tuesday')).toBe('unreadable');
  });
});

describe('the year', () => {
  it('is optional', () => {
    expect(read('12/14')).toEqual({ state: 'read', month: 12, day: 14, year: null });
  });

  it('expands two digits around today', () => {
    expect(read('12/14/11')).toEqual({ state: 'read', month: 12, day: 14, year: 2011 });
    expect(read('12/14/26')).toEqual({ state: 'read', month: 12, day: 14, year: 2026 });
    expect(read('12/14/99')).toEqual({ state: 'read', month: 12, day: 14, year: 1999 });
  });

  it('refuses one that has not happened, or one nobody on a roster was born in', () => {
    expect(read('12/14/2999')).toEqual({ state: 'impossible', reason: 'future-year' });
    expect(read('12/14/1800')).toEqual({ state: 'impossible', reason: 'early-year' });
  });
});

describe('days that do not exist', () => {
  it('separates a day the month never has from something unreadable', () => {
    expect(read('2/30')).toEqual({ state: 'impossible', reason: 'no-such-day' });
    expect(read('4/31')).toEqual({ state: 'impossible', reason: 'no-such-day' });
  });

  /** 29 February is a birthday people have, until a year says otherwise. */
  it('keeps a leap day open until a year closes it', () => {
    expect(read('2/29')).toEqual({ state: 'read', month: 2, day: 29, year: null });
    expect(read('2/29/2012')).toEqual({ state: 'read', month: 2, day: 29, year: 2012 });
    expect(read('2/29/2011')).toEqual({ state: 'impossible', reason: 'not-that-year' });
  });

  it('refuses more numbers than a date has', () => {
    expect(state('12/14/2011/9')).toBe('unreadable');
  });
});
