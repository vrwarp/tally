/**
 * What this file is really for.
 *
 * Three of these assertions are the load-bearing ones, and none of them is about
 * a function returning what it was told to return:
 *
 *  1. The ramps in `kioskTheme.ts` are a hand copy of `src/index.css`. This parses
 *     the stylesheet and fails on any drift, so a designer editing a token gets a
 *     red build instead of a kiosk that disagrees with the app beside it.
 *  2. Every hue on the wheel clears WCAG AA at the slots that carry text, on both
 *     grounds. This is what makes an arbitrary hue safe to offer at all.
 *  3. Contrast is *aligned* across hues — the property the whole hue-rotation
 *     scheme exists to produce, and the first thing to die quietly the day
 *     somebody drops a favourite hex into the table.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONFIRM_HUES,
  DEFAULT_KIOSK_THEME,
  KIOSK_HUES,
  KIOSK_SOURCE_RAMPS,
  kioskPalette,
  sanitizeKioskTheme,
  type KioskGround,
  type KioskTheme,
} from './kioskTheme';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

/** WCAG relative luminance, which is not OKLCH lightness and is the point. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const theme = (over: Partial<KioskTheme> = {}): KioskTheme => ({ ...DEFAULT_KIOSK_THEME, ...over });

/** What a kiosk would actually paint: the stylesheet, with the palette laid over. */
function resolved(t: KioskTheme): Record<string, string> {
  const painted: Record<string, string> = {};
  for (const [family, ramp] of Object.entries(KIOSK_SOURCE_RAMPS[t.ground])) {
    for (const [step, hex] of Object.entries(ramp)) painted[`--color-${family}-${step}`] = hex;
  }
  return { ...painted, ...(kioskPalette(t) ?? {}) };
}

/* -------------------------------------------------------------------------- */
/* 1. The copy of index.css has not drifted                                    */
/* -------------------------------------------------------------------------- */

describe('the source ramps', () => {
  // Read from disk rather than imported: the point is to compare against what the
  // stylesheet actually says, not against anything a bundler has been through.
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

  /** The `@theme` block is dark; `:root[data-theme='light']` overrides it. */
  function declaredIn(block: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const match of block.matchAll(/--color-(ink|brand|present|warn)-(\d+):\s*(#[0-9a-f]{6})/g)) {
      found.set(`${match[1]}-${match[2]}`, match[3]);
    }
    return found;
  }

  const darkBlock = css.slice(css.indexOf('@theme'), css.indexOf(":root[data-theme='light']"));
  const lightBlock = css.slice(css.indexOf(":root[data-theme='light']"));

  const dark = declaredIn(darkBlock);
  const light = new Map([...dark, ...declaredIn(lightBlock)]);

  it.each([
    ['dark', dark],
    ['light', light],
  ] as const)('match src/index.css on the %s ground', (ground, declared) => {
    for (const [family, ramp] of Object.entries(KIOSK_SOURCE_RAMPS[ground as KioskGround])) {
      for (const [step, hex] of Object.entries(ramp)) {
        expect(declared.get(`${family}-${step}`), `--color-${family}-${step}`).toBe(hex);
      }
    }
  });

  it('covers every ink step the stylesheet defines', () => {
    const inkSteps = [...dark.keys()].filter((key) => key.startsWith('ink-')).length;
    expect(Object.keys(KIOSK_SOURCE_RAMPS.dark.ink)).toHaveLength(inkSteps);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 & 3. Contrast: absolute, and aligned across the wheel                     */
/* -------------------------------------------------------------------------- */

describe('contrast', () => {
  const grounds: KioskGround[] = ['dark', 'light'];

  /*
   * The pairs the kiosk actually leans on. `ink-100` on `ink-950` is body copy on
   * the page, `ink-300` on `ink-900` is a supporting line on a card, `brand-300`
   * and `present-400` are the two accents that are ever *text*.
   */
  const readable = [
    ['--color-ink-100', '--color-ink-950'],
    ['--color-ink-100', '--color-ink-900'],
    ['--color-ink-300', '--color-ink-900'],
    ['--color-brand-300', '--color-ink-950'],
    ['--color-present-400', '--color-ink-950'],
  ] as const;

  it.each(grounds)('clears AA at every hue on the %s ground', (ground) => {
    for (const hue of KIOSK_HUES) {
      const painted = resolved(
        theme({ ground, accent: hue.name, backdrop: hue.name, confirm: 'forest' }),
      );
      for (const [fg, bg] of readable) {
        expect(contrast(painted[fg], painted[bg]), `${hue.name} ${fg} on ${bg}`).toBeGreaterThan(
          4.5,
        );
      }
    }
  });

  it.each(grounds)('keeps the confirm button legible under white on the %s ground', (ground) => {
    for (const hue of CONFIRM_HUES) {
      const painted = resolved(theme({ ground, confirm: hue.name }));
      // Large bold text on a filled button, so AA is 3:1 rather than 4.5:1.
      expect(contrast(painted['--color-present-600'], '#ffffff'), hue.name).toBeGreaterThan(3);
    }
  });

  /*
   * The one that matters most. Holding each slot's lightness and chroma and
   * turning only the hue is supposed to make readability a property of the slot
   * rather than of the colour; if that ever stops being true, every other
   * assertion here still passes while the feature quietly stops being safe.
   */
  it.each(grounds)('lands within a point across the whole wheel on the %s ground', (ground) => {
    for (const [fg, bg] of readable) {
      const ratios = KIOSK_HUES.map((hue) =>
        contrast(
          resolved(theme({ ground, accent: hue.name, backdrop: hue.name }))[fg],
          resolved(theme({ ground, accent: hue.name, backdrop: hue.name }))[bg],
        ),
      );
      const spread = Math.max(...ratios) - Math.min(...ratios);
      // Measured worst case is 0.89 (brand-300 on the dark page). A point leaves
      // room for a new hue without leaving room for a hand-picked hex.
      expect(spread, `${fg} on ${bg} spread ${spread.toFixed(2)}`).toBeLessThan(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The default is today, exactly                                               */
/* -------------------------------------------------------------------------- */

describe('kioskPalette', () => {
  it('paints nothing for an unthemed gathering', () => {
    expect(kioskPalette(null)).toBeNull();
    expect(kioskPalette(undefined)).toBeNull();
  });

  it('paints nothing when every slot is the one Tally already wears', () => {
    // Not "close to today" — the same bytes. A kiosk that nobody themed has to be
    // the kiosk that shipped, so the default is answered with the stylesheet's own
    // values rather than round-tripped through the colour maths.
    expect(kioskPalette(theme())).toBeNull();
    expect(kioskPalette(theme({ ground: 'light' }))).toBeNull();
  });

  it('turns only the family whose slot moved', () => {
    const palette = kioskPalette(theme({ accent: 'ember' })) ?? {};
    expect(Object.keys(palette).every((key) => key.startsWith('--color-brand-'))).toBe(true);
    expect(palette['--color-brand-400']).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette['--color-brand-400']).not.toBe(KIOSK_SOURCE_RAMPS.dark.brand[400]);
  });

  it('never writes warn or danger', () => {
    for (const hue of KIOSK_HUES) {
      const palette = kioskPalette(theme({ accent: hue.name, backdrop: hue.name })) ?? {};
      for (const key of Object.keys(palette)) {
        expect(key).not.toMatch(/warn|danger/);
      }
    }
  });

  it('tints the page but leaves a light card white', () => {
    // Pure white has no hue to turn, and a tinted card on paper reads as a stain.
    const palette = kioskPalette(theme({ ground: 'light', backdrop: 'ember' })) ?? {};
    expect(palette['--color-ink-900']).toBeUndefined();
    expect(palette['--color-ink-950']).not.toBe(KIOSK_SOURCE_RAMPS.light.ink[950]);
  });

  it('gives indigo and the untinted backdrop the same answer', () => {
    // Today's slate ink ramp *is* hue 265, which is what `indigo` names.
    expect(kioskPalette(theme({ backdrop: 'indigo' }))).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Reading what somebody stored                                                */
/* -------------------------------------------------------------------------- */

describe('sanitizeKioskTheme', () => {
  it('reads an absent theme as no theme', () => {
    expect(sanitizeKioskTheme(null)).toBeNull();
    expect(sanitizeKioskTheme(undefined)).toBeNull();
    expect(sanitizeKioskTheme('ember')).toBeNull();
    expect(sanitizeKioskTheme(42)).toBeNull();
  });

  it('keeps what it recognises and defaults the rest, slot by slot', () => {
    expect(
      sanitizeKioskTheme({ ground: 'light', accent: 'ember', confirm: 'nope', backdrop: 7 }),
    ).toEqual({ ground: 'light', accent: 'ember', confirm: 'forest', backdrop: 'indigo' });
  });

  it('reads any ground it does not know as dark', () => {
    expect(sanitizeKioskTheme({ ground: 'sepia' })?.ground).toBe('dark');
    expect(sanitizeKioskTheme({})?.ground).toBe('dark');
  });

  it('refuses an amber tick even when a document asks for one', () => {
    // The fence, not the picker: `firestore.rules` lets any short string through,
    // so a seed or a hand-edited document can ask for this.
    expect(sanitizeKioskTheme({ confirm: 'ember' })?.confirm).toBe('forest');
    expect(sanitizeKioskTheme({ confirm: 'amber' })?.confirm).toBe('forest');
    expect(sanitizeKioskTheme({ confirm: 'teal' })?.confirm).toBe('teal');
  });
});
