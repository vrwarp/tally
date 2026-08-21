/**
 * The stylesheet, held to its own promises.
 *
 * Three of those promises are load-bearing, and none of them is about a function
 * returning what it was told to return:
 *
 *  1. **A class that names a rung the ramp does not hold emits nothing.** Not a
 *     warning, not a fallback — Tailwind simply does not write the rule, and the
 *     element inherits whatever held it. That has now been a real bug three
 *     times (`brand-200`, then `danger-300` on the one strip that reports a
 *     failure, then `brand-100`/`present-300`/`warn-300`), and every time it was
 *     found by eye rather than by a build. This walks `src/` and fails on the
 *     next one.
 *  2. **Every colour is declared on both grounds.** The light theme is one block
 *     of overrides; a token defined only in the dark block is a colour that was
 *     picked for near-black and will be wrong in daylight.
 *  3. **The ink on a filled control clears AA against the fill it is printed
 *     on** — measured on the *tint* where there is one, because a colour picked
 *     bare on a card and then laid on a wash of its own accent loses a
 *     surprising amount, and always in the light theme, where nobody reviewing
 *     the dark screens will ever see it.
 *
 * `src/lib/kioskTheme.test.ts` is the precedent for the shape: read the
 * stylesheet off disk, not through a bundler, and compare against what the code
 * actually asks for.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* -------------------------------------------------------------------------- */
/* Reading the stylesheet                                                      */
/* -------------------------------------------------------------------------- */

const CSS = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

const LIGHT_SELECTOR = ":root[data-theme='light']";
const DARK_BLOCK = CSS.slice(CSS.indexOf('@theme'), CSS.indexOf(LIGHT_SELECTOR));
const LIGHT_BLOCK = CSS.slice(CSS.indexOf(LIGHT_SELECTOR));

/** Every `--color-…` declaration in a slice of the file, last one winning. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of block.matchAll(/(--color-[a-z0-9-]+):\s*([^;]+);/g)) {
    found.set(match[1]!, match[2]!.trim());
  }
  return found;
}

const DARK_RAW = declarations(DARK_BLOCK);
const LIGHT_RAW = new Map([...DARK_RAW, ...declarations(LIGHT_BLOCK)]);

/**
 * The hex a token actually paints, following `var(--color-…)` aliases.
 *
 * Several tokens are aliases on purpose — the label on a filled control is the
 * ground it sits near, spelled as the ground rather than as a copy of it, so a
 * themed kiosk that re-picks the ground carries the label with it. Resolving
 * them here is what lets the contrast assertions below measure what a browser
 * would paint rather than the string the stylesheet holds.
 */
function resolved(raw: Map<string, string>): Map<string, string> {
  const follow = (name: string, depth = 0): string => {
    const value = raw.get(name);
    if (value === undefined) throw new Error(`${name} is not declared`);
    const alias = /^var\((--color-[a-z0-9-]+)\)$/.exec(value);
    if (alias && depth < 8) return follow(alias[1]!, depth + 1);
    return value;
  };
  return new Map([...raw.keys()].map((name) => [name, follow(name)]));
}

const DARK = resolved(DARK_RAW);
const LIGHT = resolved(LIGHT_RAW);
const GROUNDS = { dark: DARK, light: LIGHT } as const;
type Ground = keyof typeof GROUNDS;

const hex = (ground: Ground, token: string): string => {
  const value = GROUNDS[ground].get(`--color-${token}`);
  if (value === undefined) throw new Error(`--color-${token} is not declared`);
  return value;
};

/* -------------------------------------------------------------------------- */
/* Contrast                                                                    */
/* -------------------------------------------------------------------------- */

const srgbToLinear = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);

const channels = (value: string): [number, number, number] =>
  [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)) as [number, number, number];

/** WCAG relative luminance. */
function luminance(value: string): number {
  const [r, g, b] = channels(value).map((channel) => srgbToLinear(channel / 255)) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * What `bg-warn-500/10` actually paints: the accent composited onto its ground.
 *
 * This is the whole point of the accent assertions. A tint is not the card, and
 * a colour that clears AA bare on the card can be under it on the wash it was
 * drawn for — which is exactly how twenty advisory panels came to be a fraction
 * short in daylight while the dark theme read 7:1 and hid it.
 */
function over(top: string, bottom: string, alpha: number): string {
  const [tr, tg, tb] = channels(top);
  const [br, bg, bb] = channels(bottom);
  const blend = (t: number, b: number) => Math.round(t * alpha + b * (1 - alpha));
  return `#${[blend(tr, br), blend(tg, bg), blend(tb, bb)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Text at the sizes this app prints, which is never "large" by WCAG's measure. */
const AA = 4.5;

/* -------------------------------------------------------------------------- */
/* 1. Every ramp class used in `src/` resolves to a step that exists           */
/* -------------------------------------------------------------------------- */

const FAMILIES = 'ink|brand|present|warn|danger';

/*
 * The utility prefixes a ramp step can appear behind. Deliberately a list rather
 * than "anything before the family name": prose mentions a step by name all over
 * this codebase — the note in `ReviewPage` that explains this very bug says
 * "`danger-400`, not `danger-300`" — and a guard that reads comments as code
 * would fail on a file explaining why it must not.
 */
const UTILITIES = [
  'text',
  'bg',
  'border',
  'ring',
  'inset-ring',
  'outline',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'decoration',
  'accent',
  'caret',
  'divide',
  'placeholder',
  'shadow',
  'inset-shadow',
  'text-shadow',
].join('|');

const USED = new RegExp(`(?<![a-zA-Z0-9])(?:${UTILITIES})-(${FAMILIES})-(\\d+)`, 'g');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(tsx?|css|html)$/.test(name)) found.push(full);
  }
  return found;
}

describe('the ramp', () => {
  const root = resolve(process.cwd(), 'src');

  const used = new Map<string, string[]>();
  for (const file of sourceFiles(root)) {
    for (const match of readFileSync(file, 'utf8').matchAll(USED)) {
      const step = `${match[1]}-${match[2]}`;
      used.set(step, [...(used.get(step) ?? []), file.slice(root.length + 1)]);
    }
  }

  it('is asked for steps that exist', () => {
    // Reported all at once: fixing these one red test at a time is how three of
    // them shipped.
    const missing = [...used.entries()]
      .filter(([step]) => !DARK_RAW.has(`--color-${step}`))
      .map(([step, files]) => `${step} (${[...new Set(files)].join(', ')})`);
    expect(missing, 'classes naming a ramp step `@theme` does not declare').toEqual([]);
  });

  it('found the classes it was looking for', () => {
    // A scanner that silently matches nothing passes the test above forever.
    expect(used.size).toBeGreaterThan(20);
  });

  it('declares every colour on both grounds', () => {
    const darkOnly = [...DARK_RAW.keys()].filter(
      (token) => !declarations(LIGHT_BLOCK).has(token),
    );
    expect(darkOnly, 'declared for near-black and never re-picked for paper').toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. The ink on a filled control, against the fill it lands on                */
/* -------------------------------------------------------------------------- */

/*
 * `Button` is read off disk rather than imported so that the class names and the
 * measured tokens cannot drift apart: the assertion is not "these tokens are
 * legible together" but "this button pairs these tokens".
 */
const BUTTON = readFileSync(
  resolve(process.cwd(), 'src/components/ui/Button.tsx'),
  'utf8',
);

const FILLED = [
  {
    variant: 'primary',
    ink: 'brand-ink',
    fills: ['brand-fill', 'brand-fill-hover'],
    classes: [
      'bg-brand-fill',
      'text-brand-ink',
      'hover:bg-brand-fill-hover',
      'focus-visible:outline-brand-ink',
    ],
  },
  {
    variant: 'success',
    ink: 'present-ink',
    fills: ['present-600', 'present-fill-hover'],
    classes: [
      'bg-present-600',
      'text-present-ink',
      'hover:bg-present-fill-hover',
      'focus-visible:outline-present-ink',
    ],
  },
  {
    variant: 'danger',
    ink: 'danger-ink',
    fills: ['danger-600', 'danger-700'],
    classes: [
      'bg-danger-600',
      'text-danger-ink',
      'hover:bg-danger-700',
      'focus-visible:outline-danger-ink',
    ],
  },
] as const;

describe('a filled button', () => {
  it.each(FILLED)('names its fill, its label and its ring ($variant)', ({ classes }) => {
    for (const className of classes) expect(BUTTON).toContain(className);
  });

  it('prints no label in `white`', () => {
    // White is not a project token, so it cannot flip — which is how the same
    // label came to be 2.77:1 on one ground and 4.10:1 on the other.
    expect(BUTTON).not.toContain('text-white');
  });

  const cases = (['dark', 'light'] as const).flatMap((ground) =>
    FILLED.flatMap(({ variant, ink, fills }) =>
      fills.map((fill) => ({ ground, variant, ink, fill })),
    ),
  );

  it.each(cases)(
    '$ground: $variant reads its label on $fill',
    ({ ground, ink, fill }) => {
      expect(contrast(hex(ground, ink), hex(ground, fill))).toBeGreaterThanOrEqual(AA);
    },
  );

  /*
   * The ring is the label's ink, so it inherits those ratios — but the bar it
   * has to clear is the 3:1 of a non-text indicator, and stating it separately
   * is what keeps the two from being confused if the ring ever stops being the
   * label. Before this, the global brand ring measured 1.00:1 on the light
   * primary: the ring slot and the fill under it are the same hex.
   */
  it.each(cases)('$ground: $variant shows a ring on $fill', ({ ground, ink, fill }) => {
    expect(contrast(hex(ground, ink), hex(ground, fill))).toBeGreaterThanOrEqual(3);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Accent text, measured on the tint rather than on the card                */
/* -------------------------------------------------------------------------- */

/**
 * Where each newly declared step is actually printed.
 *
 * Not "on a card". `text-brand-100` is a count inside an active filter chip, so
 * it is two brand washes deep; `text-present-300` is a date on a present wash;
 * `text-warn-300` is the stale-record warning on an amber one. Each is measured
 * on the ground it has, on both themes, and on the page as well as the card
 * because the same panels appear on both.
 */
const ON_TINT = [
  { text: 'brand-100', tint: 'brand-500', alphas: [0.2, 0.25] },
  { text: 'present-300', tint: 'present-500', alphas: [0.15] },
  { text: 'present-300', tint: 'present-500', alphas: [0.2] },
  { text: 'warn-300', tint: 'warn-500', alphas: [0.1] },
  { text: 'warn-300', tint: 'warn-500', alphas: [0.25] },
] as const;

describe('accent text on its own tint', () => {
  const cases = (['dark', 'light'] as const).flatMap((ground) =>
    (['ink-900', 'ink-950'] as const).flatMap((base) =>
      ON_TINT.map((entry) => ({ ground, base, ...entry })),
    ),
  );

  it.each(cases)('$ground: $text on $tint over $base', ({ ground, text, tint, base, alphas }) => {
    const painted = alphas.reduce(
      (below, alpha) => over(hex(ground, tint), below, alpha),
      hex(ground, base),
    );
    expect(contrast(hex(ground, text), painted)).toBeGreaterThanOrEqual(AA);
  });
});

/* -------------------------------------------------------------------------- */
/* Known short, and not fixable from here                                      */
/* -------------------------------------------------------------------------- */

/*
 * The four below are measured and real, and every one of them is a *value* on an
 * existing rung rather than a new rung. `src/lib/kioskTheme.ts` holds a hand copy
 * of these ramps and `kioskTheme.test.ts` fails the build on any drift between
 * the two, so moving one of these hexes here — without moving it there, in a
 * file this change does not own — turns a contrast fix into a red suite and a
 * kiosk that disagrees with the app beside it. They are recorded here rather
 * than in a ticket because this is the file that will be read the next time
 * somebody asks whether the ramp has been audited.
 *
 *   dark ink-500      3.75:1 on a card, 4.24:1 on the page, ~173 sites, most of
 *                     them 11–12px. Wants roughly #7c8ba3 (5.3 / 6.0).
 *   ink-600           2.36:1 dark and 2.80:1 light on a card, and used as
 *                     informational text at ~21 sites. It should be reserved for
 *                     borders and `disabled:`.
 *   light warn-400    4.23:1 on `warn-500/10` and 4.04:1 on `/15` — it clears
 *                     4.65:1 bare on the card, which is why it was signed off.
 *   light present-400 4.39:1 on `present-500/20`, 4.10:1 on the page.
 *   light brand-400   3.87:1 on a card and 3.57:1 on the page, carrying the
 *                     wordmark and the active phone tab. It is the same hex as
 *                     `brand-500`; ~#075985 would clear both and restore the
 *                     300 < 400 < 500 order the dark ramp has.
 */
describe('blocked on the kiosk’s copy of the ramp', () => {
  it.todo('dark ink-500 clears 4.5:1 on a card');
  it.todo('ink-600 is not used as text on either ground');
  it.todo('light warn-400 clears 4.5:1 on a warn tint');
  it.todo('light present-400 clears 4.5:1 on a present tint');
  it.todo('light brand-400 clears 4.5:1 on a card and on the page');
});
