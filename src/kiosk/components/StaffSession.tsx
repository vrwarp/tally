/**
 * The clock that hands the kiosk back, on the gate rather than on the screens.
 *
 * Round 1 asked for an inactivity return and got one on two screens of four:
 * `ReprintScreen` and `ReprintConfirmScreen` each ran their own `setTimeout`,
 * and `StaffScreen` and `PrinterScreenProto` ran none. The printer screen is the
 * worse of the two misses — abandoned, it leaves five children's full names and
 * arrival times on unattended glass, a live path into the reprint confirm, and
 * **Choose a different printer** — but the shape of the bug is the point: a
 * timer per screen is a timer somebody forgets to add to the fifth screen, and
 * the hole reopens silently.
 *
 * So there is one timer, and it belongs to the thing that has the property being
 * timed: *the staff flow is open*. It is armed when the two-second hold on Clear
 * opens the gate, it survives every navigation inside the flow, and it is
 * disarmed by unmounting — which is what returning to check-in does. A screen
 * added behind the gate tomorrow inherits it without knowing it exists.
 *
 * It restarts on any pointer event, not only on the keystrokes the search screen
 * could see. A volunteer reading six Alvarez rows to a parent who is talking at
 * them types nothing for a minute; so does one working the printer screen's
 * settings. Capture phase, so a row that stops propagation cannot stop the
 * clock, and it deliberately does not care *what* was touched.
 *
 * Shorter than `RegistrationFlow`'s ninety seconds because nothing here is
 * half-typed and worth protecting: everything behind this gate is one keystroke
 * to get back to, and the cost of holding it open is a lobby tablet that is not
 * a check-in screen.
 */
import { useCallback, useEffect, useRef, type ReactNode } from 'react';

export const STAFF_RETURN_MS = 45_000;

export function StaffSession({ onReturn, children }: { onReturn: () => void; children: ReactNode }) {
  const returnRef = useRef(onReturn);
  returnRef.current = onReturn;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => returnRef.current(), STAFF_RETURN_MS);
  }, []);

  useEffect(() => {
    arm();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [arm]);

  return (
    <div
      className="h-full w-full"
      onPointerDownCapture={arm}
      onPointerUpCapture={arm}
      onKeyDownCapture={arm}
    >
      {children}
    </div>
  );
}
