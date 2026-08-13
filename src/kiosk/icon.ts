/**
 * The gathering's icon, as one string.
 *
 * The kiosk draws an icon and knows nothing about the catalogue it came from.
 * `src/lib/eventIcons.ts` is sixty kilobytes of path data for a hundred and
 * nine glyphs, of which a bound kiosk needs exactly one — so the lookup happens
 * in `functions/src/kiosk/events.ts` while the chooser row is being built, the
 * row carries finished path data, and everything here is a validator. It is the
 * same split the palette lives by, for the same reason and against the same
 * budget: see `src/kiosk/theme.ts` and `scripts/check-kiosk-budget.mjs`, which
 * fails the build if `lib/eventIcons` ever turns up in this bundle.
 */

/**
 * SVG path data, and nothing that is not.
 *
 * Sanitised even though the server sent it, on the same argument the label
 * template and the palette are: this is what the kiosk reads back out of
 * localStorage for the rest of the evening, and a `d` attribute should never be
 * a string nothing has looked at. The grammar is the whole of SVG's — the
 * catalogue only uses `M L H V Q T Z` today, but a curve added to it upstream
 * must not come out as a gathering that lost its icon.
 *
 * A path must start with a moveto, which is what SVG itself requires and what
 * makes an empty string, a stray minus sign or somebody's idea of a URL fail
 * here rather than render as nothing.
 */
const PATH = /^[Mm][\s]*[-+0-9.][-+0-9.,eE\sAaCcHhLlMmQqSsTtVvZz]*$/;

/** Comfortably past the catalogue's longest (1,318 characters); a stop, not a limit. */
const MAX_LENGTH = 4000;

/** The path an event asked for, or null. */
export function sanitizeIconPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const path = value.trim();
  if (path.length === 0 || path.length > MAX_LENGTH) return null;
  return PATH.test(path) ? path : null;
}
