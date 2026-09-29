/**
 * The two halves of the kiosk's portrait-only rule that are not a screen: the
 * orientation lock, and the question of whether the glass is sideways. See
 * components/PortraitOnly.tsx for how the three layers fit together. Their own
 * module so that file stays component-only (fast refresh).
 */
import { useSyncExternalStore } from 'react';

const LANDSCAPE = '(orientation: landscape)';

/**
 * The slice of the Screen Orientation API this uses.
 *
 * Declared here for the reason `wakeLock.ts` declares its own: `lock` has
 * come and gone from the DOM lib, and a kiosk that fails to typecheck on a
 * lib bump is a poor trade for one line.
 */
interface LockableOrientation {
  lock?: (orientation: 'portrait') => Promise<void>;
}

/** Ask the device to hold portrait. Refusal is the common answer and is fine. */
export function lockPortrait(): void {
  const orientation = (globalThis.screen as { orientation?: LockableOrientation } | undefined)
    ?.orientation;
  try {
    void orientation?.lock?.('portrait').catch(() => {
      // Not fullscreen, not supported, or not allowed — the screen below
      // covers every one of those.
    });
  } catch {
    // Engines that throw synchronously rather than rejecting.
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(LANDSCAPE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isSideways(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(LANDSCAPE).matches;
}

/** Whether the kiosk is currently wider than it is tall. */
export function useSideways(): boolean {
  return useSyncExternalStore(subscribe, isSideways, () => false);
}
