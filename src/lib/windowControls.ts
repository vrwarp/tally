import { isStandaloneDisplay } from '@/lib/embeddedBrowser';

/**
 * An installed web app on an iPad, where iPadOS draws its window controls —
 * the close / minimise / tile dots — over the top-left corner of the page.
 *
 * WebKit reports no safe-area inset for them, so the page has to know to keep
 * that corner clear itself. iPadOS asks for the desktop site and presents as a
 * Mac, so the only honest tell is a Mac with a touch screen.
 */
export function hasIPadWindowControls(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Stryker disable next-line StringLiteral: empty is "the browser told us nothing".
  const ua = navigator.userAgent || '';
  const iPad = /\biPad\b/.test(ua) || (/\bMacintosh\b/.test(ua) && navigator.maxTouchPoints > 1);
  return iPad && isStandaloneDisplay();
}

/**
 * Marks `<html>` so CSS can reserve room for the window controls — see
 * `--window-controls-*` in `index.css`.
 */
export function markWindowControls(root: HTMLElement = document.documentElement): void {
  if (hasIPadWindowControls()) root.setAttribute('data-window-controls', '');
}
