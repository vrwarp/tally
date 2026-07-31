/**
 * A birthday as one box of text, and what it means.
 *
 * The year is what these are about. Tally is never sent it, so a day on its own
 * has to mean "keep the year Planning Center holds" — and, on a student with no
 * birthdate at all, "store the day with no year", which Planning Center does by
 * keeping 1885 and showing no age. The only date that cannot be stored that way
 * is 29 February, because 1885 does not have one.
 */
import { describe, expect, it } from 'vitest';
import { birthdayFieldFrom, describeBirthdayField, readBirthdayField } from '@/lib/birthdayField';

/** Friday 31 July 2026 — the day these are read against. */
const NOW = new Date(2026, 6, 31, 9, 0);

const read = (text: string, onFile: string | null) => readBirthdayField(text, { onFile, now: NOW });
const note = (text: string, onFile: string | null) =>
  describeBirthdayField(text, { onFile, now: NOW });

describe('birthdayFieldFrom', () => {
  it('opens on the day on file, written the way it would be typed back', () => {
    expect(birthdayFieldFrom('03-14')).toBe('3/14');
  });

  it('opens empty for a student with no birthdate upstream', () => {
    expect(birthdayFieldFrom(null)).toBe('');
  });
});

describe('readBirthdayField', () => {
  it('sends the day alone, to be kept against the year upstream', () => {
    expect(read('3/16', '03-14')).toEqual({ ok: true, value: '03-16' });
  });

  it('sends the whole date once a year is typed', () => {
    expect(read('4/2/2013', null)).toEqual({ ok: true, value: '2013-04-02' });
  });

  /**
   * The refusal this form used to open with. Planning Center holds a birthday
   * with no year perfectly well, so demanding one from a leader who has just
   * been told "December the fourteenth" was Tally inventing a requirement.
   */
  it('takes a day with no year on a student who has no birthdate at all', () => {
    expect(read('4/2', null)).toEqual({ ok: true, value: '04-02' });
  });

  /** 1885, the year Planning Center keeps for "no year", has no 29 February. */
  it('asks for the year for a leap day it would have nowhere to put', () => {
    const refused = read('2/29', null);

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/29 February/);
    expect(read('2/29', '03-14')).toEqual({ ok: true, value: '02-29' });
    expect(read('2/29/2012', null)).toEqual({ ok: true, value: '2012-02-29' });
  });

  /**
   * A year on its own is still a change even when the day matches: the day is
   * all Tally was shown, and the year upstream may be the wrong one.
   */
  it('has nothing to send when only the day was shown and it still matches', () => {
    expect(read('3/14', '03-14')).toEqual({ ok: true, value: undefined });
    expect(read('3/14/2011', '03-14')).toEqual({ ok: true, value: '2011-03-14' });
  });

  it('treats an untouched box as "leave it alone", never as a deletion', () => {
    expect(read('', '03-14')).toEqual({ ok: true, value: undefined });
    expect(read('', null)).toEqual({ ok: true, value: undefined });
  });

  it('will not take half a date, or one that does not exist', () => {
    expect(read('12', null).ok).toBe(false);
    expect(read('2/31', '03-14').ok).toBe(false);
    expect(read('nonsense', null).ok).toBe(false);
  });
});

describe('describeBirthdayField', () => {
  it('says the date back, so a greedy reading is one somebody can correct', () => {
    expect(note('112', '03-14').say).toMatch(/^2 November/);
    expect(note('1214', null).say).toMatch(/^14 December/);
    expect(note('12/14/2011', null)).toEqual({ tone: 'good', say: '14 December 2011.' });
  });

  it('says which year a day on its own will be stored against', () => {
    expect(note('4/2', null).say).toMatch(/no year/);
    expect(note('4/2', '03-14').say).toMatch(/keeping the year/);
    expect(note('3/14', '03-14').say).toMatch(/already what Planning Center holds/);
  });

  it('stays quiet while a date is still being typed', () => {
    expect(note('', null).tone).toBe('quiet');
    expect(note('12', null).tone).toBe('quiet');
    expect(note('12/14/201', null).tone).toBe('quiet');
  });

  it('says so as soon as a date cannot be one', () => {
    expect(note('2/30', null).tone).toBe('bad');
    expect(note('2/29', null).tone).toBe('bad');
    expect(note('12/14/2999', null).tone).toBe('bad');
  });
});
