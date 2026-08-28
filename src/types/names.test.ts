/**
 * The two halves of a Planning Center first name.
 *
 * `composeFirstName` and `splitFirstName` are duplicated in
 * `functions/src/pco/mapping.ts` — the Cloud Functions package compiles
 * separately and cannot import from here. The cases below are deliberately the
 * same ones that file's tests use: if the two implementations ever drift, a
 * name saved in the student editor stops matching the name the sync writes, and
 * write-back starts patching a field nobody edited.
 */
import { describe, expect, it } from 'vitest';
import { buildSearchName, composeFirstName, splitFirstName } from '@/types';

describe('composeFirstName', () => {
  it('writes the two halves the way Planning Center writes them', () => {
    expect(composeFirstName('Benson', '蔡秉洲')).toBe('Benson “蔡秉洲”');
    expect(composeFirstName('Jonathan', 'Jonny')).toBe('Jonathan “Jonny”');
  });

  it('uses whichever half it has when there is only one', () => {
    expect(composeFirstName('Benson', null)).toBe('Benson');
    expect(composeFirstName('Benson', '  ')).toBe('Benson');
    expect(composeFirstName('', '蔡秉洲')).toBe('蔡秉洲');
    expect(composeFirstName('', null)).toBe('');
  });

  it('does not repeat a nickname that only restates the first name', () => {
    expect(composeFirstName('Ben', ' BEN ')).toBe('Ben');
  });

  it('trims what a leader typed, so a stray space is not a name change', () => {
    expect(composeFirstName('  Benson ', ' 蔡秉洲 ')).toBe('Benson “蔡秉洲”');
  });
});

describe('splitFirstName', () => {
  it('fills the editor from the composite the student holds', () => {
    expect(splitFirstName('Benson “蔡秉洲”')).toEqual({ firstName: 'Benson', nickname: '蔡秉洲' });
  });

  it('leaves a plain name alone', () => {
    expect(splitFirstName('Benson')).toEqual({ firstName: 'Benson', nickname: null });
    expect(splitFirstName('  Mary Jane ')).toEqual({ firstName: 'Mary Jane', nickname: null });
  });

  it('reads straight quotes too, since a person may have typed them', () => {
    expect(splitFirstName('Benson "蔡秉洲"')).toEqual({ firstName: 'Benson', nickname: '蔡秉洲' });
  });

  it('treats a bare quoted name as the name itself', () => {
    expect(splitFirstName('“Benji”')).toEqual({ firstName: 'Benji', nickname: null });
    expect(splitFirstName('Benson “”')).toEqual({ firstName: 'Benson', nickname: null });
  });

  /*
   * The four things the pattern's own anchors and gaps are load-bearing for.
   *
   * `splitFirstName` runs over whatever Planning Center hands back, including
   * fields a person pasted into. Each case below is a string the parser must
   * *decline*, or a piece of whitespace it must absorb, and each of them turns
   * on one character of the expression — the leading `^`, the trailing `$`,
   * either `\s*`, or the `.trim()` in front of it. Drop any one and the
   * function still passes every case above it, which is why they are here:
   * a nickname invented out of the middle of a name is a name change the
   * editor then writes back to Planning Center.
   */
  it('will not pick a nickname out of the middle of a multi-line paste', () => {
    // Without the leading anchor the parser is free to start at the second
    // line and hand back "Tsai", quietly dropping "Benson".
    expect(splitFirstName('Benson\nTsai “蔡秉洲”')).toEqual({
      firstName: 'Benson\nTsai “蔡秉洲”',
      nickname: null,
    });
  });

  it('needs the quoted half at the very end, or the name is not a composite', () => {
    // A full name that happens to carry a nickname in the middle is one name,
    // not a first name and a nickname: splitting it would drop the surname.
    expect(splitFirstName('Ben “Benji” Tsai')).toEqual({
      firstName: 'Ben “Benji” Tsai',
      nickname: null,
    });
    expect(splitFirstName('Ben “Benji”Jr')).toEqual({
      firstName: 'Ben “Benji”Jr',
      nickname: null,
    });
  });

  it('does not need a space before the quote', () => {
    // The gap between the two halves is optional, and what sits in front of
    // the quote is the legal name however tightly it was typed — not, as it
    // would be if that gap could swallow it, nothing at all.
    expect(splitFirstName('Ben“Benji”')).toEqual({ firstName: 'Ben', nickname: 'Benji' });
  });

  it('absorbs the whitespace around both halves', () => {
    expect(splitFirstName('\nBenson “蔡秉洲”')).toEqual({
      firstName: 'Benson',
      nickname: '蔡秉洲',
    });
    expect(splitFirstName('Ben “ Benji ”')).toEqual({ firstName: 'Ben', nickname: 'Benji' });
  });

  it('round-trips, so opening the editor and saving changes nothing', () => {
    for (const composite of ['Benson “蔡秉洲”', 'Benson', '蔡秉洲', 'Mary Jane “MJ”']) {
      const halves = splitFirstName(composite);
      expect(composeFirstName(halves.firstName, halves.nickname)).toBe(composite);
    }
  });
});

describe('the composite as the rest of Tally sees it', () => {
  it('puts both spellings in the search key', () => {
    const searchName = buildSearchName(composeFirstName('Benson', '蔡秉洲'), 'Tsai');

    expect(searchName).toContain('benson');
    expect(searchName).toContain('蔡秉洲');
  });
});
