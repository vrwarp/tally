/**
 * What a grade is called, asserted through the real English catalogue.
 *
 * These used to live in `utils.test.ts` beside the hand-rolled ordinal suffix
 * they were written for. That suffix is gone: English "9th" is now an ICU
 * `selectordinal` in `messages/en.json`, which is the one construct that gets
 * the rule right in a language that has a different one. So the assertions are
 * routed through `testGrades()` rather than through string literals — the
 * sentence a person reads is unchanged, and a malformed message now fails here
 * instead of on a lobby screen.
 */
import { describe, expect, it } from 'vitest';
import { gradeDescription, gradeLabel, gradeName } from '@/lib/grades';
import { testGrades } from '@/test/translator';

const grades = testGrades();

describe('the ordinal', () => {
  it('labels the grades the ministry actually serves', () => {
    expect(gradeName(grades, 6)).toBe('6th');
    expect(gradeName(grades, 7)).toBe('7th');
    expect(gradeName(grades, 8)).toBe('8th');
    expect(gradeName(grades, 9)).toBe('9th');
    expect(gradeName(grades, 10)).toBe('10th');
    expect(gradeName(grades, 11)).toBe('11th');
    expect(gradeName(grades, 12)).toBe('12th');
  });

  it('uses "th" for the 11/12/13 exceptions rather than st/nd/rd', () => {
    expect(gradeName(grades, 11)).toBe('11th');
    expect(gradeName(grades, 12)).toBe('12th');
    expect(gradeName(grades, 13)).toBe('13th');
  });

  it('still produces normal ordinals either side of the exception band', () => {
    expect(gradeName(grades, 1)).toBe('1st');
    expect(gradeName(grades, 2)).toBe('2nd');
    expect(gradeName(grades, 3)).toBe('3rd');
    expect(gradeName(grades, 21)).toBe('21st');
    expect(gradeName(grades, 22)).toBe('22nd');
    expect(gradeName(grades, 23)).toBe('23rd');
  });
});

describe('gradeName and gradeDescription', () => {
  it('names kindergarten rather than printing a zeroth grade', () => {
    expect(gradeName(grades, 0)).toBe('K');
    expect(gradeDescription(grades, 0)).toBe('Kindergarten');
  });

  it('names Pre-K rather than printing a minus-first grade', () => {
    // Not hypothetical: Planning Center holds `-1` for a pre-schooler, and
    // before Pre-K had a name here the lobby screen read "-1th grade" beside a
    // four-year-old. "Pre-K grade" is not English either, same as "K grade".
    expect(gradeName(grades, -1)).toBe('Pre-K');
    expect(gradeDescription(grades, -1)).toBe('Pre-K');
  });

  it('keeps the ordinal for every grade that has one', () => {
    expect(gradeName(grades, 1)).toBe('1st');
    expect(gradeName(grades, 9)).toBe('9th');
    expect(gradeDescription(grades, 1)).toBe('1st grade');
    expect(gradeDescription(grades, 12)).toBe('12th grade');
  });
});

describe('gradeLabel', () => {
  it('uses the short token, so a chip reads "K" and not "Kindergarten"', () => {
    expect(gradeLabel(grades, { grade: 0 })).toBe('K');
  });

  it('prints the grade a backend holds', () => {
    expect(gradeLabel(grades, { grade: 9 })).toBe('9th');
  });

  it('says nothing for somebody nobody holds a grade for', () => {
    // The bug this fixed: an adult volunteer on a hand-picked roster has no
    // grade and no graduation year upstream, so the sync's clamp parked them
    // on `minGrade` and every screen printed "6th grade" under their name.
    // There is no clamp to consult now — the grade is simply absent.
    expect(gradeLabel(grades, { grade: null })).toBeNull();
  });

  it('reads Pre-K on a chip the same as anywhere else', () => {
    expect(gradeLabel(grades, { grade: -1 })).toBe('Pre-K');
  });

  it('trusts a grade with no flag beside it', () => {
    // A Tally document: the grade was typed by a human at quick-add, and the
    // field only exists on roster-sourced rows.
    expect(gradeLabel(grades, { grade: 7 })).toBe('7th');
  });
});

