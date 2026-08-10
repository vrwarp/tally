/**
 * The look a gathering lends the lobby kiosk.
 *
 * A church running a bright Sunday nursery, a Wednesday small group and a summer
 * holiday club puts the same slab of navy on every shelf, and a parent walking up
 * gets no signal about which room the screen in front of them is for. A gathering
 * can now say what its kiosk looks like: a ground, and three hues.
 *
 * ## Three slots, named for the job rather than the rank
 *
 * Not primary/secondary/tertiary. Those are a rank ordering, and the kiosk has
 * nothing to rank — there is no secondary button and no tertiary chip, so two of
 * the three slots would need screen furniture invented to justify them. What the
 * kiosk *does* have is a palette that is already semantic, so each slot is named
 * after what its family already does:
 *
 *   - `accent`   → `brand-*`   what you touch: keys, the primary button, focus
 *                              rings, the hold-to-confirm fill.
 *   - `confirm`  → `present-*` what just happened: "✓ Checked in", the success
 *                              screen, the green check-in button.
 *   - `backdrop` → `ink-*`     the wash on the page, the cards and the chips.
 *
 * And a line that does not move: **`warn` and `danger` are not themeable.**
 * `text-warn-400` is what an allergy line is painted in, on the screen and on the
 * printed label. A gathering that softened its warning colour to match its theme
 * would be recolouring the one thing whose whole job is to stop a child being
 * handed the wrong food. Amber stays amber — which is also why `CONFIRM_HUES`
 * drops the amber band, since a tick recoloured to `ember` would put two amber
 * things on one screen meaning opposite things.
 *
 * ## Where this runs
 *
 * On the server and in the main app — never on the kiosk. `functions/src/kiosk/
 * events.ts` calls `kioskPalette()` while building the chooser rows and sends
 * finished hex; the kiosk loops over that and calls `setProperty`. It is the same
 * rule that already makes occurrence projection a server job: the kiosk never
 * reads an event document, so everything per-event it knows arrives pre-chewed on
 * the row. `src/kiosk/` imports the types from here and nothing else, and
 * `scripts/check-kiosk-budget.mjs` fails the build if that stops being true.
 *
 * Mirrored into `functions/src/generated/` by `scripts/sync-functions-shared.mjs`,
 * so it must stay import-free.
 */

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

export type KioskGround = 'dark' | 'light';

/**
 * The families this file knows the colours of.
 *
 * Three of them a gathering may turn. `warn` is here to be *read* — the editor
 * paints an allergy line in its preview so a leader can see that it does not
 * move — and it is absent from `FAMILIES`, which is the list `kioskPalette`
 * walks. Nothing can rotate it, and `src/kiosk/theme.ts` refuses to set it even
 * if something tried.
 */
export type KioskFamily = 'ink' | 'brand' | 'present' | 'warn';

export interface KioskTheme {
  ground: KioskGround;
  /** Hue names from `KIOSK_HUES`. Stored by name, the way `icon` is. */
  accent: string;
  confirm: string;
  backdrop: string;
}

/** Resolved custom properties: `--color-ink-950` → `#0e0406`. */
export type KioskPalette = Record<string, string>;

export interface KioskHue {
  /** Stored on the event, so it must not change. */
  name: string;
  /** What the picker calls it. */
  label: string;
  /** Degrees on the OKLCH hue circle. */
  h: number;
}

/**
 * One wheel, drawn on by all three slots.
 *
 * The three defaults are the hues Tally already wears — `sky` is `brand-500`'s own
 * hue, `forest` is `present-500`'s, `indigo` is `ink-950`'s. That is what lets a
 * default slot be answered with the stylesheet's values verbatim instead of with a
 * round-trip through the colour maths. See `rotate`.
 */
export const KIOSK_HUES: readonly KioskHue[] = [
  { name: 'sky', label: 'Sky', h: 237 },
  { name: 'indigo', label: 'Indigo', h: 265 },
  { name: 'violet', label: 'Violet', h: 295 },
  { name: 'magenta', label: 'Magenta', h: 340 },
  { name: 'berry', label: 'Berry', h: 5 },
  { name: 'ember', label: 'Ember', h: 55 },
  { name: 'amber', label: 'Amber', h: 75 },
  { name: 'forest', label: 'Forest', h: 150 },
  { name: 'teal', label: 'Teal', h: 195 },
];

/**
 * What the confirm slot may be.
 *
 * The amber band is missing on purpose. `warn` is fixed at amber because it is
 * what an allergy line is painted in, and a check-in tick in the same colour would
 * put two amber things on one screen meaning opposite things.
 */
export const CONFIRM_HUES: readonly KioskHue[] = KIOSK_HUES.filter(
  (hue) => hue.name !== 'ember' && hue.name !== 'amber' && hue.name !== 'berry',
);

export const DEFAULT_KIOSK_THEME: KioskTheme = {
  ground: 'dark',
  accent: 'sky',
  confirm: 'forest',
  backdrop: 'indigo',
};

/**
 * Which family answers which slot, and so which families may be turned at all.
 *
 * `warn` is deliberately not here. It is what an allergy line is painted in, on
 * the screen and on the printed label, and a gathering that softened it to match
 * its theme would be recolouring the one thing whose whole job is to stop a
 * child being handed the wrong food.
 */
const FAMILIES: readonly { family: KioskFamily; slot: 'accent' | 'confirm' | 'backdrop' }[] = [
  { family: 'brand', slot: 'accent' },
  { family: 'present', slot: 'confirm' },
  { family: 'ink', slot: 'backdrop' },
];

export function findKioskHue(name: unknown): KioskHue | undefined {
  return KIOSK_HUES.find((hue) => hue.name === name);
}

/* -------------------------------------------------------------------------- */
/* The ramps, exactly as `src/index.css` holds them                            */
/* -------------------------------------------------------------------------- */

/**
 * A copy of the design tokens, and the one real hazard in this file.
 *
 * These have to be numbers a program can turn, and the originals are CSS. The
 * duplication is kept honest by `kioskTheme.test.ts`, which parses `src/index.css`
 * and fails if a single value has drifted — so a designer editing the stylesheet
 * gets a red build rather than a kiosk that quietly disagrees with the app beside
 * it.
 */
export const KIOSK_SOURCE_RAMPS: Record<
  KioskGround,
  Record<KioskFamily, Record<string, string>>
> = {
  dark: {
    ink: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
      950: '#020617',
    },
    brand: {
      200: '#bae6fd',
      300: '#7dd3fc',
      400: '#38bdf8',
      500: '#0ea5e9',
      600: '#0284c7',
      700: '#0369a1',
    },
    present: { 400: '#4ade80', 500: '#22c55e', 600: '#16a34a' },
    warn: { 400: '#facc15', 500: '#eab308', 600: '#ca8a04' },
  },
  light: {
    ink: {
      50: '#0f172a',
      100: '#1e293b',
      200: '#334155',
      300: '#475569',
      400: '#576375',
      500: '#5c6b82',
      600: '#8b97a8',
      700: '#c7d5e6',
      800: '#dde9f8',
      900: '#f4f9ff',
      950: '#e4f1fe',
    },
    brand: {
      200: '#075985',
      300: '#0369a1',
      400: '#0284c7',
      500: '#0284c7',
      600: '#0369a1',
      700: '#075985',
    },
    present: { 400: '#007634', 500: '#16a34a', 600: '#15803d' },
    warn: { 400: '#a16207', 500: '#ca8a04', 600: '#854d0e' },
  },
};

/* -------------------------------------------------------------------------- */
/* OKLCH                                                                       */
/* -------------------------------------------------------------------------- */

/*
 * Why a colour space at all, rather than a list of nice hexes per hue.
 *
 * Tailwind's ramps are not perceptually aligned across hues — `amber-400` is far
 * lighter than `violet-400` — so "the accent at slot 400" would mean a different
 * readability depending on which colour somebody picked, and a button's contrast
 * would be an accident of hue.
 *
 * Tally's own ramps, measured in OKLCH, turn out to be regular ladders: a clean
 * lightness descent under a chroma arc. So every themed ramp is *that ladder with
 * the hue turned* — each slot keeps its exact lightness and chroma, and only `h`
 * moves. Contrast then belongs to the slot rather than to the hue, which is what
 * makes tinting the page safe at all: measured across the whole wheel, `ink-100`
 * on `ink-950` moves 18.4 → 18.2, and every other pair likewise.
 *
 * The turn is a *delta* from the family's own default hue rather than an absolute
 * setting, because the ink ramp drifts from 248° at `ink-50` to 266° at `ink-950`
 * and flattening that would throw away the shape of it.
 */

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

export interface Oklch {
  L: number;
  C: number;
  h: number;
}

export function hexToOklch(hex: string): Oklch {
  const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bStar = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return {
    L,
    C: Math.hypot(a, bStar),
    h: ((Math.atan2(bStar, a) * 180) / Math.PI + 360) % 360,
  };
}

function oklchToLinearRgb(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: readonly number[]): boolean =>
  rgb.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);

/**
 * OKLCH to a hex, pulling chroma in until the colour fits sRGB.
 *
 * Turning the hue of a ramp built around blue can walk a slot off the edge of the
 * gamut — there is no such thing as a vivid yellow at `ink-950`'s lightness.
 * Clipping the channels instead would shift the lightness, which is the one
 * property this whole scheme depends on holding still, so chroma is what gives
 * way. Bisection rather than a formula because the gamut boundary has no closed
 * form; twenty-four halvings land well inside one 8-bit step.
 */
export function oklchToHex(L: number, C: number, h: number): string {
  let chroma = C;
  if (!inGamut(oklchToLinearRgb(L, chroma, h))) {
    let low = 0;
    let high = chroma;
    for (let i = 0; i < 24; i += 1) {
      const mid = (low + high) / 2;
      if (inGamut(oklchToLinearRgb(L, mid, h))) low = mid;
      else high = mid;
    }
    chroma = low;
  }

  const channels = oklchToLinearRgb(L, chroma, h).map((channel) => {
    const value = Math.round(Math.min(1, Math.max(0, linearToSrgb(channel))) * 255);
    return value.toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
}

/* -------------------------------------------------------------------------- */
/* Reading a stored theme                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A stored value, made safe.
 *
 * Every slot falls back on its own, so an event carrying a hue Tally no longer
 * ships gets the default for that slot and keeps the two that still read — the
 * same bargain `findEventIcon` strikes. Null in, null out: an unthemed gathering
 * is the ordinary case and has to stay cheap.
 */
export function sanitizeKioskTheme(value: unknown): KioskTheme | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Record<keyof KioskTheme, unknown>>;

  const hue = (slot: 'accent' | 'confirm' | 'backdrop', offered = KIOSK_HUES): string =>
    offered.find((entry) => entry.name === raw[slot])?.name ?? DEFAULT_KIOSK_THEME[slot];

  return {
    ground: raw.ground === 'light' ? 'light' : 'dark',
    accent: hue('accent'),
    // Narrowed to the confirm wheel, so a hand-written document cannot put an
    // amber tick beside an amber allergy warning.
    confirm: hue('confirm', CONFIRM_HUES),
    backdrop: hue('backdrop'),
  };
}

/* -------------------------------------------------------------------------- */
/* Resolving a palette                                                         */
/* -------------------------------------------------------------------------- */

function rotate(
  family: KioskFamily,
  ground: KioskGround,
  hueName: string,
  fallback: string,
): Record<string, string> | null {
  // The default is answered with the stylesheet's own values rather than with a
  // round-trip through the maths, so an unthemed slot is today's slot exactly and
  // not something within a rounding step of it.
  if (hueName === fallback) return null;

  const from = findKioskHue(fallback);
  const to = findKioskHue(hueName);
  if (!from || !to) return null;

  const delta = to.h - from.h;
  const rotated: Record<string, string> = {};
  for (const [step, hex] of Object.entries(KIOSK_SOURCE_RAMPS[ground][family])) {
    const { L, C, h } = hexToOklch(hex);
    rotated[step] = oklchToHex(L, C, (h + delta + 360) % 360);
  }
  return rotated;
}

/**
 * The custom properties a kiosk should set, or null when it should set none.
 *
 * Only slots that actually differ from the stylesheet come back: a gathering that
 * picked a light ground and nothing else sends no colours at all, and an unthemed
 * one sends nothing anywhere. What this returns is the whole of what the kiosk is
 * ever told on the subject — it does no colour work of its own, and
 * `src/kiosk/theme.ts` is a validator and a loop.
 */
export function kioskPalette(theme: KioskTheme | null | undefined): KioskPalette | null {
  if (!theme) return null;

  const palette: KioskPalette = {};
  for (const { family, slot } of FAMILIES) {
    const source = KIOSK_SOURCE_RAMPS[theme.ground][family];
    const rotated = rotate(family, theme.ground, theme[slot], DEFAULT_KIOSK_THEME[slot]);
    if (!rotated) continue;
    for (const [step, hex] of Object.entries(rotated)) {
      if (hex !== source[step]) palette[`--color-${family}-${step}`] = hex;
    }
  }

  return Object.keys(palette).length > 0 ? palette : null;
}
