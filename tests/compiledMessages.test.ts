/**
 * The catalogue, run through the formatter that actually ships.
 *
 * Production does not parse ICU. `scripts/vite-compile-messages.ts` compiles
 * every message as Vite reads it and `vite.config.ts` points `use-intl` at its
 * `format-only` entry, so a browser executes a compiled tree and never carries
 * `intl-messageformat` (docs/i18n.md §4.2). Vitest loads neither of those — the
 * unit suite renders components against the ordinary catalogue and the ordinary
 * parser, which is the right thing for a test that is about a screen.
 *
 * That leaves exactly one gap, and this file is it: nothing else in the suite
 * ever executes the compiled path. So every message in every catalogue is
 * compiled here and formatted through `format-only` with values invented from
 * its own shape — a number for a plural, a `Date` for a date, a function for a
 * rich-text tag — and a message that will not compile, or that formats to
 * nothing, fails the build rather than a lobby screen.
 *
 * Plurals are formatted three times (0, 1, 5) because a compiled plural is a
 * table and one lookup only proves one row.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import compile from 'icu-minify/compile';
import formatMessage from 'use-intl/format-message/format-only';
import { LOCALES } from '@/lib/locales';
import { flatten, type Messages } from '@/lib/translationState';

const MESSAGES_DIR = path.join(process.cwd(), 'messages');

/** The same file set `scripts/vite-compile-messages.ts` transforms. */
function catalogues(): [string, Messages][] {
  const found: [string, Messages][] = [];
  for (const locale of LOCALES) {
    for (const file of [`${locale}.json`, path.join('kiosk', `${locale}.json`)]) {
      const full = path.join(MESSAGES_DIR, file);
      if (fs.existsSync(full)) found.push([file, JSON.parse(fs.readFileSync(full, 'utf8'))]);
    }
  }
  return found;
}

/*
 * `Intl` object caching is the host's job in production (use-intl memoizes
 * these); here correctness is all that matters, so they are constructed fresh.
 */
const formatters = {
  getNumberFormat: (...args: ConstructorParameters<typeof Intl.NumberFormat>) =>
    new Intl.NumberFormat(...args),
  getDateTimeFormat: (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) =>
    new Intl.DateTimeFormat(...args),
  getPluralRules: (...args: ConstructorParameters<typeof Intl.PluralRules>) =>
    new Intl.PluralRules(...args),
};

type Part = unknown;
type Values = Record<string, unknown>;

/**
 * Invent a value for every argument a compiled message reads.
 *
 * The compiled form is the only description of what a message wants, which is
 * the point: it is what the browser will be handed. The encoding is
 * icu-minify's — a node is `[name, kind, ...rest]`, `kind` absent for a plain
 * argument, a number for a typed one, and anything else meaning `name` is a
 * rich-text tag and the rest are its children.
 */
function valuesFor(parts: Part, into: Values, plural: number): Values {
  if (!Array.isArray(parts)) return into;
  for (const part of parts) {
    if (!Array.isArray(part)) continue;
    const [name, kind, ...rest] = part as [string, unknown, ...unknown[]];
    if (kind === undefined) {
      into[name] = 'x';
    } else if (typeof kind === 'number' && kind !== 0) {
      switch (kind) {
        case 1: {
          // A select: any value resolves, but naming a real branch exercises
          // one rather than always falling through to `other`.
          const options = rest[0] as Record<string, Part>;
          into[name] = Object.keys(options)[0]?.replace(/^=/, '') ?? 'other';
          for (const branch of Object.values(options)) valuesFor(branch, into, plural);
          break;
        }
        case 2:
        case 3:
          into[name] = plural;
          for (const branch of Object.values(rest[0] as Record<string, Part>)) {
            valuesFor(branch, into, plural);
          }
          break;
        case 4:
          into[name] = 42;
          break;
        default:
          into[name] = new Date('2026-03-14T09:30:00Z');
      }
    } else {
      into[name] = (chunks: unknown) => (Array.isArray(chunks) ? chunks.join('') : String(chunks));
      valuesFor([kind, ...rest], into, plural);
    }
  }
  return into;
}

describe('every message survives the path that ships', () => {
  for (const [file, catalogue] of catalogues()) {
    const locale = file.replace(/^kiosk[\\/]/, '').replace(/\.json$/, '');

    it(`compiles and formats ${file}`, () => {
      for (const [key, source] of flatten(catalogue)) {
        const compiled = compile(source);
        for (const plural of [0, 1, 5]) {
          const values = valuesFor(compiled, {}, plural);
          const rendered = formatMessage(key, compiled as never, values as never, {
            locale,
            formatters,
            timeZone: 'America/Los_Angeles',
          } as never);
          const text = Array.isArray(rendered) ? rendered.join('') : String(rendered);
          expect(text.trim(), `${file}: ${key} formatted to nothing`).not.toBe('');
        }
      }
    });
  }
});

/**
 * `t.raw` cannot work here, and says so at runtime rather than at build time.
 *
 * Compiling a message throws its source away, so `use-intl` refuses `t.raw`
 * outright when the precompiled formatter is in use. Nothing needs it today;
 * this is the note that would otherwise be discovered by a blank screen.
 */
describe('nothing asks for a message it cannot have', () => {
  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sources(full, found);
      else if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
    return found;
  }

  it('never calls t.raw', () => {
    const guilty = sources(path.join(process.cwd(), 'src')).filter((file) =>
      /\bt\.raw\s*\(/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(guilty, 'messages are precompiled, so `t.raw` throws — use `t.rich`').toEqual([]);
  });
});
