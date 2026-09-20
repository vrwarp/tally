/**
 * Whether nobody has touched the glass for a moment.
 *
 * `calm` — nothing typed, no overlay, nobody in the wizard — is the kiosk's
 * existing test for "is anybody mid-anything", and it is a fact about the
 * screen rather than about the lobby: clearing a mistyped name empties the
 * buffer without the person having gone anywhere, and in a queue every gap
 * between two families is calm. Anything the kiosk wants to put on the front
 * door *because nobody is using it* has to know the difference, or it arrives
 * under the hand of a parent correcting a typo.
 *
 * So: a few seconds of stillness on top of calm. Armed only while something
 * wants the answer — the staff notice after a printer recovery is the only
 * caller — so a kiosk on an ordinary evening installs no listener at all, and
 * the one it does install writes state only on the edges rather than on every
 * touch.
 *
 * Capture phase, like `KioskApp`'s own touch watcher, so a control that stops
 * propagation cannot stop the clock; and `keydown` for the same reason it is
 * there — the walkthrough runner and a bench with a real keyboard.
 */
import { useEffect, useState } from 'react';

export function useQuietGlass(armed: boolean, delayMs: number): boolean {
  const [quiet, setQuiet] = useState(false);

  useEffect(() => {
    if (!armed) {
      setQuiet(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wait = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setQuiet(true), delayMs);
    };
    const touched = () => {
      // Only ever a write on the edge: a touch while the glass is already
      // busy changes nothing, and this runs on a Pi-class tablet.
      setQuiet((held) => (held ? false : held));
      wait();
    };
    wait();
    window.addEventListener('pointerdown', touched, { capture: true });
    window.addEventListener('keydown', touched, { capture: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointerdown', touched, { capture: true });
      window.removeEventListener('keydown', touched, { capture: true });
    };
  }, [armed, delayMs]);

  return quiet;
}
