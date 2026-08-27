/**
 * What the kiosk would actually paint, for the editor's previews.
 *
 * One resolver feeding two fields — the colour picker's strip and the photo
 * field's orientation crops — and it is the same `kioskPalette()` the kiosk
 * itself is sent, which is what stops the office and the shelf disagreeing.
 * Its own module rather than a helper inside either field so that the fields
 * stay component-only files (fast refresh) and neither imports the other.
 */
import { KIOSK_SOURCE_RAMPS, kioskPalette, type KioskTheme } from '@/lib/kioskTheme';

/** The stylesheet's own values, with the gathering's palette over them. */
export function painted(theme: KioskTheme): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [family, ramp] of Object.entries(KIOSK_SOURCE_RAMPS[theme.ground])) {
    for (const [step, hex] of Object.entries(ramp)) base[`--color-${family}-${step}`] = hex;
  }
  return { ...base, ...(kioskPalette(theme) ?? {}) };
}
