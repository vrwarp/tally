/**
 * The languages Tally speaks.
 *
 * Script subtags rather than regions, deliberately: the Traditional-Chinese
 * families at this church span Taiwan *and* Hong Kong, and `zh-Hant` names the
 * script without picking one. A `zh-TW` browser and a `zh-HK` browser both
 * negotiate onto it.
 *
 * Simplified and Traditional are separate catalogues, never a character-level
 * conversion of one another. The pairs that matter differ by *vocabulary*:
 * Taiwan says 登入 where the mainland says 登录, 儲存 where it says 保存. A
 * transliterated 登錄 is a word, and it is the wrong one.
 *
 * Imports nothing, on purpose. Both entry points, the kiosk and the pipeline
 * script all read this, and the kiosk pays for every byte it loads.
 */
export const LOCALES = ['en', 'zh-Hans', 'zh-Hant'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Where a signed-out reader's choice lives, and the mirror of a signed-in one's. */
export const LOCALE_STORAGE_KEY = 'tally:locale';

/**
 * The kiosk's own key.
 *
 * Namespaced under `tally:kiosk:` like everything else the lobby screen keeps
 * (see `src/kiosk/storage.ts`), because the two are genuinely different facts.
 * A counselor's language follows them to a new phone; a kiosk's language is a
 * property of the tablet bolted to the wall in this lobby, and must not change
 * because the person who set it up prefers English.
 */
export const KIOSK_LOCALE_STORAGE_KEY = 'tally:kiosk:locale';

/** Self-named — a language's own name is never translated. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
};

/** One-glyph badges, for places too narrow to carry a language's whole name. */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  en: 'EN',
  'zh-Hans': '简',
  'zh-Hant': '繁',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The first supported language in a browser's preference list.
 *
 * Browsers already order `navigator.languages` by preference, so the first tag
 * that maps onto something Tally speaks wins and q-values never come into it.
 *
 * `zh-TW`, `zh-HK`, `zh-MO` and any `zh-Hant*` mean Traditional; every other
 * `zh-*` — `zh`, `zh-CN`, `zh-SG`, `zh-Hans` — means Simplified. That default
 * is the one to keep if the list ever grows: an unqualified `zh` is Simplified
 * far more often than not, and a reader who wanted Traditional will find the
 * switcher, whereas a reader shown a script they cannot read may not.
 */
export function negotiateLocale(preferences: readonly string[] | null | undefined): Locale {
  for (const preference of preferences ?? []) {
    const tag = preference.trim().toLowerCase();
    if (!tag) continue;
    if (tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo' || tag.startsWith('zh-hant')) {
      return 'zh-Hant';
    }
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-Hans';
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
  }
  return DEFAULT_LOCALE;
}

/**
 * What language to open in, for a reader with no stored choice.
 *
 * Split from `negotiateLocale` so the negotiation itself stays a pure function
 * of a list — which is what the tests drive, and what the kiosk's setup screen
 * wants when it offers a default.
 */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const preferences = navigator.languages ?? (navigator.language ? [navigator.language] : []);
  return negotiateLocale(preferences);
}
