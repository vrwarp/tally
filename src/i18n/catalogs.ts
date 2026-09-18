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
 * What is bundled is the app's slice, not the whole catalogue.
 * `messages/app/*.json` is `messages/*.json` minus the namespaces only a lobby
 * screen renders — the mirror of the cut `scripts/sync-kiosk-messages.mjs`
 * already argues for the kiosk, made at the same place and for the same reason:
 * Vite cannot tree-shake keys out of a JSON module, so a string the main app
 * can never render is a string it ships on every cold load unless it is cut out
 * of the file. The entry boundary is the only line where that is decidable —
 * `src/kiosk/` is a directory, and "eagerly reachable from `src/main.tsx`" is
 * not — so the cut stops there and nothing below changes.
 *
 * `src/types/messages.d.ts` still types every `t('…')` key against the *whole*
 * `messages/en.json`, which is the point: the slice narrows what ships, never
 * what is spellable.
 *
 * The kiosk needs a stricter version of this again; see `src/kiosk/messages.ts`
 * and docs/i18n.md §4. This module is the main app's.
 */
import { DEFAULT_LOCALE, type Locale } from '@/lib/locales';
import en from '../../messages/app/en.json';

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
     * `import(`../../messages/app/${locale}.json`)` would bundle every file in
     * that directory into one — four languages behind one tap. The template
     * form was worse still before the slices existed, when it also swept in
     * `translation-state.json`, 400 kB of pipeline bookkeeping no browser should
     * ever see.
     */
    const loaded = await (async (): Promise<Catalog> => {
      switch (locale) {
        case 'es-MX':
          return (await import('../../messages/app/es-MX.json')).default as Catalog;
        case 'zh-Hans':
          return (await import('../../messages/app/zh-Hans.json')).default as Catalog;
        default:
          return (await import('../../messages/app/zh-Hant.json')).default as Catalog;
      }
    })();
    cache.set(locale, loaded);
    return loaded;
  } catch {
    return en;
  }
}
