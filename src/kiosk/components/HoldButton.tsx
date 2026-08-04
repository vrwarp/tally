/**
 * A press-and-hold control — the kiosk's one staff gate.
 *
 * Three seconds of continuous contact, with visible progress, cancelled by
 * lifting or leaving. Not authentication: the kiosk belongs to a small church
 * lobby, and the gate only has to be beyond a wandering toddler and an
 * accidental brush, not beyond an adult who could also just unplug the thing.
 *
 * Progress is driven by a CSS transition on a scaling bar rather than by
 * animation frames: the only JavaScript is one timer for completion and the
 * pointer handlers that arm and cancel it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export const HOLD_MS = 3000;

export function HoldButton({
  onHeld,
  className = '',
  children,
  'aria-label': ariaLabel,
}: {
  onHeld: () => void;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef(onHeld);
  heldRef.current = onHeld;

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setHolding(false);
  }, []);

  const start = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      setHolding(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setHolding(false);
        heldRef.current();
      }, HOLD_MS);
    },
    [],
  );

  useEffect(() => cancel, [cancel]);

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={ariaLabel}
      className={`relative select-none overflow-hidden ${className}`}
      style={{ touchAction: 'none' }}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      <span
        aria-hidden
        className="absolute inset-0 origin-left bg-brand-600/40"
        style={{
          transform: holding ? 'scaleX(1)' : 'scaleX(0)',
          transition: holding ? `transform ${HOLD_MS}ms linear` : 'none',
        }}
      />
      <span className="relative">{children}</span>
    </button>
  );
}
