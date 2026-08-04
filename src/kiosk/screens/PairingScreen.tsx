/**
 * The kiosk waiting to be claimed.
 *
 * Shows the pairing code as large as the screen allows and polls for the
 * approval a staff member performs from their own signed-in session. The code
 * is public by design; the secret behind it never leaves this device. An
 * expired pairing silently starts a fresh one — the screen is a shelf, and
 * nobody is there to press "retry".
 */
import { useEffect, useRef, useState } from 'react';
import type { KioskServices } from '../KioskApp';

const POLL_MS = 2000;

export function PairingScreen({
  services,
  onPaired,
}: {
  services: KioskServices;
  onPaired: (uid: string) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [trouble, setTrouble] = useState(false);
  const pairedRef = useRef(onPaired);
  pairedRef.current = onPaired;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const run = async () => {
      try {
        setTrouble(false);
        const pairing = await services.beginPairing();
        if (cancelled) return;
        setCode(pairing.code);

        const poll = async () => {
          if (cancelled) return;
          try {
            const outcome = await services.pollPairing(pairing.code, pairing.secret);
            if (cancelled) return;
            if (typeof outcome === 'object') {
              pairedRef.current(outcome.uid);
              return;
            }
            if (outcome === 'gone') {
              // Expired or swept — start over with a fresh code.
              void run();
              return;
            }
          } catch {
            // A dropped poll is just a slow lobby network; keep going.
          }
          timer = setTimeout(poll, POLL_MS);
        };
        timer = setTimeout(poll, POLL_MS);
      } catch {
        if (cancelled) return;
        // Could not even start a pairing — network down, or the cap reached.
        setCode(null);
        setTrouble(true);
        timer = setTimeout(run, 30_000);
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [services]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8 text-center">
      <div className="text-lg font-medium text-ink-400">Pair this kiosk</div>
      {code ? (
        <>
          <div
            data-testid="kiosk-pairing-code"
            className="font-mono text-8xl font-bold tracking-[0.3em] text-ink-50"
          >
            {code}
          </div>
          <div className="max-w-md text-lg leading-relaxed text-ink-300">
            A leader enters this code in Tally under{' '}
            <span className="font-semibold text-ink-100">Settings → Pair a kiosk</span>.
          </div>
        </>
      ) : trouble ? (
        <div className="max-w-md text-lg text-ink-300">
          Can&apos;t reach Tally right now. Trying again shortly…
        </div>
      ) : (
        <div className="text-lg text-ink-400">Getting a code…</div>
      )}
    </div>
  );
}
