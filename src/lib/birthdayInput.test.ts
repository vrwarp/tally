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
  birthdaySlots,
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

describe('where the next digit would land', () => {
  it('counts the slots off as they close', () => {
    expect(birthdaySlots('').at).toBe(0);
    expect(birthdaySlots('1').at).toBe(0);
    expect(birthdaySlots('4').at).toBe(1);
    expect(birthdaySlots('45').at).toBe(2);
    expect(birthdaySlots('12142011').at).toBe(3);
  });

  it('has nowhere left once the year is whole', () => {
    // The difference between `3` and `2` here is whether the box prints a
    // separator after the year and keeps offering `Y`s.
    const full = birthdaySlots('12142011');

    expect(full).toEqual({ month: '12', day: '14', year: '2011', at: 3 });
  });

  it('drops a digit typed after a whole date rather than mangling one', () => {
    // Nothing left to hold it: eight digits is a date, and a ninth belongs to
    // nobody.
    expect(birthdaySlots('121420119')).toEqual({
      month: '12',
      day: '14',
      year: '2011',
      at: 3,
    });
    expect(formatBirthdayInput('121420119')).toBe('12 / 14 / 2011');
  });

  it('drops a separator typed after a whole date too', () => {
    expect(birthdaySlots('12142011//9')).toEqual({
      month: '12',
      day: '14',
      year: '2011',
      at: 3,
    });
  });

  it('spills a second zero to the day rather than making the month "00"', () => {
    // `00` is not a month, so the first zero opens the month and the second
    // cannot extend it — it starts the day, and the sentence underneath says
    // the date is unfinished rather than refusing it.
    expect(birthdaySlots('00')).toEqual({ month: '0', day: '0', year: '', at: 1 });
    expect(read('00')).toEqual({ state: 'partial', year: false });
  });

  it('keeps the leading zeros of a year somebody typed', () => {
    // `0099` is not 99: the box shows what was typed, and the sentence
    // underneath refuses it as a year rather than silently improving it.
    expect(birthdaySlots('12250099')).toEqual({
      month: '12',
      day: '25',
      year: '0099',
      at: 3,
    });
    expect(read('12250099')).toEqual({ state: 'impossible', reason: 'early-year' });
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

  it('refuses a two-digit month that is not one, digit by digit', () => {
    // `13` is not a month, so the 1 is January and the 3 starts the day. A box
    // that accepted `13` would have to change its mind about the month later.
    expect(birthdaySlots('134')).toEqual({ month: '1', day: '3', year: '4', at: 2 });
    expect(birthdaySlots('1312')).toEqual({ month: '1', day: '31', year: '2', at: 2 });
  });

  it('reads a child born this year', () => {
    // The boundary is inclusive on purpose: a nursery register is the one place
    // a birthday in the current year is ordinary.
    expect(read(`0114${NOW.getFullYear()}`)).toEqual({
      state: 'read',
      month: 1,
      day: 14,
      year: NOW.getFullYear(),
    });
    expect(read(`0114${NOW.getFullYear() + 1}`)).toEqual({
      state: 'impossible',
      reason: 'future-year',
    });
  });

  it('reads the earliest year it allows, and refuses the one before it', () => {
    expect(read('01141900')).toEqual({ state: 'read', month: 1, day: 14, year: 1900 });
    expect(read('01141899')).toEqual({ state: 'impossible', reason: 'early-year' });
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

  it('waits through a slot holding a lone zero', () => {
    // `0` is the first digit of `01`, not the zeroth month or the zeroth day.
    // Saying "no such day" here would be an error that clears on the next
    // keystroke, which teaches nothing and reads as a fault.
    expect(read('0/5')).toEqual({ state: 'partial', year: false });
    expect(read('120')).toEqual({ state: 'partial', year: false });
    expect(read('12/0/2011')).toEqual({ state: 'partial', year: false });
  });

  /** The year is the half somebody may mean to leave out, so it says so. */
  it('knows the year is what is unfinished', () => {
    expect(read('12142')).toEqual({ state: 'partial', year: true });
    expect(read('1214')).toEqual({ state: 'read', month: 12, day: 14, year: null });
    expect(read('12')).toEqual({ state: 'partial', year: false });
  });
});

describe('the shape still owed', () => {
  it('offers nothing more once the year is whole', () => {
    expect(birthdayMaskGhost('12142011')).toBe('');
  });

  it('offers nothing more once a separator has closed the year', () => {
    // The year slot is closed at two digits by the slash, and a ghost that
    // carried on offering `YY` would be inviting digits the box will drop.
    expect(birthdaySlots('12/25/20/').at).toBe(3);
    expect(birthdayMaskGhost('12/25/20/')).toBe('');
  });

  it('counts down the year one digit at a time', () => {
    expect(birthdayMaskGhost('1214')).toBe('YYYY');
    expect(birthdayMaskGhost('12142')).toBe('YYY');
    expect(birthdayMaskGhost('121420')).toBe('YY');
    expect(birthdayMaskGhost('1214201')).toBe('Y');
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
