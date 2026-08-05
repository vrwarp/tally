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
 *
 * The bar is a white wash, and has to be something like it. Every caller draws
 * this control on a dark surface — `bg-brand-600` at both visible call sites —
 * so a fill tinted in the brand ramp composites to within nothing of the button
 * it covers, and the hold becomes three seconds of a button doing visibly
 * nothing. Which is not a subtle bug: nobody keeps their thumb down for three
 * seconds against no feedback, so the control reads as broken rather than as
 * slow. Whatever this fill is, it must contrast with the button under it.
 *
 * Completion buzzes; arming does not. Three seconds is long enough that a
 * thumb wants to be told when it may leave, and one of the two holds — the
 * staff gate in the corner of the search screen — is invisible, so the buzz is
 * the only thing that says the gesture worked. A buzz on contact would instead
 * announce that invisible corner to whoever brushed it.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { haptic } from '@/lib/utils';

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
        haptic();
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
      // `WebkitTouchCallout` for the iPads these sit on: a press this long is
      // exactly the gesture that raises the callout, and a kiosk has no use for
      // one. `touchAction` keeps the same press from being read as a scroll.
      style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      <span
        aria-hidden
        className="absolute inset-0 origin-left bg-white/35"
        style={{
          transform: holding ? 'scaleX(1)' : 'scaleX(0)',
          transition: holding ? `transform ${HOLD_MS}ms linear` : 'none',
        }}
      />
      <span className="relative">{children}</span>
    </button>
  );
}
