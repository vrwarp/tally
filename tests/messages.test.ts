/**
 * Catalogue integrity.
 *
 * `messages/en.json` is the source of truth; every other catalogue must mirror
 * its key set and each message's ICU arguments exactly. A missing translation
 * is a red build, not a silent English word on a Chinese screen — or worse, a
 * stale Chinese one saying what the English used to say.
 *
 * `messages/translation-state.json` (written by `npm run translate`) records the
 * verbatim English each translation was made from, so rewording English without
 * re-running the script fails here, with both versions in the output.
 *
 * Ported from `vrwarp/numbers`.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LOCALES } from '@/lib/locales';
// @ts-expect-error — plain Node ESM, deliberately untyped: it has to run
// standalone as `--check` with no toolchain around it.
import { KIOSK_NAMESPACES, stale as staleKioskSlices, usedNamespaces } from '../scripts/sync-kiosk-messages.mjs';
import {
  QUOTED_IN,
  REQUIRED_WORDING,
  SAME_VALUE_GROUPS,
  flatten,
  messageArguments,
  type Messages,
  type TranslationState,
} from '@/lib/translationState';

const MESSAGES_DIR = path.join(process.cwd(), 'messages');
const STATE_FILE = path.join(MESSAGES_DIR, 'translation-state.json');

function loadCatalog(locale: string): Messages | null {
  const file = path.join(MESSAGES_DIR, `${locale}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Messages;
}

const en = loadCatalog('en');
const enFlat = flatten(en!);

describe('message catalogues', () => {
  it('en.json exists and has no empty messages', () => {
    expect(en).not.toBeNull();
    for (const [key, value] of enFlat) {
      expect(value.trim(), `en: ${key} is empty`).not.toBe('');
    }
  });

  for (const locale of LOCALES.filter((candidate) => candidate !== 'en')) {
    const catalog = loadCatalog(locale);
    /*
     * A locale whose catalogue has not been drafted yet is allowed to be
     * absent — the extraction phase runs for weeks in English alone, and a
     * suite that went red for the whole of it would simply be turned off. Once
     * the file exists it must mirror en exactly.
     */
    if (!catalog) continue;

    describe(locale, () => {
      const flat = flatten(catalog);

      it('has exactly the same keys as en.json', () => {
        const missing = [...enFlat.keys()].filter((key) => !flat.has(key));
        const extra = [...flat.keys()].filter((key) => !enFlat.has(key));
        expect(missing, `missing keys in ${locale}`).toEqual([]);
        expect(extra, `orphan keys in ${locale} (removed from en?)`).toEqual([]);
      });

      it("keeps every message's ICU arguments and rich-text tags", () => {
        for (const [key, enValue] of enFlat) {
          const value = flat.get(key);
          if (value === undefined) continue; // covered by the key test
          expect(messageArguments(value), `${locale}: ${key} arguments drifted`).toEqual(
            messageArguments(enValue),
          );
        }
      });

      it('has no empty messages', () => {
        for (const [key, value] of flat) {
          expect(value.trim(), `${locale}: ${key} is empty`).not.toBe('');
        }
      });
    });
  }

  describe('linked keys (cross-key wording dependencies)', () => {
    const catalogs = LOCALES.map((locale) => [locale, loadCatalog(locale)] as const).filter(
      (entry): entry is readonly [(typeof LOCALES)[number], Messages] => entry[1] !== null,
    );

    it('references real keys', () => {
      for (const group of SAME_VALUE_GROUPS) {
        for (const key of group) {
          expect(enFlat.has(key), `unknown key in SAME_VALUE_GROUPS: ${key}`).toBe(true);
        }
      }
      for (const { message, quotes } of QUOTED_IN) {
        expect(enFlat.has(message), `unknown message in QUOTED_IN: ${message}`).toBe(true);
        expect(enFlat.has(quotes), `unknown quoted key in QUOTED_IN: ${quotes}`).toBe(true);
      }
      for (const { key } of REQUIRED_WORDING) {
        expect(enFlat.has(key), `unknown key in REQUIRED_WORDING: ${key}`).toBe(true);
      }
    });

    it('same-value groups render identically', () => {
      for (const [locale, catalog] of catalogs) {
        const flat = flatten(catalog);
        for (const [canonical, ...members] of SAME_VALUE_GROUPS) {
          for (const member of members) {
            expect(
              flat.get(member),
              `${locale}: ${member} must equal ${canonical} (same UI element in two places)`,
            ).toBe(flat.get(canonical!));
          }
        }
      }
    });

    it('messages that quote another element contain its exact wording', () => {
      for (const [locale, catalog] of catalogs) {
        const flat = flatten(catalog);
        for (const { message, quotes, strip } of QUOTED_IN) {
          let quoted = flat.get(quotes) ?? '';
          if (strip && quoted.startsWith(strip)) quoted = quoted.slice(strip.length);
          expect(
            flat.get(message)?.includes(quoted),
            `${locale}: ${message} must quote ${quotes} verbatim (${JSON.stringify(quoted)})`,
          ).toBe(true);
        }
      }
    });

    /*
     * Untranslated keys are skipped, and that is not a hole: a `todo` entry
     * holds the English source verbatim, so asserting 英文 against it would
     * fail every key on the day the catalogue is drafted rather than the day
     * one is drafted wrong. The drafting script carries the same constraint as
     * a `mustContain`, which is where it bites first.
     */
    it('keys that must name a language do', () => {
      if (!fs.existsSync(STATE_FILE)) return;
      const state: TranslationState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      for (const [locale, catalog] of catalogs) {
        const flat = flatten(catalog);
        for (const { key, text, why } of REQUIRED_WORDING) {
          const wanted = text[locale];
          if (wanted === undefined) continue;
          if ((state[key]?.[locale as 'zh-Hans' | 'zh-Hant'] ?? 'todo') === 'todo') continue;
          expect(
            flat.get(key)?.includes(wanted),
            `${locale}: ${key} must contain ${JSON.stringify(wanted)} — ${why}`,
          ).toBe(true);
        }
      }
    });
  });

  it('translations are not stale (translation-state source matches en)', () => {
    if (!fs.existsSync(STATE_FILE)) return; // arrives with the Chinese catalogues
    const state: TranslationState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const stale: string[] = [];
    for (const [key, entry] of Object.entries(state)) {
      const enValue = enFlat.get(key);
      if (enValue !== undefined && entry.source !== enValue) {
        stale.push(
          `${key}\n  translated from: ${JSON.stringify(entry.source)}\n  en.json now:     ${JSON.stringify(enValue)}`,
        );
      }
    }
    expect(stale, 'English changed since translation — run `npm run translate`').toEqual([]);
    const untracked = [...enFlat.keys()].filter((key) => !(key in state));
    expect(untracked, 'keys missing from translation-state — run `npm run translate`').toEqual([]);
  });
});

/**
 * The kiosk's slice of the catalogue.
 *
 * `messages/kiosk/*.json` is generated: the lobby tablet is handed the few
 * namespaces its own screens reach, because the whole 85 kB file would land in
 * a first paint that `scripts/check-kiosk-budget.mjs` holds to 127 kB gzipped.
 * A generated copy is only defensible while it is provably current, and a
 * namespace the kiosk asks for but the slice does not carry renders its own key
 * on a screen a parent is standing at — so both directions fail here.
 */
describe('the kiosk message slice', () => {
  it('is in sync with the catalogues it is cut from', () => {
    expect(staleKioskSlices()).toEqual([]);
  });

  it('carries every namespace the kiosk actually asks for', () => {
    for (const namespace of usedNamespaces() as string[]) {
      expect(KIOSK_NAMESPACES as string[], `src/kiosk asks for ${namespace}`).toContain(namespace);
    }
  });

  it('names only namespaces that exist in en.json', () => {
    for (const namespace of KIOSK_NAMESPACES as string[]) {
      expect(en, `KIOSK_NAMESPACES lists ${namespace}`).toHaveProperty(namespace);
    }
  });
});

/**
 * Keys nothing reads.
 *
 * A catalogue only grows: a screen gets reworded, the key it used stays, and a
 * translator is asked for a sentence nobody will ever see. Deliberately
 * forgiving — a key counts as used if its bare name appears anywhere in the
 * source at all — so the dynamic lookups this repo does on purpose
 * (`t(CHILD_LABEL_KEYS[position])`, `t(SIZE_LABELS[size])`) read as used
 * rather than as dead.
 */
describe('the catalogue holds nothing nobody reads', () => {
  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sources(full, found);
      else if (/\.(tsx?|mjs)$/.test(entry.name)) found.push(full);
    }
    return found;
  }

  it('every key in en.json is looked up somewhere', () => {
    const files = [
      ...sources(path.join(process.cwd(), 'src')),
      path.join(process.cwd(), 'scripts', 'sync-kiosk-messages.mjs'),
    ];
    const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

    const dead: string[] = [];
    for (const [namespace, entries] of Object.entries(en!)) {
      for (const key of Object.keys(entries as Record<string, unknown>)) {
        if (!new RegExp(`\\b${key}\\b`).test(source)) dead.push(`${namespace}.${key}`);
      }
    }

    expect(dead).toEqual([]);
  });
});
