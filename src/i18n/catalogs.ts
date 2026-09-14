/**
 * Where a locale's messages come from.
 *
 * English is bundled and the others are not, and the asymmetry is the point.
 * English is the default and the fallback: something has to be renderable on
 * the first frame, before any network or any `import()` has resolved, or the
 * app flashes an empty shell at every reader who has never chosen a language.
 * The rest arrive behind a dynamic import, which Vite emits as its own chunk —
 * so a reader who has never switched away from English downloads none of
 * them.
 *
 * The kiosk needs a stricter version of this again; see `src/kiosk/messages.ts`
 * and docs/i18n.md §4. This module is the main app's.
 */
import { DEFAULT_LOCALE, type Locale } from '@/lib/locales';
import en from '../../messages/en.json';

export type Catalog = typeof en;

/** English, always available, never awaited. */
export const EN_CATALOG: Catalog = en;

/**
 * Loaded catalogues, so switching back to a language costs nothing the second
 * time. Bounded by `LOCALES`, so there is no eviction to think about.
 */
const cache = new Map<Locale, Catalog>([[DEFAULT_LOCALE, en]]);

export function cachedCatalog(locale: Locale): Catalog | null {
  return cache.get(locale) ?? null;
}

/**
 * A locale's messages, fetched once.
 *
 * Falls back to English rather than throwing: a chunk that will not load — the
 * classic stale-service-worker failure this app already words a specific error
 * for — must degrade to a readable screen in the wrong language, never to a
 * blank one. `docs/error-handling.md` rule 2.
 */
export async function loadCatalog(locale: Locale): Promise<Catalog> {
  const hit = cache.get(locale);
  if (hit) return hit;
  try {
    /*
     * A `switch` over literal specifiers rather than a template one. Vite needs
     * the path statically to emit a chunk per catalogue, and
     * `import(`../../messages/${locale}.json`)` would bundle every file in that
     * directory into one — including `translation-state.json`, which is 400 kB
     * of pipeline bookkeeping no browser should ever see.
     */
    const loaded = await (async (): Promise<Catalog> => {
      switch (locale) {
        case 'es-MX':
          return (await import('../../messages/es-MX.json')).default as Catalog;
        case 'zh-Hans':
          return (await import('../../messages/zh-Hans.json')).default as Catalog;
        default:
          return (await import('../../messages/zh-Hant.json')).default as Catalog;
      }
    })();
    cache.set(locale, loaded);
    return loaded;
  } catch {
    return en;
  }
}
