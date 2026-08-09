/**
 * What reaches a sticker, for the child whose name is in two scripts.
 *
 * The case that made this file: `Student.firstName` holds the composite the
 * roster row shows — `Benson “蔡秉洲”` — and for the first weeks of label
 * printing that string went onto the label whole, curly quotes and all, on the
 * `xl` line that exists to be read across a room. Nobody chose that; the token
 * was a pass-through of a field whose shape had been decided elsewhere, for
 * search. These tests pin the halves apart so it cannot quietly become a
 * pass-through again.
 */
import { describe, expect, it } from 'vitest';

import { tokenValuesFor } from './tokens';
import type { KioskBinding } from '../binding';
import type { KioskStudent } from '../search';

function student(overrides: Partial<KioskStudent> = {}): KioskStudent {
  return {
    id: 'student-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    grade: 8,
    searchName: 'ada lovelace',
    hasAllergies: false,
    ...overrides,
  };
}

const BINDING: KioskBinding = {
  eventId: 'nursery-today',
  seriesId: null,
  title: 'Sunday Nursery',
  startAtMs: 0,
  endAtMs: 0,
  checkInClosesAtMs: 0,
  requiresCheckOut: true,
  labelTemplate: null,
  boundAtMs: 0,
};

describe('tokenValuesFor', () => {
  it('splits the stored composite into a first name and a nickname', () => {
    const values = tokenValuesFor(student({ firstName: 'Benson “蔡秉洲”' }), BINDING);

    expect(values.firstName).toBe('Benson');
    expect(values.nickname).toBe('蔡秉洲');
  });

  it('leaves a plain first name alone and reports no nickname', () => {
    const values = tokenValuesFor(student({ firstName: 'Ada' }), BINDING);

    expect(values.firstName).toBe('Ada');
    // Empty rather than absent: the kiosk looked, and there is none.
    expect(values.nickname).toBe('');
  });

  it('never puts the quotes on a label', () => {
    // The regression itself, stated in the terms the label cares about: whatever
    // the roster row holds, nothing typographic reaches the sticker.
    for (const name of ['Benson “蔡秉洲”', 'Jonathan “Jonny”', 'Ada']) {
      const values = tokenValuesFor(student({ firstName: name }), BINDING);
      expect(values.firstName).not.toMatch(/[“”"]/);
      expect(values.nickname).not.toMatch(/[“”"]/);
    }
  });

  it('answers the rest of the row the way the label editor promises', () => {
    const values = tokenValuesFor(student(), BINDING);

    expect(values.lastName).toBe('Lovelace');
    // No full stop — a template that wants one says `{{lastInitial}}.`
    expect(values.lastInitial).toBe('L');
    expect(values.grade).toBe('8th grade');
    expect(values.eventTitle).toBe('Sunday Nursery');
  });

  it('gives a child with nothing on file empty strings rather than gaps', () => {
    const values = tokenValuesFor(student({ lastName: '', grade: null }), BINDING);

    expect(values.lastName).toBe('');
    expect(values.lastInitial).toBe('');
    expect(values.grade).toBe('');
  });

  it('leaves allergy for the rasteriser to fold in', () => {
    // It is the one value the roster row cannot answer; `allergyFor` adds it at
    // rasterise time, and absent reads as empty until it does.
    expect(tokenValuesFor(student({ hasAllergies: true }), BINDING).allergy).toBeUndefined();
  });
});
