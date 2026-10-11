import { isStandaloneDisplay } from '@/lib/embeddedBrowser';

/**
 * An installed web app in an iPadOS window, where the system draws its window
 * controls — the close / minimise / tile dots — over the top-left corner of the
 * page.
 *
 * Nothing reports them: `env(safe-area-inset-*)` reads 0 there, and WebKit has
 * no Window Controls Overlay (`titlebar-area-*`). So the page works it out from
 * what it can see:
 *
 * - an iPad, which asks for the desktop site and presents as a Mac, so the
 *   honest tell is a Mac with a touch screen;
 * - installed, since in a Safari tab the browser's own chrome owns that corner;
 * - narrower than the screen, since the dots are drawn only on a window. A
 *   full-screen app has the status bar instead, which the safe-area inset does
 *   report.
 */
export function hasIPadWindowControls(): boolean {
  // Stryker disable next-line StringLiteral: empty is "the browser told us nothing".
  const ua = navigator.userAgent || '';
  const iPad = /\biPad\b/.test(ua) || (/\bMacintosh\b/.test(ua) && navigator.maxTouchPoints > 1);
  if (!iPad || !isStandaloneDisplay()) return false;

  // WebKit's `screen.width` is the portrait width whichever way the iPad is
  // held, so take the edge that runs across the screen as it is held now.
  const landscape = window.matchMedia('(orientation: landscape)').matches;
  const across = landscape
    ? Math.max(screen.width, screen.height)
    : Math.min(screen.width, screen.height);
  return window.innerWidth < across;
}

/**
 * Marks `<html>` with `data-window-controls` while the controls are there, so
 * CSS can keep that corner clear — see `.pt-window-controls` in `index.css`.
 * A window is resized, tiled and taken full screen while the app runs, so the
 * answer is kept current rather than decided once.
 */
export function watchWindowControls(root: HTMLElement = document.documentElement): () => void {
  const update = () => root.toggleAttribute('data-window-controls', hasIPadWindowControls());
  update();
  window.addEventListener('resize', update);
  return () => window.removeEventListener('resize', update);
}
