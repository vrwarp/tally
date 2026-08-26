/**
 * A birthday as one box of text, and what it means.
 *
 * The year is what these are about, and `onFile` is where it comes in: a roster
 * row's `MM-DD` is a day whose year this screen has not been told, while the
 * one-person read's `YYYY-MM-DD` is the whole date and the box opens on it.
 *
 * A day on its own means "keep the year Planning Center holds" either way — and,
 * on a student with no birthdate at all, "store the day with no year", which
 * Planning Center does by keeping 1885 and showing no age. The only date that
 * cannot be stored that way is 29 February, because 1885 does not have one.
 */
import { describe, expect, it } from 'vitest';
import { birthdayFieldFrom, describeBirthdayField, readBirthdayField } from '@/lib/birthdayField';

/** Friday 31 July 2026 — the day these are read against. */
const NOW = new Date(2026, 6, 31, 9, 0);

const read = (text: string, onFile: string | null) => readBirthdayField(text, { onFile, now: NOW });
const note = (text: string, onFile: string | null) =>
  describeBirthdayField(text, { onFile, now: NOW });

describe('birthdayFieldFrom', () => {
  it('opens on the day on file, in the shape the box holds it in', () => {
    expect(birthdayFieldFrom('03-14')).toBe('03 / 14 / ');
  });

  /**
   * The year, where the caller has been given one. Opening on the day alone
   * next to a student Planning Center holds a 2011 for made the box look like a
   * year nobody had filled in, and left a leader who could see the birthday was
   * out by a year with nothing to correct.
   */
  it('opens on the whole date when the details read carried a year', () => {
    expect(birthdayFieldFrom('2011-03-14')).toBe('03 / 14 / 2011');
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

  /**
   * The box that opened on the whole date and was pressed without being
   * touched. It used to carry a day upstream on every Save for the server to
   * find identical; now the form can see that for itself, because it can see
   * the year it is comparing against.
   */
  it('has nothing to send when the whole date on screen is the one on file', () => {
    expect(read('3/14/2011', '2011-03-14')).toEqual({ ok: true, value: undefined });
    expect(read('3/14', '2011-03-14')).toEqual({ ok: true, value: undefined });
  });

  /** A year that differs is the correction this whole change exists for. */
  it('sends the whole date when the year on screen has been changed', () => {
    expect(read('3/14/2012', '2011-03-14')).toEqual({ ok: true, value: '2012-03-14' });
    expect(read('3/16/2011', '2011-03-14')).toEqual({ ok: true, value: '2011-03-16' });
  });

  it('treats an untouched box as "leave it alone", never as a deletion', () => {
    expect(read('', '03-14')).toEqual({ ok: true, value: undefined });
    expect(read('', null)).toEqual({ ok: true, value: undefined });
  });

  it('will not take half a date, or one that does not exist', () => {
    expect(read('12', null).ok).toBe(false);
    expect(read('12 / 14 / 20', null).ok).toBe(false);
    expect(read('2/31', '03-14').ok).toBe(false);
  });
});

describe('describeBirthdayField', () => {
  it('says the date back, so a greedy reading is one somebody can correct', () => {
    expect(note('112', '03-14').say).toMatch(/^2 November/);
    expect(note('1214', null).say).toMatch(/^14 December/);
    expect(note('12 / 14 / 2011', null)).toEqual({ tone: 'good', say: '14 December 2011.' });
  });

  it('says which year a day on its own will be stored against', () => {
    expect(note('4/2', null).say).toMatch(/no year/);
    expect(note('4/2', '03-14').say).toMatch(/keeping the year/);
    expect(note('3/14', '03-14').say).toMatch(/already what Planning Center holds/);
  });

  /**
   * Named, once it is knowable. Rubbing the year out of a box that was showing
   * one is the moment somebody most needs to be told it is being kept — and
   * "the year Planning Center holds" is a sentence written for a screen that
   * had never seen it.
   */
  it('names the year it is keeping when the box was shown one', () => {
    expect(note('4/2', '2011-03-14').say).toMatch(/keeping 2011/);
    expect(note('3/14/2011', '2011-03-14').say).toMatch(/already what Planning Center holds/);
    expect(note('3/14/2012', '2011-03-14')).toEqual({ tone: 'good', say: '14 March 2012.' });
  });

  it('stays quiet while a date is still being typed', () => {
    expect(note('', null).tone).toBe('quiet');
    expect(note('12', null).tone).toBe('quiet');
    expect(note('12 / 14 / 201', null).tone).toBe('quiet');
  });

  it('says so as soon as a date cannot be one', () => {
    expect(note('2/30', null).tone).toBe('bad');
    expect(note('2/29', null).tone).toBe('bad');
    expect(note('12 / 14 / 2999', null).tone).toBe('bad');
  });

  it('says the whole sentence, not just the date', () => {
    // These are the words under the box, and they are the only place the year
    // being optional is ever explained.
    expect(note('', null)).toEqual({
      tone: 'quiet',
      say: 'Just the numbers — the year is optional.',
    });
    expect(note('', '03-14')).toEqual({
      tone: 'quiet',
      say: 'Left empty, the birthday Planning Center holds stays as it is.',
    });
  });

  it('tells a half-typed year from a half-typed date', () => {
    expect(note('12', null)).toEqual({ tone: 'quiet', say: 'Keep going.' });
    expect(note('12 / 14 / 201', null)).toEqual({
      tone: 'quiet',
      say: 'Keep going, or leave the year out.',
    });
  });

  it('spells out the sentence for a day with no year', () => {
    expect(note('4/2', null)).toEqual({
      tone: 'good',
      say: '2 April, with no year. Planning Center will show no age.',
    });
    expect(note('4/2', '03-14')).toEqual({
      tone: 'good',
      say: '2 April, keeping the year Planning Center holds.',
    });
    expect(note('4/2', '2011-03-14')).toEqual({ tone: 'good', say: '2 April, keeping 2011.' });
  });

  it('spells out the unchanged sentence, with and without a year', () => {
    expect(note('3/14', '03-14')).toEqual({
      tone: 'good',
      say: '14 March — already what Planning Center holds.',
    });
    expect(note('3/14/2011', '2011-03-14')).toEqual({
      tone: 'good',
      say: '14 March 2011 — already what Planning Center holds.',
    });
  });

  it('names each refusal in its own words', () => {
    expect(note('2/30', null).say).toBe('That day does not exist in that month.');
    expect(note('2/29/2011', null).say).toBe('February had no 29th in that year.');
    expect(note('3/14/2999', null).say).toBe('That year has not happened yet.');
    expect(note('3/14/1600', null).say).toBe('Years run from 1900 to now.');
  });

  it('refuses a leap day only where there is genuinely no year to hang it on', () => {
    // `onFile === null` and not "no year in onFile": a bare `MM-DD` is the
    // roster's day, whose year upstream this screen has not been told, and
    // refusing there would turn that into a wrong error on a real 29 February.
    expect(note('2/29', null).tone).toBe('bad');
    expect(note('2/29', '03-14').tone).toBe('good');
    expect(note('2/29', '2011-03-14').tone).toBe('good');
    expect(note('2/29/2012', null).tone).toBe('good');
  });

  it('reads against the caller’s clock, not the wall clock', () => {
    // Every screen that draws this passes `now`, and a future year is decided
    // against it. Falling back to the real clock would make the test that
    // proves it pass for the wrong reason.
    expect(describeBirthdayField('3/14/2026', { onFile: null, now: new Date(2025, 0, 1) }).tone)
      .toBe('bad');
    expect(describeBirthdayField('3/14/2026', { onFile: null, now: NOW }).tone).toBe('good');
  });
});

describe('the sentences a refusal gets', () => {
  it('reaches readBirthdayField as well as the note under the box', () => {
    // The form paints these under the box; the server refuses the same things
    // in its own voice. Both have to be checkable from here.
    expect(read('2/30', null)).toEqual({
      ok: false,
      error: 'That day does not exist in that month.',
    });
    expect(read('2/29/2011', null)).toEqual({
      ok: false,
      error: 'February had no 29th in that year.',
    });
    expect(read('3/14/2999', null)).toEqual({
      ok: false,
      error: 'That year has not happened yet.',
    });
    expect(read('3/14/1600', null)).toEqual({ ok: false, error: 'Years run from 1900 to now.' });
  });

  it('tells half a year from half a date', () => {
    expect(read('12 / 14 / 20', null)).toEqual({
      ok: false,
      error: 'Finish the year, or take it out — a birthday can go in without one.',
    });
    expect(read('12', null)).toEqual({
      ok: false,
      error: 'That is half a date. Give a month and a day at least.',
    });
  });

  it('names what Planning Center cannot hold, and why', () => {
    expect(read('2/29', null)).toEqual({
      ok: false,
      error:
        'Planning Center cannot hold 29 February without a year, and it has none for them. Give the year too.',
    });
  });

  it('reads against the caller’s clock', () => {
    expect(readBirthdayField('3/14/2026', { onFile: null, now: new Date(2025, 0, 1) }).ok).toBe(
      false,
    );
    expect(readBirthdayField('3/14/2026', { onFile: null, now: NOW }).ok).toBe(true);
  });
});
