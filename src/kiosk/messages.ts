/**
 * Where the lobby screen's words come from.
 *
 * The main app's version of this is `src/i18n/catalogs.ts`; the kiosk needs a
 * stricter one for two reasons.
 *
 * **It gets a slice, not the catalogue.** `scripts/sync-kiosk-messages.mjs`
 * cuts the namespaces a lobby screen can reach out of `messages/*.json`. The
 * app's whole 85 kB `en.json` puts the kiosk's first paint over the budget in
 * `scripts/check-kiosk-budget.mjs` on its own.
 *
 * **It boots warm, or it is not a kiosk.** A shelf device reloads at ~4am and
 * whenever the lobby wifi has an opinion, and it is expected to show a roster
 * before the network answers — which is what `KIOSK_KEYS.roster` and
 * `participation` are for. A language is the same kind of fact. So a kiosk that
 * has been switched to Chinese keeps its slice in `localStorage` and paints
 * Chinese on the *first frame*, with no import and no fetch between the parent
 * and the words. English is bundled, because something has to be renderable
 * before any of that (docs/i18n.md §4.1).
 *
 * The stored copy is a warm-start convenience and never the source of truth: it
 * is discarded whenever its shape no longer matches the English slice compiled
 * into this build — a deploy that adds, renames or drops a key — and the import
 * that refreshes it starts on the same frame regardless. Wrong words for one
 * boot is the worst it can do; a key on a screen a parent is standing at is
 * what it exists to prevent.
 */
import en from '../../messages/kiosk/en.json';
import { DEFAULT_LOCALE, type Locale } from '@/lib/locales';
import { KIOSK_KEYS, readJson, writeJson } from './storage';

export type KioskCatalog = typeof en;

/** English, always available, never awaited. */
export const EN_KIOSK_CATALOG: KioskCatalog = en;

/**
 * What was stored, and what it was stored against.
 *
 * `shape` is the key tree of the English slice at the time of writing — see
 * `shapeOf`. Storing it beside the messages is what lets a boot decide whether
 * this copy still describes the build it is about to render, without a build
 * stamp to thread through the bundle.
 */
interface StoredMessages {
  locale: Locale;
  shape: string;
  messages: KioskCatalog;
}

/**
 * A catalogue's keys, in order, with the messages thrown away.
 *
 * Compares shape rather than content on purpose: a reworded message is worth
 * one boot of staleness, a missing key is a lobby screen rendering
 * `Register.labelFirstName` at a parent. Only the second is worth discarding a
 * warm start over, and only the second is what a deploy changes.
 */
function shapeOf(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return 1;
  return Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) => [key, shapeOf(value)]),
  );
}

const EN_SHAPE = JSON.stringify(shapeOf(en));

const memory = new Map<Locale, KioskCatalog>([[DEFAULT_LOCALE, en]]);

/**
 * The slice for a locale if this device can produce it synchronously — from
 * this session, or from the last one.
 */
export function cachedCatalog(locale: Locale): KioskCatalog | null {
  const held = memory.get(locale);
  if (held) return held;

  const stored = readJson<StoredMessages>(KIOSK_KEYS.messages);
  if (!stored || stored.locale !== locale || stored.shape !== EN_SHAPE) return null;
  if (!stored.messages || typeof stored.messages !== 'object') return null;

  memory.set(locale, stored.messages);
  return stored.messages;
}

/**
 * A locale's slice, fetched once.
 *
 * Falls back to English rather than throwing, for the reason `loadCatalog` in
 * the main app does: a chunk that will not load — the stale-service-worker
 * failure the kiosk's own worker is written around — must degrade to a readable
 * screen in the wrong language, never a blank one.
 */
export async function loadCatalog(locale: Locale): Promise<KioskCatalog> {
  const held = cachedCatalog(locale);
  if (held) return held;
  try {
    const loaded =
      locale === 'zh-Hans'
        ? ((await import('../../messages/kiosk/zh-Hans.json')).default as KioskCatalog)
        : ((await import('../../messages/kiosk/zh-Hant.json')).default as KioskCatalog);
    memory.set(locale, loaded);
    if (locale !== DEFAULT_LOCALE) {
      writeJson(KIOSK_KEYS.messages, { locale, shape: EN_SHAPE, messages: loaded });
    }
    return loaded;
  } catch {
    return en;
  }
}
