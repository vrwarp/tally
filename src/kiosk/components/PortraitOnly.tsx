/**
 * The kiosk stands upright, and only upright.
 *
 * Every screen behind this is laid out for a tablet stood on end — a results
 * track tall enough for the list, a keyboard pinned under it — and there is
 * no second layout for one laid on its side. Three layers hold that, each
 * covering the device the one before it cannot reach:
 *
 * 1. **The manifest.** `kiosk.webmanifest` says `"orientation": "portrait"`,
 *    which is all an installed kiosk on Android needs: the launcher opens it
 *    upright and the system rotation lock does the rest.
 * 2. **`screen.orientation.lock`.** For the same kiosk in a browser tab that
 *    has gone fullscreen, where the manifest does not apply but the lock API
 *    does. Asked at boot and again whenever the page enters fullscreen,
 *    because that is when a refusal can turn into a yes. Everywhere else —
 *    iOS, a desktop window, a tab that is not fullscreen — it rejects, and a
 *    rejection is exactly the case the third layer is for.
 * 3. **This screen.** Whatever the glass does, a kiosk that finds itself
 *    wider than it is tall says so and shows nothing else, rather than
 *    squeezing a portrait layout into a landscape frame. The kiosk underneath
 *    stays mounted and is only made inert: turning the tablet back resumes it
 *    exactly where it was — a half-typed name, a printer mid-queue, a pairing
 *    code a staff member is reading off — instead of booting it again.
 *
 * `(orientation: landscape)` is the viewport's shape, not the device's, which
 * is the question worth asking: a desktop window a leader has left wide gets
 * the same answer as a tablet on its side, and "make it taller" is the fix
 * for both.
 */
import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { lockPortrait, useSideways } from '../orientation';

export function PortraitOnly({ children }: { children: ReactNode }) {
  const sideways = useSideways();

  useEffect(() => {
    lockPortrait();
    document.addEventListener('fullscreenchange', lockPortrait);
    return () => document.removeEventListener('fullscreenchange', lockPortrait);
  }, []);

  return (
    <>
      {/* `contents`, so the wrapper adds no box and every layout under it is
          the one it was written against. */}
      <div className="contents" inert={sideways}>
        {children}
      </div>
      {sideways && <TurnUpright />}
    </>
  );
}

function TurnUpright() {
  const t = useTranslations('Door');
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="kiosk-turn-upright-title"
      aria-describedby="kiosk-turn-upright-body"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 bg-ink-950 p-8 text-center"
    >
      {/* A tablet on its side and the turn that stands it up — the whole
          message for anybody who does not read the words. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 96 96"
        className="h-28 w-28 shrink-0 text-ink-400"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="30" y="10" width="36" height="58" rx="5" />
        <path d="M43 60h10" />
        <path d="M18 78c8 8 20 10 30 10s22-2 30-10" />
        <path d="m70 72 8 6-8 6" />
      </svg>
      <div className="max-w-xl">
        <div id="kiosk-turn-upright-title" className="text-4xl font-bold text-balance text-ink-50">
          {t('turnUprightTitle')}
        </div>
        <div id="kiosk-turn-upright-body" className="pt-3 text-xl text-balance text-ink-300">
          {t('turnUprightBody')}
        </div>
      </div>
    </div>
  );
}
