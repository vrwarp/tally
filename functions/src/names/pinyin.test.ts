/**
 * The one job: a parent standing at a kiosk with no IME can type 蔡秉洲.
 *
 * These assertions are about the *haystack*, not about transcription. A search
 * index is allowed to be generous — a token that finds nobody costs a few
 * bytes — and where it must be exact is at the two ends: the kiosk matcher only
 * ever asks `includes`, so the tokens have to be gapless and lowercase; and the
 * function has to be idempotent, because both the trigger that calls it and the
 * backfill that calls it will call it again on their own output.
 */
import { describe, expect, it } from 'vitest';
import { SURNAME_SPELLINGS, pinyinTokens, withPinyin } from './pinyin.js';

/** What the kiosk actually does with a name — see `createSearchMatcher`. */
function finds(searchName: string, typed: string): boolean {
  return withPinyin(searchName).replace(/\s/g, '').toLowerCase().includes(typed);
}

describe('pinyinTokens', () => {
  it('romanizes a Chinese name and abbreviates it', () => {
    expect(pinyinTokens('蔡秉洲')).toContain('caibingzhou');
    expect(pinyinTokens('蔡秉洲')).toContain('cbz');
  });

  it('has nothing to say about a name with no Chinese in it', () => {
    // The overwhelmingly common case, and it must cost one failed regexp.
    expect(pinyinTokens('ada lovelace')).toEqual([]);
    expect(pinyinTokens('')).toEqual([]);
  });

  /*
   * A Planning Center person with a nickname is stored as one composite —
   * `Benson “蔡秉洲” Tsai` — so the Chinese arrives in the middle of a Latin
   * name, and the quotes around it are not part of it.
   */
  it('reads the Chinese out of the middle of a composite', () => {
    expect(pinyinTokens('benson “蔡秉洲” tsai')).toContain('caibingzhou');
  });

  /*
   * The Attendees backend has separate CJK name fields, so the composite comes
   * through as two runs with a space between them. They are one name.
   */
  it('joins runs that a space happened to separate', () => {
    expect(pinyinTokens('陳 大文')).toContain('chendawen');
    expect(pinyinTokens('陳 大文')).toContain('cdw');
  });

  /*
   * A roster is nothing but surnames, and surnames are where naive pinyin is
   * wrong: 單 is *shàn*, not *dān*. Nothing here has to adjudicate, though —
   * every reading goes in, so the family that says Dan and the family that says
   * Shan are both found.
   */
  it('carries every reading of a heteronym surname', () => {
    const tokens = pinyinTokens('單國璽');
    expect(tokens).toContain('danguoxi');
    expect(tokens).toContain('shanguoxi');
  });

  it('carries the spelling a passport uses, where the table names one', () => {
    expect(pinyinTokens('蔡秉洲')).toContain('tsaibingzhou');
    expect(pinyinTokens('陳大文')).toContain('chandawen');
  });

  /*
   * `normalizeForSearch` folds `lü` onto `lu`, which covers the passport
   * spelling. What survives it are the letters a Chinese keyboard produces for
   * that vowel, and those have to be in the name.
   */
  it('spells a ü the way a keyboard types it as well', () => {
    const tokens = pinyinTokens('呂大文');
    expect(tokens.some((token) => token.startsWith('lü'))).toBe(true);
    expect(tokens.some((token) => token.startsWith('lv'))).toBe(true);
  });

  it('refuses to romanize something that is not a name', () => {
    // `searchName` is built from untrusted upstream fields, where a name can be
    // a paragraph somebody pasted.
    expect(pinyinTokens('一'.repeat(200))).toEqual([]);
  });

  it('never emits a gap, because the matcher compares the gapless form', () => {
    for (const token of pinyinTokens('歐陽文')) expect(token).not.toMatch(/\s/);
  });
});

describe('withPinyin', () => {
  it('keeps the name it was given and adds to it', () => {
    expect(withPinyin('蔡秉洲')).toMatch(/^蔡秉洲 /);
  });

  it('leaves a name with no Chinese in it exactly as it was', () => {
    expect(withPinyin('ada lovelace')).toBe('ada lovelace');
  });

  /*
   * Load-bearing twice over: `onStudentNamed` fires on its own write, and the
   * backfill is meant to be run more than once. Both stop because of this.
   */
  it('is idempotent', () => {
    const once = withPinyin('蔡秉洲');
    expect(withPinyin(once)).toBe(once);
    expect(withPinyin(withPinyin(once))).toBe(once);
  });

  it('orders its tokens, so two machines write the same string', () => {
    const tokens = withPinyin('蔡秉洲').split(' ').slice(1);
    expect(tokens).toEqual([...tokens].sort());
  });

  it('finds the child a parent is typing for', () => {
    expect(finds('蔡秉洲', 'caibing')).toBe(true);
    expect(finds('蔡秉洲', 'cbz')).toBe(true);
    expect(finds('蔡秉洲', 'tsai')).toBe(true);
    expect(finds('蔡秉洲', 'zhang')).toBe(false);
  });
});

describe('the surname table', () => {
  it('holds both scripts for every surname that has two', () => {
    // A roster carries Traditional and Simplified alike, and they are different
    // characters: an entry for one is not an entry for the other.
    const pairs: [string, string][] = [
      ['陳', '陈'],
      ['黃', '黄'],
      ['張', '张'],
      ['劉', '刘'],
    ];
    for (const [traditional, simplified] of pairs) {
      expect(SURNAME_SPELLINGS[traditional], traditional).toEqual(
        SURNAME_SPELLINGS[simplified],
      );
    }
  });

  it('is spellings only — no tones, no capitals, no gaps', () => {
    for (const [surname, spellings] of Object.entries(SURNAME_SPELLINGS)) {
      for (const spelling of spellings) {
        expect(spelling, `${surname}: ${spelling}`).toMatch(/^[a-z]+$/);
      }
    }
  });
});
