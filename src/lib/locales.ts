/**
 * The languages Tally speaks.
 *
 * Script subtags rather than regions for Chinese, deliberately: the
 * Traditional-Chinese families at this church span Taiwan *and* Hong Kong, and
 * `zh-Hant` names the script without picking one. A `zh-TW` browser and a
 * `zh-HK` browser both negotiate onto it.
 *
 * Simplified and Traditional are separate catalogues, never a character-level
 * conversion of one another. The pairs that matter differ by *vocabulary*:
 * Taiwan says 登入 where the mainland says 登录, 儲存 where it says 保存. A
 * transliterated 登錄 is a word, and it is the wrong one.
 *
 * Spanish is the opposite shape and takes a region tag for it. There is no
 * script to name and no second catalogue to keep apart: this church is in
 * Hayward, where three families in four with a Spanish surname are of Mexican
 * origin and most of the rest are Salvadoran or Guatemalan. `es-MX` names whose
 * Spanish the catalogue is written in — Mexican, because that is the room —
 * while `negotiateLocale` lands *every* `es-*` browser on it, and the copy is
 * held to vocabulary a Salvadoran mother also uses. See
 * `messages/GLOSSARY.md`, which is where the regionalisms that were rejected
 * are written down.
 *
 * Imports nothing, on purpose. Both entry points, the kiosk and the pipeline
 * script all read this, and the kiosk pays for every byte it loads.
 */
export const LOCALES = ['en', 'es-MX', 'zh-Hans', 'zh-Hant'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Where a signed-out reader's choice lives, and the mirror of a signed-in one's. */
/* Stryker disable next-line all: static — see docs/mutation-testing.md. */
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
/* Stryker disable next-line all: static — see docs/mutation-testing.md. */
export const KIOSK_LOCALE_STORAGE_KEY = 'tally:kiosk:locale';

/**
 * Self-named — a language's own name is never translated.
 *
 * `es-MX` wears the bare word **Español** and not "Español (México)". The tag
 * is a statement about which Spanish the catalogue was written in; the chip is
 * a question put to whoever is standing at the glass, and a quarter of the
 * families it is for are Salvadoran, Guatemalan or Puerto Rican. A country in
 * the label would answer that question wrong for them.
 */
/* Stryker disable all: static — see docs/mutation-testing.md. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'es-MX': 'Español',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
};
/* Stryker restore all */

/** Short badges, for places too narrow to carry a language's whole name. */
/* Stryker disable all: static — see docs/mutation-testing.md. */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  en: 'EN',
  'es-MX': 'ES',
  'zh-Hans': '简',
  'zh-Hant': '繁',
};
/* Stryker restore all */

export function isLocale(value: unknown): value is Locale {
  // Stryker disable next-line ConditionalExpression: `includes` compares with
  // `===` against four strings, so it already refuses every non-string the
  // `typeof` does. The guard is here to narrow `unknown` for the cast, not to
  // change an answer.
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
 *
 * Every `es-*` maps onto `es-MX`, and there is nothing to decide there — one
 * Spanish catalogue, so `es`, `es-US`, `es-419`, `es-SV` and `es-ES` all reach
 * it. It is written for the first four; a Spaniard gets *ustedes* where they
 * would say *vosotros* and — like a Taiwanese reader handed Simplified — has a
 * switcher, which is a far better failure than English.
 */
export function negotiateLocale(preferences: readonly string[] | null | undefined): Locale {
  if (!preferences) return DEFAULT_LOCALE;
  for (const preference of preferences) {
    const tag = preference.trim().toLowerCase();
    // Stryker disable next-line ConditionalExpression: a blank entry matches
    // none of the four tests below either, so skipping it here and falling
    // through are the same answer. The line is the shortcut, not the rule.
    if (!tag) continue;
    if (tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo' || tag.startsWith('zh-hant')) {
      return 'zh-Hant';
    }
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-Hans';
    if (tag === 'es' || tag.startsWith('es-')) return 'es-MX';
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
  const preferences =
    navigator.languages ?? (navigator.language ? [navigator.language] : undefined);
  return negotiateLocale(preferences);
}
