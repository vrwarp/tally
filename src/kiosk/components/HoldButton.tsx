/**
 * A press-and-hold control, for the presses worth being sure about.
 *
 * Two seconds of continuous contact, with visible progress, cancelled by
 * lifting or leaving. Not authentication: the kiosk belongs to a small church
 * lobby, and the gate only has to be beyond a wandering toddler and an
 * accidental brush, not beyond an adult who could also just unplug the thing.
 *
 * Progress is driven by a CSS transition on a scaling bar rather than by
 * animation frames: the only JavaScript is one timer for completion and the
 * pointer handlers that arm and cancel it.
 *
 * The bar is a white wash, and has to be something like it. Every caller draws
 * this control on a dark surface — `bg-brand-600` on the two committing buttons,
 * `bg-ink-900` on the chooser's rows — so a fill tinted in the brand ramp
 * composites to within nothing of the button it covers, and the hold becomes
 * two seconds of a button doing visibly nothing. Which is not a subtle bug:
 * nobody keeps their thumb down for two seconds against no feedback, so the
 * control reads as broken rather than as slow. Whatever this fill is, it must
 * contrast with the button under it.
 *
 * Completion buzzes; arming does not. Two seconds is long enough that a thumb
 * wants to be told when it may leave, and a buzz on contact would say the
 * gesture had happened when it had only started.
 *
 * `onTap` makes the same control answer a short press too, and passing it says
 * this one lives inside something that scrolls — the chooser's event list is
 * the only such caller. Both halves of that follow: the press has to be tracked
 * so a finger that drags away is neither a hold nor a tap (the reasoning, and
 * the slop, are `components/tapGuard.ts`'s), and `touchAction` has to leave the
 * vertical pan to the browser rather than swallowing it, or the list under the
 * rows stops scrolling wherever a row happens to be.
 *
 * `HOLD_MS` is exported and reused rather than restated. The staff gate no
 * longer draws this control — it is a hold on the keyboard's Clear key, whose
 * progress is CSS bound to `:active` because that subtree must not re-render
 * (see components/Keyboard.tsx) — but a kiosk with two hold gestures of
 * different lengths would be a kiosk that teaches its staff nothing.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { haptic } from '@/lib/utils';
import { strayed, type Press } from './tapGuard';

/**
 * Long enough to be deliberate, short enough that nobody lets go early.
 *
 * This was three seconds, and three seconds is past where a held button stops
 * reading as *counting* and starts reading as *stuck*: a thumb on a lobby
 * screen wonders whether it missed the button, lifts, and starts again. Two is
 * about the ceiling for a pressure gesture. Nothing the length defends against
 * survives it either — a toddler's palm, a coat sleeve, a hand steadying the
 * tablet are all gone well before one second.
 */
export const HOLD_MS = 2000;

export function HoldButton({
  onHeld,
  onTap,
  cancelOnStray = false,
  className = '',
  children,
  'aria-label': ariaLabel,
}: {
  onHeld: () => void;
  /**
   * What a short press means, for a control that has a second, lighter answer.
   * Fires on lift, and only if the finger stayed put — see the note above.
   * Omitted, a press that does not reach two seconds does nothing at all.
   */
  onTap?: () => void;
  /**
   * Cancel on drift even though a press here means only one thing.
   *
   * The forgiveness described above is affordable where the hold is the point
   * of the screen and the thumb is already on the button it means. It is not
   * affordable where the control shares glass with a band a thumb travels
   * through on its way somewhere else: with `touchAction: 'none'` the browser
   * never calls the contact a scroll, and implicit pointer capture means
   * `onPointerLeave` never fires on touch, so *any* contact that begins
   * anywhere in the slab and lasts two seconds fires — a planted palm, a bag
   * strap, a hand steadying a stand-mounted tablet, wherever it slides to.
   *
   * Passing this asks the same question of the gesture that a row in a list
   * asks (`tapGuard.ts`'s slop, not a second answer), without giving a short
   * press a meaning it does not have.
   */
  cancelOnStray?: boolean;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressRef = useRef<Press | null>(null);
  const heldRef = useRef(onHeld);
  heldRef.current = onHeld;
  const tappedRef = useRef(onTap);
  tappedRef.current = onTap;

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pressRef.current = null;
    setHolding(false);
  }, []);

  const start = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    pressRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // The gesture has spent itself: the lift that follows is the end of a
      // hold that already fired, never a tap on top of it.
      pressRef.current = null;
      setHolding(false);
      haptic();
      heldRef.current();
    }, HOLD_MS);
  }, []);

  const move = useCallback(
    (event: React.PointerEvent) => {
      // Where a press has a second meaning, or where the caller has asked for
      // the check anyway. A hold that stands alone is otherwise the more
      // forgiving control on purpose: two seconds is a long time to ask a thumb
      // to hold still, and on a screen whose whole point is this button there
      // is nothing under it for a drift to have meant instead.
      if (!tappedRef.current && !cancelOnStray) return;
      if (pressRef.current && strayed(pressRef.current, event)) cancel();
    },
    [cancel, cancelOnStray],
  );

  const end = useCallback(
    (event: React.PointerEvent) => {
      const wasTap = !strayed(pressRef.current, event);
      cancel();
      if (wasTap) tappedRef.current?.();
    },
    [cancel],
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
      // one. `touchAction` keeps the same press from being read as a scroll —
      // except where the control is a row in a list, which has to go on
      // scrolling under a thumb that came down on it.
      style={{ touchAction: onTap ? 'pan-y' : 'none', WebkitTouchCallout: 'none' }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
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
      <span className="relative block">{children}</span>
    </button>
  );
}
