/**
 * Where a locale's messages come from.
 *
 * English is bundled and the Chinese catalogues are not, and the asymmetry is
 * the point. English is the default and the fallback: something has to be
 * renderable on the first frame, before any network or any `import()` has
 * resolved, or the app flashes an empty shell at every reader who has never
 * chosen a language. The other two arrive behind a dynamic import, which Vite
 * emits as its own chunk — so a reader who has never switched away from English
 * downloads neither.
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
    const loaded =
      locale === 'zh-Hans'
        ? ((await import('../../messages/zh-Hans.json')).default as Catalog)
        : ((await import('../../messages/zh-Hant.json')).default as Catalog);
    cache.set(locale, loaded);
    return loaded;
  } catch {
    return en;
  }
}
