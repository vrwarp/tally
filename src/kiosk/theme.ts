/**
 * Wearing the gathering's colours, and doing no colour work to do it.
 *
 * The palette arrives finished. `functions/src/kiosk/events.ts` turned four hue
 * names into hex while it was building the chooser row, `bindEntry` put the
 * result in the binding, and everything below is a validator and a loop. That
 * split is deliberate and it is the same one the rest of this directory lives
 * by: the kiosk never reads an event document, occurrence projection happens on
 * the server, and OKLCH — a hue rotation and a gamut search per slot — is
 * exactly the kind of thing a screen on a shelf should be handed rather than
 * asked to work out. `scripts/check-kiosk-budget.mjs` fails the build if
 * `lib/kioskTheme` ever reaches this bundle.
 *
 * Custom properties are set inline on `<html>`, which beats every selector in
 * `index.css` without depending on where a block sits in it, and composes with
 * the `data-theme` attribute the ground still uses.
 */
import type { KioskGround, KioskPalette } from '@/lib/kioskTheme';

/**
 * Which properties a kiosk will set, expressed as a shape rather than a list.
 *
 * A list would have to be imported from `lib/kioskTheme`, and importing a value
 * from there is the one thing this file exists to avoid. A pattern costs
 * nothing and fences the same ground: three families and a numeric step, so
 * `--color-warn-400` cannot be written whatever the server sends. That matters
 * more than it looks — `warn` is what an allergy line is painted in.
 */
const PROPERTY = /^--color-(?:ink|brand|present)-(?:50|[1-9]00|950)$/;
const HEX = /^#[0-9a-f]{6}$/i;

/** Well past the twenty a full palette holds; a stop, not a limit. */
const MAX_PROPERTIES = 32;

/**
 * The status bar colour `kiosk.html` shipped with, read before anything moves it.
 *
 * An unbound or unthemed kiosk has to be *exactly* the kiosk that shipped, and
 * that includes the bar above it — so the untinted answer is the document's own
 * value rather than a constant retyped here that could drift from it.
 */
const SHIPPED_THEME_COLOR =
  document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null;

/**
 * A palette, made safe.
 *
 * Sanitised even though the server sent it, for the reason `bindEntry` gives
 * about label templates: this is the value the kiosk reads back out of
 * localStorage for the rest of the evening, and `setProperty` should never be
 * handed a name or a value that nothing has looked at.
 */
export function sanitizeKioskPalette(value: unknown): KioskPalette | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const safe: KioskPalette = {};
  for (const [property, hex] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(safe).length >= MAX_PROPERTIES) break;
    if (PROPERTY.test(property) && typeof hex === 'string' && HEX.test(hex)) {
      safe[property] = hex;
    }
  }

  return Object.keys(safe).length > 0 ? safe : null;
}

/**
 * Puts a gathering's look on the document, or takes it back off.
 *
 * Null for both means the kiosk that shipped: `kiosk.html` pins `data-theme` to
 * dark before anything runs, and clearing the properties hands `index.css` back
 * the ramp it already had.
 *
 * `applyTheme()` from `@/lib/theme` is deliberately not reused. It stamps the
 * same attribute, but its `theme-color` is a hardcoded `#0f172a` / `#e4f1fe` —
 * right for the main app and wrong the moment a backdrop is tinted, since that
 * meta is the colour iOS and Android paint the status bar with and a themed
 * kiosk would get a slate bar wedged above a warm screen.
 */
export function applyKioskTheme(
  ground: KioskGround | null | undefined,
  palette: KioskPalette | null | undefined,
): void {
  const root = document.documentElement;
  const safe = sanitizeKioskPalette(palette);

  root.dataset.theme = ground === 'light' ? 'light' : 'dark';

  /*
   * Clear first: rebinding a kiosk from an ember Sunday to an untouched Friday
   * has to remove what the last gathering set, not merely fail to set it again.
   *
   * Collected before removing, because `style` is a live list and deleting from
   * under an index walk skips every other entry.
   */
  const stale: string[] = [];
  for (let i = 0; i < root.style.length; i += 1) {
    const property = root.style.item(i);
    if (PROPERTY.test(property)) stale.push(property);
  }
  for (const property of stale) root.style.removeProperty(property);

  if (safe) {
    for (const [property, hex] of Object.entries(safe)) root.style.setProperty(property, hex);
  }

  // The colour behind the status bar: the page, whatever the backdrop turned it
  // into, and the shipped value when nothing turned it into anything.
  const page =
    safe?.['--color-ink-950'] ?? (ground === 'light' ? '#e4f1fe' : SHIPPED_THEME_COLOR);
  if (page) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', page);
}
