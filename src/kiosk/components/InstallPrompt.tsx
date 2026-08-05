/**
 * The one offer to install the kiosk as its own app.
 *
 * Shown on the two screens a staff member sees while setting a shelf device up —
 * pairing, and the gathering chooser — and on neither of the screens a parent
 * touches. It renders nothing at all unless there is something to say: nothing
 * once the kiosk is installed, nothing in a browser that cannot install it.
 *
 * The iOS line is not a fallback for a missing button, it is the whole flow on
 * that platform: WebKit has no install prompt, and it also gives an installed
 * app its own storage container, so a kiosk paired in Safari and installed
 * afterwards comes up unpaired. Saying "then pair it" is the part that saves a
 * second trip to the lobby.
 */
import { isInstalled, needsManualInstall, promptInstall, useCanInstall } from '../install';

export function InstallPrompt({ className = '' }: { className?: string }) {
  const canInstall = useCanInstall();

  if (isInstalled()) return null;

  if (canInstall) {
    return (
      <button
        type="button"
        tabIndex={-1}
        data-testid="kiosk-install"
        onClick={() => void promptInstall()}
        className={`w-full rounded-xl border-2 border-ink-800 p-3 text-ink-400 ${className}`}
      >
        Install the kiosk app on this device
      </button>
    );
  }

  if (needsManualInstall()) {
    return (
      <p className={`text-center text-sm leading-relaxed text-ink-500 ${className}`}>
        To keep this kiosk on the home screen: Share → Add to Home Screen, then pair the installed
        app.
      </p>
    );
  }

  return null;
}
