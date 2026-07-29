/**
 * A birthday as three boxes of text, and what they mean.
 *
 * The year is what these are about. Tally is never sent it, so `MM-DD` on its own
 * has to mean "keep the year Planning Center holds" — and that is a request only
 * a student who *has* a birthdate upstream can be the subject of.
 */
import { describe, expect, it } from 'vitest';
import { birthdayFieldsFrom, readBirthdayFields } from '@/lib/birthdayFields';

describe('birthdayFieldsFrom', () => {
  it('opens on the day on file, and never on a year', () => {
    expect(birthdayFieldsFrom('03-14')).toEqual({ month: '3', day: '14', year: '' });
  });

  it('opens empty for a student with no birthdate upstream', () => {
    expect(birthdayFieldsFrom(null)).toEqual({ month: '', day: '', year: '' });
  });
});

describe('readBirthdayFields', () => {
  it('sends the day alone, to be kept against the year upstream', () => {
    expect(readBirthdayFields({ month: '3', day: '16', year: '' }, { onFile: '03-14' })).toEqual({
      ok: true,
      value: '03-16',
    });
  });

  it('sends the whole date once a year is typed', () => {
    expect(readBirthdayFields({ month: '4', day: '2', year: '2013' }, { onFile: null })).toEqual({
      ok: true,
      value: '2013-04-02',
    });
  });

  /**
   * A year on its own is still a change even when the day matches: the day is all
   * Tally was shown, and the year upstream may be the wrong one.
   */
  it('has nothing to send when only the day was shown and it still matches', () => {
    expect(readBirthdayFields({ month: '3', day: '14', year: '' }, { onFile: '03-14' })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      readBirthdayFields({ month: '3', day: '14', year: '2011' }, { onFile: '03-14' }),
    ).toEqual({ ok: true, value: '2011-03-14' });
  });

  it('treats untouched boxes as "leave it alone", never as a deletion', () => {
    expect(readBirthdayFields({ month: '', day: '', year: '' }, { onFile: '03-14' })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(readBirthdayFields({ month: '', day: '', year: '' }, { onFile: null })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it('asks for the year when there is none upstream to keep', () => {
    const read = readBirthdayFields({ month: '4', day: '2', year: '' }, { onFile: null });

    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.error).toMatch(/year/);
  });

  it('will not take half a date, in either direction', () => {
    expect(readBirthdayFields({ month: '4', day: '', year: '' }, { onFile: null }).ok).toBe(false);
    expect(readBirthdayFields({ month: '', day: '2', year: '' }, { onFile: null }).ok).toBe(false);
    expect(readBirthdayFields({ month: '', day: '', year: '2013' }, { onFile: null }).ok).toBe(
      false,
    );
  });

  it('will not take a day that month does not have, or half a year', () => {
    expect(readBirthdayFields({ month: '2', day: '31', year: '' }, { onFile: '03-14' }).ok).toBe(
      false,
    );
    expect(readBirthdayFields({ month: '3', day: '14', year: '13' }, { onFile: null }).ok).toBe(
      false,
    );
  });
});
