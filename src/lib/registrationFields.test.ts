/**
 * What the door will accept, stated once.
 *
 * These rules are enforced twice — by the Cloud Function behind the lobby
 * kiosk, and by the Review screen where a leader retypes what a parent
 * fat-fingered. Both read this module, so the sentences asserted here are the
 * sentences a parent and a reviewer actually see, and a change to one of them
 * is a change to both.
 *
 * The boundaries are asserted from both sides on purpose. "Forty characters is
 * fine and forty-one is not" is the claim; "a long name is refused" would pass
 * against a limit of four.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLERGIES_MAX_LENGTH,
  MAX_GRADE,
  MIN_GRADE,
  NAME_MAX_LENGTH,
  checkAllergyNote,
  checkGrade,
  checkName,
  checkPhone,
} from '@/lib/registrationFields';

describe('checkName', () => {
  it('keeps the name a parent typed', () => {
    expect(checkName('Amara', "The child's first name")).toEqual({ ok: true, value: 'Amara' });
  });

  it('trims the edges and collapses runs of whitespace', () => {
    // A lobby keyboard produces both, and neither is a different name.
    expect(checkName('  Mary   Jane  ', 'A name')).toEqual({ ok: true, value: 'Mary Jane' });
  });

  it('composes accents so two spellings of one name are one string', () => {
    // NFD "José" is six code points and NFC is five; they must not become two
    // different children.
    const decomposed = 'José';
    expect(checkName(decomposed, 'A name')).toEqual({ ok: true, value: 'José'.normalize('NFC') });
  });

  it('keeps the apostrophes and hyphens that are in real names', () => {
    // The kiosk keyboard has both keys for exactly this reason.
    expect(checkName("O'Brien", 'A name')).toEqual({ ok: true, value: "O'Brien" });
    expect(checkName('Anne-Marie', 'A name')).toEqual({ ok: true, value: 'Anne-Marie' });
  });

  it('names the field in every sentence it refuses with', () => {
    // The caller supplies the subject so one rule reads correctly from the
    // door and from the reviewer's form.
    expect(checkName('', "The child's first name")).toEqual({
      ok: false,
      error: "The child's first name is required.",
    });
    expect(checkName('   ', 'A surname')).toEqual({ ok: false, error: 'A surname is required.' });
    expect(checkName(undefined, 'A surname')).toEqual({
      ok: false,
      error: 'A surname is required.',
    });
    expect(checkName(42, 'A surname')).toEqual({ ok: false, error: 'A surname is required.' });
  });

  it('accepts a name of exactly the limit and refuses one character more', () => {
    const atLimit = 'a'.repeat(NAME_MAX_LENGTH);
    expect(checkName(atLimit, 'A name')).toEqual({ ok: true, value: atLimit });
    expect(checkName(`${atLimit}a`, 'A name')).toEqual({ ok: false, error: 'A name is too long.' });
  });

  it('measures the length after trimming, not before', () => {
    // Otherwise a name padded with spaces is refused for being a name it is not.
    const padded = `  ${'a'.repeat(NAME_MAX_LENGTH)}  `;
    expect(checkName(padded, 'A name')).toEqual({ ok: true, value: 'a'.repeat(NAME_MAX_LENGTH) });
  });

  it('refuses digits rather than stripping them', () => {
    // "Room 3" and "555-0123" are somebody misreading the question, and
    // silently keeping "Room" would put that on a sticker.
    expect(checkName('Room 3', 'A name')).toEqual({
      ok: false,
      error: 'A name cannot contain numbers.',
    });
    expect(checkName('5550123', 'A name')).toEqual({
      ok: false,
      error: 'A name cannot contain numbers.',
    });
  });

  it('refuses something with no letter in it at all', () => {
    expect(checkName('---', 'A name')).toEqual({
      ok: false,
      error: 'A name needs at least one letter.',
    });
    expect(checkName('🎈', 'A name')).toEqual({
      ok: false,
      error: 'A name needs at least one letter.',
    });
  });

  it('counts a letter from any script', () => {
    // `\p{L}`, not `[a-z]`: the ministry this was written for has both.
    expect(checkName('蔡秉洲', 'A name')).toEqual({ ok: true, value: '蔡秉洲' });
  });
});

describe('checkGrade', () => {
  it('treats an absent grade as an answer', () => {
    // A child too young for a grade has none, and nothing downstream may
    // substitute a zero for it.
    expect(checkGrade(null)).toEqual({ ok: true, value: null });
    expect(checkGrade(undefined)).toEqual({ ok: true, value: null });
  });

  it('accepts both ends of the range', () => {
    expect(checkGrade(MIN_GRADE)).toEqual({ ok: true, value: -1 });
    expect(checkGrade(MAX_GRADE)).toEqual({ ok: true, value: 12 });
    expect(checkGrade(0)).toEqual({ ok: true, value: 0 });
  });

  it('refuses one step outside either end', () => {
    const error = 'grade must be a whole number from -1 (Pre-K) to 12, or null.';
    expect(checkGrade(MIN_GRADE - 1)).toEqual({ ok: false, error });
    expect(checkGrade(MAX_GRADE + 1)).toEqual({ ok: false, error });
  });

  it('refuses anything that is not a whole number', () => {
    const error = 'grade must be a whole number from -1 (Pre-K) to 12, or null.';
    expect(checkGrade(7.5)).toEqual({ ok: false, error });
    expect(checkGrade(Number.NaN)).toEqual({ ok: false, error });
    expect(checkGrade(Number.POSITIVE_INFINITY)).toEqual({ ok: false, error });
    expect(checkGrade('8')).toEqual({ ok: false, error });
  });
});

describe('checkPhone', () => {
  it('keeps ten digits however they were punctuated', () => {
    expect(checkPhone('(510) 555-0134')).toEqual({ ok: true, value: '5105550134' });
    expect(checkPhone('510.555.0134')).toEqual({ ok: true, value: '5105550134' });
  });

  it('drops a leading US country code rather than refusing the number', () => {
    // Eleven digits starting with 1 is the same number written longer.
    expect(checkPhone('+1 510 555 0134')).toEqual({ ok: true, value: '5105550134' });
  });

  it('refuses eleven digits that do not start with a country code', () => {
    expect(checkPhone('25105550134')).toEqual({
      ok: false,
      error: 'Enter a 10-digit phone number.',
    });
  });

  it('refuses nine and twelve digits', () => {
    const error = 'Enter a 10-digit phone number.';
    expect(checkPhone('510555013')).toEqual({ ok: false, error });
    expect(checkPhone('510555013456')).toEqual({ ok: false, error });
  });

  it('refuses a repdigit, which is what somebody types to get past the field', () => {
    // The whole point of the number is that four of its digits are a key the
    // family will use next week.
    expect(checkPhone('0000000000')).toEqual({
      ok: false,
      error: 'That does not look like a phone number.',
    });
    expect(checkPhone('5555555555')).toEqual({
      ok: false,
      error: 'That does not look like a phone number.',
    });
  });

  it('accepts a number that merely starts with a run of one digit', () => {
    // The guard is "all ten the same", not "starts with five fives".
    expect(checkPhone('5555550134')).toEqual({ ok: true, value: '5555550134' });
  });

  it('refuses anything that is not text', () => {
    expect(checkPhone(5105550134)).toEqual({ ok: false, error: 'A phone number is required.' });
    expect(checkPhone(null)).toEqual({ ok: false, error: 'A phone number is required.' });
  });
});

describe('checkAllergyNote', () => {
  it('treats nothing recorded and nothing typed as the same absence', () => {
    // A note cleared on the Review screen is indistinguishable from one the
    // family never wrote — which is what it is.
    expect(checkAllergyNote(null)).toEqual({ ok: true, value: null });
    expect(checkAllergyNote(undefined)).toEqual({ ok: true, value: null });
    expect(checkAllergyNote('')).toEqual({ ok: true, value: null });
    expect(checkAllergyNote('   ')).toEqual({ ok: true, value: null });
  });

  it('trims a note it keeps', () => {
    expect(checkAllergyNote('  peanuts  ')).toEqual({ ok: true, value: 'peanuts' });
  });

  it('accepts a note of exactly the limit and refuses one character more', () => {
    const atLimit = 'a'.repeat(ALLERGIES_MAX_LENGTH);
    expect(checkAllergyNote(atLimit)).toEqual({ ok: true, value: atLimit });
    expect(checkAllergyNote(`${atLimit}a`)).toEqual({
      ok: false,
      error: 'That allergy note is too long.',
    });
  });

  it('refuses anything that is not text', () => {
    expect(checkAllergyNote(12)).toEqual({ ok: false, error: 'allergies must be text.' });
  });
});
