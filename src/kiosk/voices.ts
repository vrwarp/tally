/**
 * The words of the languages a lobby offers, ready before anybody chooses one.
 *
 * The search screen's failure panel speaks every pinned language at once —
 * 找不到 under **No match** — because the family it is for has, by definition,
 * not found the language switch. Those words come from the same slices the
 * provider swaps in when a language *is* chosen, held here as plain catalogues
 * beside the provider's one current language rather than instead of it.
 *
 * Fetched, not bundled: a pinned catalogue is the chunk `loadCatalog` already
 * emits, asked for at boot rather than at the moment of the first failed
 * search. Until it lands the panel speaks one language fewer, which is the
 * screen that shipped — never a key.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_LOCALE, type Locale } from '@/lib/locales';
import { EN_KIOSK_CATALOG, cachedCatalog, loadCatalog, type KioskCatalog } from './messages';

export type Voices = Partial<Record<Locale, KioskCatalog>>;

/**
 * The catalogues of the pinned languages, as they arrive.
 *
 * Seeded synchronously from whatever this device already holds, so a kiosk that
 * has spoken a language once paints its failure panel whole on the first frame
 * of the next boot.
 */
export function usePinnedCatalogs(pins: readonly Locale[]): Voices {
  const [voices, setVoices] = useState<Voices>(() => {
    const held: Voices = {};
    for (const pin of pins) {
      const catalog = cachedCatalog(pin);
      if (catalog) held[pin] = catalog;
    }
    return held;
  });

  useEffect(() => {
    let live = true;
    for (const pin of pins) {
      if (pin === DEFAULT_LOCALE) continue;
      void loadCatalog(pin, { store: false }).then((loaded) => {
        // A chunk that would not load comes back as English, and an English
        // voice under the English heading would say the same thing twice.
        if (!live || loaded === EN_KIOSK_CATALOG) return;
        setVoices((held) => (held[pin] === loaded ? held : { ...held, [pin]: loaded }));
      });
    }
    return () => {
      live = false;
    };
  }, [pins]);

  return voices;
}

/**
 * Which languages a screen speaks at once.
 *
 * One, once a family has chosen — theirs — and one when there is nothing pinned.
 * Otherwise the language the kiosk is resting in and then every pin, in the
 * order the lobby put them, with one Chinese script standing for both: the
 * headings are the same characters in each, and a panel that said 找不到 twice
 * would be a panel a reader of either script found harder, not easier.
 */
export function spokenLanguages(
  current: Locale,
  pins: readonly Locale[],
  chosen: boolean,
): Locale[] {
  if (chosen || pins.length === 0) return [current];
  const spoken: Locale[] = [];
  const scripts = new Set<string>();
  for (const candidate of [current, DEFAULT_LOCALE, ...pins]) {
    const script = candidate.startsWith('zh') ? 'zh' : candidate;
    if (scripts.has(script)) continue;
    scripts.add(script);
    spoken.push(candidate);
  }
  return spoken;
}
