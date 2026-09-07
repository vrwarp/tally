/**
 * Messages are compiled at build time, so no browser carries an ICU parser.
 *
 * `use-intl` formats a message by parsing its ICU source at runtime, which
 * costs `intl-messageformat` — 15.2 kB gzipped, measured when the provider
 * landed. The kiosk cannot afford that (docs/i18n.md §4.2) and the main app has
 * no reason to pay it either: the grammar of `{count, plural, …}` is known when
 * the catalogue is written, not when a lobby tablet renders it.
 *
 * So the same trade the palette and the icon catalogue already make — the
 * expensive general machinery runs where there is room for it. This plugin
 * compiles every message in `messages/` with `icu-minify` as Vite reads it, and
 * `vite.config.ts` aliases `use-intl/format-message` to the package's own
 * `format-only` entry, which formats compiled messages and imports nothing at
 * all. Both halves are required: the formatter cannot read ICU source, and the
 * parser cannot read compiled messages.
 *
 * Two consequences worth knowing:
 *
 * - `t.raw()` throws under the compiled formatter, by design — there is no
 *   source string left to hand back. `tests/compiledMessages.test.ts` fails if
 *   one appears.
 * - Compilation is a *transform*, not a codegen step. The catalogues on disk
 *   stay plain ICU, which is what the translation pipeline, the parity tests
 *   and a human reviewer all read. Nothing is generated into the repo.
 *
 * Vitest does not load this plugin, so the unit suite exercises the ordinary
 * parser over the ordinary catalogue. `tests/compiledMessages.test.ts` is what
 * covers the difference: it compiles and formats every message in every
 * catalogue through the production path.
 */
import compile from 'icu-minify/compile';
import type { Plugin } from 'vite';

/**
 * The catalogues, and not the pipeline's bookkeeping.
 *
 * `translation-state.json` is data about the translations — the English each
 * was made from, the reviewer's status — and its "messages" are quoted source,
 * never rendered. Compiling it would corrupt the record and break the staleness
 * test that reads it.
 */
const CATALOGUE = /[\\/]messages[\\/](kiosk[\\/])?(en|zh-Hans|zh-Hant)\.json(\?|$)/;

/** Compile every leaf of a catalogue, leaving its namespace shape alone. */
function compileTree(node: unknown, path: string): unknown {
  if (typeof node === 'string') {
    try {
      return compile(node);
    } catch (error) {
      throw new Error(`${path}: ${(error as Error).message}`, { cause: error });
    }
  }
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, value]) => [
        key,
        compileTree(value, path ? `${path}.${key}` : key),
      ]),
    );
  }
  return node;
}

export function compileMessages(): Plugin {
  return {
    name: 'tally:compile-messages',
    // Ahead of Vite's own JSON handling, and handing it JSON back: a compiled
    // message is still JSON, so the rest of the pipeline is unchanged.
    enforce: 'pre',
    transform(code, id) {
      if (!CATALOGUE.test(id)) return null;
      return { code: JSON.stringify(compileTree(JSON.parse(code), '')), map: null };
    },
  };
}
