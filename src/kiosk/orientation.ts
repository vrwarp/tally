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

/**
 * Ask the device to hold portrait. Refusal is the common answer and is fine.
 *
 * One `try` covers every way of not getting it: an engine without the API
 * (`orientation` or `lock` missing throws the TypeError it would anyway), an
 * engine that throws synchronously, and — through `catch` on the promise —
 * the rejection a tab that is not fullscreen gets. The screen in
 * PortraitOnly covers all of them.
 */
export function lockPortrait(): void {
  try {
    (screen as unknown as { orientation: Required<LockableOrientation> }).orientation
      .lock('portrait')
      .catch(() => {});
  } catch {
    // See above: nothing to do but let the fallback screen answer.
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

/**
 * Whether the kiosk is currently wider than it is tall.
 *
 * No server snapshot: the kiosk is rendered by `createRoot` in a browser and
 * never on a server, so there is no first paint for one to describe.
 */
export function useSideways(): boolean {
  return useSyncExternalStore(subscribe, isSideways);
}
