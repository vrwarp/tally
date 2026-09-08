/**
 * Which language a reader who has never chosen one opens in.
 *
 * The negotiation is the part worth pinning. Everything else about i18n has a
 * visible control behind it — a switcher, a stored choice — and this is the one
 * decision made *for* somebody, on their first visit, from a header they never
 * see. Getting it wrong shows a Taiwanese family Simplified, which is not a
 * preference being missed but a script they may not read.
 *
 * `negotiateLocale` is a pure function of a list on purpose (`detectLocale` is
 * the two lines that fetch that list from a browser), so most of this drives it
 * directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCALE,
  KIOSK_LOCALE_STORAGE_KEY,
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  LOCALE_STORAGE_KEY,
  detectLocale,
  isLocale,
  negotiateLocale,
} from '@/lib/locales';

describe('negotiateLocale', () => {
  it('takes the first tag it speaks, in the order the browser gave them', () => {
    // Browsers already sort `navigator.languages` by preference, which is why
    // q-values never come into this.
    expect(negotiateLocale(['fr-FR', 'zh-TW', 'en-GB'])).toBe('zh-Hant');
    expect(negotiateLocale(['fr-FR', 'en-GB', 'zh-TW'])).toBe('en');
  });

  /*
   * The pairs that matter. `zh-Hant` is not a script variant of `zh-Hans` in
   * this app — the two are separate catalogues with different vocabulary — so
   * the region tags have to land on the right one rather than merely on "some
   * Chinese".
   */
  it.each(['zh-TW', 'zh-HK', 'zh-MO', 'zh-Hant', 'zh-Hant-TW'])(
    'reads %s as Traditional',
    (tag) => {
      expect(negotiateLocale([tag])).toBe('zh-Hant');
    },
  );

  it.each(['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-CN'])(
    'reads %s as Simplified',
    (tag) => {
      expect(negotiateLocale([tag])).toBe('zh-Hans');
    },
  );

  /*
   * The default inside Chinese, and it is a decision rather than a fallthrough:
   * an unqualified `zh` is Simplified far more often than not, and a reader who
   * wanted Traditional will find the switcher — where a reader shown a script
   * they cannot read may not.
   */
  it('reads an unqualified zh as Simplified rather than refusing to choose', () => {
    expect(negotiateLocale(['zh'])).toBe('zh-Hans');
  });

  it('is case-insensitive, because a header is not', () => {
    expect(negotiateLocale(['ZH-TW'])).toBe('zh-Hant');
    expect(negotiateLocale(['EN-US'])).toBe('en');
    expect(negotiateLocale(['Zh-Hans'])).toBe('zh-Hans');
  });

  it('ignores the whitespace a hand-written header carries', () => {
    expect(negotiateLocale([' zh-TW '])).toBe('zh-Hant');
    expect(negotiateLocale(['  ', 'zh-TW'])).toBe('zh-Hant');
  });

  it('speaks English for an English tag of any region', () => {
    expect(negotiateLocale(['en'])).toBe('en');
    expect(negotiateLocale(['en-AU'])).toBe('en');
  });

  /*
   * Not a match, and deliberately not a prefix match either: `zho` is a
   * language tag this app does not speak, and reading it as `zh` would be
   * guessing at somebody's script from three letters.
   */
  it('passes over a tag it does not speak', () => {
    expect(negotiateLocale(['de', 'fr'])).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(['zho'])).toBe(DEFAULT_LOCALE);
    expect(negotiateLocale(['english'])).toBe(DEFAULT_LOCALE);
  });

  it('answers English for a browser that offers nothing', () => {
    expect(negotiateLocale([])).toBe('en');
    expect(negotiateLocale(null)).toBe('en');
    expect(negotiateLocale(undefined)).toBe('en');
  });
});

describe('detectLocale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the browser’s preference list', () => {
    vi.stubGlobal('navigator', { languages: ['zh-HK', 'en-GB'] });
    expect(detectLocale()).toBe('zh-Hant');
  });

  /*
   * `navigator.languages` is absent on some older WebKit builds, and the kiosk
   * runs on whatever tablet the church already owns.
   */
  it('falls back to the single language when there is no list', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    expect(detectLocale()).toBe('zh-Hans');
  });

  it('answers English for a browser that says nothing at all', () => {
    vi.stubGlobal('navigator', {});
    expect(detectLocale()).toBe('en');
  });
});

describe('isLocale', () => {
  it('accepts every language Tally speaks', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);
  });

  /*
   * The guard on a `localStorage` read, so the values that reach it are
   * whatever was in a browser rather than whatever this app last wrote.
   */
  it('refuses anything else, including the shapes storage answers with', () => {
    expect(isLocale('zh')).toBe(false);
    expect(isLocale('EN')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(0)).toBe(false);
    expect(isLocale(['en'])).toBe(false);
  });
});

describe('the language names', () => {
  it('names every language, in that language', () => {
    // Never translated — the reader who needs a language switcher is by
    // definition not reading the words around it.
    expect(LOCALE_LABELS).toEqual({ en: 'English', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文' });
    expect(LOCALE_SHORT_LABELS).toEqual({ en: 'EN', 'zh-Hans': '简', 'zh-Hant': '繁' });
  });

  it('has a name and a badge for each of them, and nothing spare', () => {
    expect(Object.keys(LOCALE_LABELS).sort()).toEqual([...LOCALES].sort());
    expect(Object.keys(LOCALE_SHORT_LABELS).sort()).toEqual([...LOCALES].sort());
  });
});

/*
 * Two keys, because they are two different facts: a counselor's language
 * follows them to a new phone, and a kiosk's language is a property of the
 * tablet bolted to the wall in that lobby. Sharing one key would mean the
 * person who set the kiosk up gave it their own language.
 */
describe('where a choice is kept', () => {
  it('keeps the reader’s apart from the tablet’s', () => {
    expect(LOCALE_STORAGE_KEY).toBe('tally:locale');
    expect(KIOSK_LOCALE_STORAGE_KEY).toBe('tally:kiosk:locale');
    expect(KIOSK_LOCALE_STORAGE_KEY).not.toBe(LOCALE_STORAGE_KEY);
  });

  it('namespaces the kiosk’s under the prefix the rest of its storage uses', () => {
    // Same origin as the app; see `src/kiosk/storage.ts`.
    expect(KIOSK_LOCALE_STORAGE_KEY.startsWith('tally:kiosk:')).toBe(true);
  });
});

describe('the default', () => {
  it('is English, and is one of the languages', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });
});
