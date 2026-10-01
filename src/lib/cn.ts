/**
 * Tailwind-aware class name join, in a module of its own.
 *
 * It used to live in `src/lib/utils.ts`, and that put tailwind-merge on the
 * lobby kiosk's first paint: 26 kB minified, about 8 kB gzipped, most of it a
 * table of which Tailwind utilities override which. The kiosk never calls
 * `cn`. It imports utils for the name search and the sort, but tree-shaking is
 * decided once per build rather than once per page, so an export the main app
 * uses stays in the shared chunk for every page that loads it.
 *
 * The kiosk joins its class names with template literals and must not import
 * this. `scripts/check-kiosk-budget.mjs` fails the build if tailwind-merge
 * reaches the kiosk's graph again, by this import or any other.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware class name join. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
