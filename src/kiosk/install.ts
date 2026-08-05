/**
 * Installing the kiosk to the device it is running on.
 *
 * The kiosk ships its own manifest and its own service worker (kiosk.html,
 * public/kiosk-sw.js), which is what makes a browser willing to install it as an
 * app separate from Tally. This module is the other half: the small amount of
 * state a *screen* needs in order to offer it, and nothing more.
 *
 * Why offer it at all rather than leaving people to a browser menu: the shelf
 * device is set up once, by whoever is standing there with the pairing code, and
 * "Add to Home Screen" is four taps into a menu they have no reason to open. On
 * iOS it matters twice over — an installed web app gets its own storage
 * container, so a kiosk paired in Safari and *then* installed comes up unpaired
 * and asking for a fresh code. Install first, pair second, and the button lives
 * on the screen where that ordering is still possible.
 *
 * The prompt event itself is caught by an inline script in kiosk.html, because
 * Chrome fires it before this bundle has parsed. This module only reads what was
 * parked there.
 */
import { useSyncExternalStore } from 'react';

/**
 * The non-standard event Chromium fires. Typed here rather than pulled from a
 * DOM lib because it is not in one: `beforeinstallprompt` is a Chromium
 * extension that other engines have declined to implement.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

declare global {
  interface Window {
    /** Parked by kiosk.html. Null once the app has been installed. */
    __tallyKioskInstall?: InstallPromptEvent | null;
  }
}

/** Subscribers that a spent prompt has to reach; window events cover the rest. */
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  // kiosk.html's handlers run first — they are registered while the document is
  // parsing — so by the time these fire, `window.__tallyKioskInstall` already
  // holds the answer they should report.
  window.addEventListener('beforeinstallprompt', onStoreChange);
  window.addEventListener('appinstalled', onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('beforeinstallprompt', onStoreChange);
    window.removeEventListener('appinstalled', onStoreChange);
  };
}

/** Whether a browser install prompt is available to show right now. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.__tallyKioskInstall != null,
    // No prompt on a server. The kiosk does not render there, but the hook
    // must still answer if something ever does.
    () => false,
  );
}

/**
 * Shows the browser's install dialog, if one is still on offer.
 *
 * The event is single-use, so it is dropped on the way in whatever the person
 * chooses — a dismissed prompt cannot be re-shown from the same event, and
 * Chrome fires a fresh one on a later load. That is why the button disappears
 * after a dismissal rather than sitting there doing nothing when tapped again.
 */
export async function promptInstall(): Promise<void> {
  const event = window.__tallyKioskInstall;
  if (!event) return;
  window.__tallyKioskInstall = null;
  for (const listener of listeners) listener();
  try {
    await event.prompt();
  } catch {
    // The browser refused to show it — already installed in another profile,
    // or the gesture was lost. Nothing a lobby screen can do about either.
  }
}

/** Already running as an installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  try {
    if (['standalone', 'fullscreen', 'minimal-ui'].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)) {
      return true;
    }
  } catch {
    // Ancient or exotic engine without matchMedia. Fall through to iOS.
  }
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

/**
 * Safari on an iPhone or iPad, where installing is a menu item nobody finds and
 * no event announces it.
 *
 * Detected by the non-standard `navigator.standalone`, which only WebKit on iOS
 * defines — a feature detect rather than a UA sniff, and the one WebKit property
 * that means exactly "this is the browser Add to Home Screen lives in". An
 * iPadOS Safari that claims to be macOS still has it.
 */
export function needsManualInstall(): boolean {
  return 'standalone' in window.navigator;
}
