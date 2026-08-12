/**
 * A press-and-hold control, for the presses worth being sure about.
 *
 * Two seconds of continuous contact, with visible progress, cancelled by
 * lifting or leaving. Not authentication: the kiosk belongs to a small church
 * lobby, and the gate only has to be beyond a wandering toddler and an
 * accidental brush, not beyond an adult who could also just unplug the thing.
 *
 * The count does not start on contact. `HOLD_DELAY_MS` of stillness comes
 * first, and until it is spent the gesture is still anybody's — a thumb that
 * lands and immediately drags is scrolling the list, not holding a row, and the
 * browser is left free to say so. Past it the kiosk has decided this contact is
 * a hold: the bar starts filling and the page stops moving under the finger.
 *
 * Progress is driven by a CSS transition on a scaling bar rather than by
 * animation frames: the only JavaScript is two timers — one to arm, one to
 * complete — and the pointer handlers that cancel them.
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
 * Every other end to the gesture is silent, and on these tablets the buzz is
 * silent too — so anything that stops the count has to be visible or it is
 * indistinguishable from a button that does nothing. Lifting is its own answer:
 * the finger is off, and the emptied bar agrees with the hand. Drifting is not,
 * because the finger is still down; `strayHint` is what the control says
 * instead.
 *
 * `onTap` makes the same control answer a short press too, and passing it says
 * this one lives inside something that scrolls — the chooser's event list is
 * the only such caller. Both halves of that follow: the press has to be tracked
 * so a finger that drags away is neither a hold nor a tap (the reasoning, and
 * the slop, are `components/tapGuard.ts`'s), and `touchAction` has to leave the
 * vertical pan to the browser rather than swallowing it, or the list under the
 * rows stops scrolling wherever a row happens to be — up to the moment the
 * count starts and the row takes the finger for itself.
 *
 * `HOLD_MS` and `HOLD_DELAY_MS` are exported and reused rather than restated. The staff gate no
 * longer draws this control — it is a hold on the keyboard's Clear key, whose
 * progress is CSS bound to `:active` because that subtree must not re-render
 * (see components/Keyboard.tsx) — but a kiosk with two hold gestures of
 * different lengths — or two that begin at different moments — would be a kiosk
 * that teaches its staff nothing.
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

/**
 * The grace between contact and the count, in which the gesture is still free
 * to have been something else.
 *
 * A hold and the first moment of a drag are the same event: a finger down and
 * not yet moved. Arming on contact meant the kiosk answered before the hand had
 * finished the sentence — the bar started filling under a thumb that was on its
 * way past, and on the chooser's rows a scroll had to fight a control that had
 * already claimed the touch.
 *
 * A fifth of a second is what separates them. Below it nothing anybody does
 * deliberately has happened yet, so nothing is lost by waiting; above it a
 * finger that has not moved is a finger that means to stay. It is also short
 * enough to be invisible: by the time an eye could notice the bar had not
 * started, it has.
 *
 * Exported for the same reason `HOLD_MS` is — the staff gate's hold lives in
 * `components/Keyboard.tsx` and in CSS, and two holds that arm at different
 * moments would be two gestures a volunteer has to learn separately.
 */
export const HOLD_DELAY_MS = 200;

/**
 * How long the cancellation notice outlives the hand that caused it.
 *
 * A drift is not always followed by a second attempt. Somebody whose thumb
 * wandered and who then walked off leaves the kiosk showing *Lift, then hold
 * again* — an instruction addressed to a person who has gone, on the one element
 * that would otherwise say a name tag is available, read by whoever walks up
 * next. Long enough that the sentence is still there when a finger comes off to
 * read it, short enough that it belongs to the gesture rather than to the
 * screen.
 */
export const STRAY_HINT_MS = 6000;

export function HoldButton({
  onHeld,
  onTap,
  cancelOnStray = false,
  strayHint,
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
   *
   * Pair it with `strayHint`. On its own the check is a dead end: `cancel()`
   * clears the timer and only `onPointerDown` can arm it again, so a thumb that
   * drifts twelve pixels and then keeps pressing is holding a button that has
   * stopped counting and cannot start.
   */
  cancelOnStray?: boolean;
  /**
   * What the control says once a drift has cancelled the count.
   *
   * `haptic()` is `navigator.vibrate` and these are iPads, so nothing happens
   * in the hand: without this, a cancelled hold and a broken button are the
   * same event — an emptied bar under a thumb that is still down. The hint
   * replaces the label until the next press arms a new one, which is the only
   * channel this device has for saying *that did not count, and here is the way
   * back*. It is a label swap rather than a new colour or a new mark, because
   * the kiosk's palette is a distance from the reader and a cancelled gesture
   * is not an error.
   *
   * It stands until the next press or `STRAY_HINT_MS` after the hand comes off,
   * whichever is first, and the control is sized to hold either string without
   * moving.
   */
  strayHint?: ReactNode;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const [holding, setHolding] = useState(false);
  /* Set by a drift; cleared by the next press, or by `STRAY_HINT_MS` of no
     contact — never by the lift itself, so the sentence is still there when the
     thumb comes off to read it. */
  const [slipped, setSlipped] = useState(false);
  /* The grace, and then the count. Two timers because they mean different
     things: the first can still be beaten by a drag, the second cannot. */
  const armRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressRef = useRef<Press | null>(null);
  const nodeRef = useRef<HTMLButtonElement | null>(null);
  /* What the touch listener below reads. It cannot read `holding`: the listener
     is registered once, on mount, precisely so that it is non-passive. */
  const holdingRef = useRef(false);
  const heldRef = useRef(onHeld);
  heldRef.current = onHeld;
  const tappedRef = useRef(onTap);
  tappedRef.current = onTap;

  const cancel = useCallback(() => {
    if (armRef.current) clearTimeout(armRef.current);
    armRef.current = null;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pressRef.current = null;
    holdingRef.current = false;
    setHolding(false);
  }, []);

  const start = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    if (restoreRef.current) clearTimeout(restoreRef.current);
    restoreRef.current = null;
    pressRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setSlipped(false);
    /*
     * Nothing yet — not the bar, not the count, not the claim on the gesture.
     * A press this new is indistinguishable from the first frame of a scroll,
     * and `HOLD_DELAY_MS` is the kiosk declining to guess. A tap that comes and
     * goes inside the window never draws a bar at all, which is the other half
     * of why the delay is here: on the chooser's rows, where a press has a
     * second and lighter meaning, a fill that flashed on every selection said
     * a hold had begun and been abandoned.
     */
    armRef.current = setTimeout(() => {
      armRef.current = null;
      holdingRef.current = true;
      setHolding(true);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        // The gesture has spent itself: the lift that follows is the end of a
        // hold that already fired, never a tap on top of it.
        pressRef.current = null;
        holdingRef.current = false;
        setHolding(false);
        haptic();
        heldRef.current();
      }, HOLD_MS);
    }, HOLD_DELAY_MS);
  }, []);

  /*
   * Once the count is running, the page stops moving under the finger.
   *
   * `touchAction` alone cannot do this. It is read when the gesture begins, and
   * the whole point of the grace above is that the gesture begins before the
   * kiosk knows what it is — so a row in the chooser has to start out pannable
   * or the list stops scrolling wherever a thumb happens to land. The switch
   * has to happen mid-gesture, and mid-gesture only a non-passive `touchmove`
   * that calls `preventDefault` will do it.
   *
   * Which is safe exactly here and nowhere else: at the moment the count starts
   * the finger has been still for a fifth of a second, so no scroll is under
   * way to be too late to stop. A finger that moved instead took the browser's
   * offer, and `pointercancel` had already ended the hold.
   *
   * Registered by hand rather than through `onTouchMove`, because React puts
   * its touch listeners on the root as passive ones and a passive listener's
   * `preventDefault` does nothing at all.
   */
  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const pin = (event: TouchEvent) => {
      if (holdingRef.current) event.preventDefault();
    };
    node.addEventListener('touchmove', pin, { passive: false });
    return () => node.removeEventListener('touchmove', pin);
  }, []);

  const move = useCallback(
    (event: React.PointerEvent) => {
      // Where a press has a second meaning, or where the caller has asked for
      // the check anyway. A hold that stands alone is otherwise the more
      // forgiving control on purpose: two seconds is a long time to ask a thumb
      // to hold still, and on a screen whose whole point is this button there
      // is nothing under it for a drift to have meant instead.
      if (!tappedRef.current && !cancelOnStray) return;
      if (!pressRef.current || !strayed(pressRef.current, event)) return;
      cancel();
      // Where a drift is the *only* meaning a stray press can have, the caller
      // gets to say so on the face of the button. Where the drift was a scroll
      // (`onTap`), the list moving under the thumb has already said it.
      if (cancelOnStray && !tappedRef.current) setSlipped(true);
    },
    [cancel, cancelOnStray],
  );

  /*
   * The hand comes off, and the notice starts its own clock.
   *
   * Not when the drift happens: a thumb still down is a person still reading,
   * and a sentence that vanished while they were looking at it would be the
   * second thing this control did without explanation. `start` clears the timer,
   * so a press inside the window puts the label back rather than racing it.
   */
  const release = useCallback(() => {
    cancel();
    if (restoreRef.current) clearTimeout(restoreRef.current);
    restoreRef.current = setTimeout(() => {
      restoreRef.current = null;
      setSlipped(false);
    }, STRAY_HINT_MS);
  }, [cancel]);

  const end = useCallback(
    (event: React.PointerEvent) => {
      const wasTap = !strayed(pressRef.current, event);
      release();
      if (wasTap) tappedRef.current?.();
    },
    [release],
  );

  useEffect(
    () => () => {
      cancel();
      if (restoreRef.current) clearTimeout(restoreRef.current);
    },
    [cancel],
  );

  return (
    <button
      ref={nodeRef}
      type="button"
      tabIndex={-1}
      aria-label={ariaLabel}
      className={`relative select-none overflow-hidden ${className}`}
      // `WebkitTouchCallout` for the iPads these sit on: a press this long is
      // exactly the gesture that raises the callout, and a kiosk has no use for
      // one. `touchAction` keeps the same press from being read as a scroll —
      // except where the control is a row in a list, which has to go on
      // scrolling under a thumb that came down on it, right up until the count
      // starts and the row claims the finger.
      style={{ touchAction: onTap && !holding ? 'pan-y' : 'none', WebkitTouchCallout: 'none' }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={release}
      onPointerCancel={release}
    >
      <span
        aria-hidden
        className="absolute inset-0 origin-left bg-white/35"
        style={{
          transform: holding ? 'scaleX(1)' : 'scaleX(0)',
          transition: holding ? `transform ${HOLD_MS}ms linear` : 'none',
        }}
      />
      {strayHint === undefined ? (
        <span className="relative block">{children}</span>
      ) : (
        /*
         * Both strings, one cell, one of them hidden — so the control is as wide
         * as the longer of the two whichever is showing.
         *
         * Sized to its own words, the pill stepped inward by the difference at
         * the exact moment its sentence told a parent to press it again: the
         * target moves as the instruction to hit it arrives. A grid cell holds
         * the width without holding the ink, and `visibility` rather than
         * `display` is what keeps the hidden twin out of the accessibility tree
         * while it goes on taking up room.
         */
        <span className="relative grid">
          <span
            aria-hidden={slipped || undefined}
            className={`col-start-1 row-start-1${slipped ? ' invisible' : ''}`}
          >
            {children}
          </span>
          <span
            aria-hidden={!slipped || undefined}
            className={`col-start-1 row-start-1${slipped ? '' : ' invisible'}`}
          >
            {strayHint}
          </span>
        </span>
      )}
    </button>
  );
}
