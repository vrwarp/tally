/**
 * Telling a tap from the start of a drag, for every control on the kiosk.
 *
 * Contact is not consent. A tablet in a lobby is leaned on, brushed past,
 * steadied by one hand while the other points at it, and scrolled with a thumb
 * that lands wherever the list happens to be — so a control that commits the
 * instant glass is touched commits for all of those. This is the answer to all
 * of them at once: a press is remembered where it landed, and only the finger
 * coming off near where it went on means the thing the control says.
 *
 * That used to be the rule only for rows inside a scrolling list, where getting
 * it wrong sent a parent to the confirm screen for whichever child they pushed
 * off with. It is now the rule for the buttons too. The cost is the few
 * milliseconds between contact and lift — real, and paid everywhere — and the
 * kiosk buys back the part that mattered by keeping the pressed-state fill on
 * CSS `:active`, which still lands the same frame as the touch. The glass
 * answers immediately; it just does not *act* until the hand has finished
 * saying what it meant. Every control this guards has to carry that fill, or
 * waiting for the lift becomes waiting with nothing to look at.
 *
 * The other half of the promise is that sliding off is *free*: a press can be
 * thought better of, and thought better of again, and the control is still
 * there when the thumb comes back. That is the behaviour people learned from
 * every button on their phone, and it is why nothing here decides anything
 * until the finger leaves the glass.
 *
 * The keyboard is the exception, and stays on contact — see components/
 * Keyboard.tsx. A key reports that the glass took the press, and a letter that
 * waits for the lift is a keyboard that feels broken rather than careful.
 *
 * The browser sends `pointercancel` the moment it decides a touch is a scroll,
 * which handles the fling; the slop below covers the slower drag that ends with
 * the finger lifted back close to its start.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * How far a finger may travel between contact and lift and still mean "this
 * one" rather than "move the list".
 *
 * A dozen pixels is roughly the wobble of a thumb held still on glass; a drag
 * to scroll is an order of magnitude more.
 */
export const TAP_SLOP_PX = 12;

/**
 * Where a finger landed, and which finger it was.
 *
 * Exported, with `strayed`, for `components/HoldButton.tsx`: a control that is
 * held rather than tapped asks the same question of the same gesture, and two
 * answers to "did this finger stay put" is one more than a kiosk should have.
 */
export interface Press {
  pointerId: number;
  x: number;
  y: number;
}

/** Whether this pointer has moved far enough to have meant a scroll. */
export function strayed(press: Press | null, event: React.PointerEvent): boolean {
  if (!press || press.pointerId !== event.pointerId) return true;
  return (
    Math.abs(event.clientX - press.x) > TAP_SLOP_PX ||
    Math.abs(event.clientY - press.y) > TAP_SLOP_PX
  );
}

/** Whether this pointer came off inside the control it went down on. */
export function within(node: Element, event: React.PointerEvent): boolean {
  const box = node.getBoundingClientRect();
  return (
    event.clientX >= box.left &&
    event.clientX <= box.right &&
    event.clientY >= box.top &&
    event.clientY <= box.bottom
  );
}

export interface TapHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: () => void;
}

/**
 * How far a press may wander and still mean the control it started on.
 *
 * Two answers, because the question is two questions.
 *
 * `bounds` is what a button asks, and it is what every native control asks:
 * iOS and Android care whether the finger came off *inside the control*, not
 * how far it travelled to get there. On a full-width `h-16` commit button
 * nothing is under the thumb for a drift to have meant instead, so a wobble of
 * twenty pixels is a press, exactly as it is everywhere else the person has
 * ever pressed anything.
 *
 * `slop` is what a row in a scrolling list asks, and there the distance *is*
 * the question: the first frame of a scroll is a press that has not moved yet,
 * and a dozen pixels is where a held thumb ends and a drag begins. A row cannot
 * use `bounds`, because a scroll that starts on a row and ends on it — the list
 * having moved underneath — comes off inside a control it never meant.
 */
type Reach = 'bounds' | 'slop';

function usePressGuard<T>(onTap: (value: T) => void, reach: Reach): (value: T) => TapHandlers {
  const pressRef = useRef<(Press & { node: EventTarget }) | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;

  return useCallback(
    (value: T) => {
      const clear = () => {
        pressRef.current = null;
      };
      return {
        onPointerDown: (event: React.PointerEvent) => {
          // Keeps the touch from selecting text or focusing the control mid-drag.
          event.preventDefault();
          pressRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            node: event.currentTarget,
          };
        },
        /*
         * Everything is decided here, and nothing before it.
         *
         * There was a `pointermove` handler that dropped the press the moment it
         * strayed, and it made the cancellation one-way: a thumb that slid off a
         * button and came back — which every platform re-arms, and which is the
         * whole reason people trust that they can slide off — was pressing a
         * control that had already stopped listening. Nothing needs the early
         * exit. The browser sends `pointercancel` the instant it decides a touch
         * is a scroll, which is the cancellation that actually matters, and a
         * press that ends somewhere it should not simply fails this test.
         */
        onPointerUp: (event: React.PointerEvent) => {
          const press = pressRef.current;
          clear();
          // The control that took the press is the only one that may answer it:
          // two doors in a stack, or Back beside Cancel, are a handful of pixels
          // apart, and a press that went down on one and came up on the next
          // must be neither rather than both.
          if (!press || press.node !== event.currentTarget) return;
          if (press.pointerId !== event.pointerId) return;
          const missed =
            reach === 'bounds' ? !within(event.currentTarget, event) : strayed(press, event);
          if (!missed) tapRef.current(value);
        },
        onPointerCancel: clear,
      };
    },
    [reach],
  );
}

/**
 * Returns a factory: call it with whatever the row stands for, spread the
 * result onto the row, and `onTap` fires with that value on a real tap.
 *
 * For rows in something that scrolls — see `Reach` above for why they are the
 * ones measured by distance. One press is tracked at a time (a lobby kiosk has
 * one thumb on it), so the handlers share the hook's own ref rather than one
 * per row.
 */
export function useTapGuard<T>(onTap: (value: T) => void): (value: T) => TapHandlers {
  return usePressGuard(onTap, 'slop');
}

/**
 * The same guard, for a control that means one thing rather than one of many.
 *
 * A button is a row whose value is the act itself: call the hook once per
 * component, spread `tap(() => …)` onto each button, and the callback runs when
 * a finger that went down on *that* button comes off inside it.
 *
 * Anything the press should also do at the moment of the act — the buzz, most
 * often — goes inside the callback, which is why the buzzes moved off contact
 * with the presses that raise them. A kiosk that vibrated when a thumb landed
 * and then did nothing when it lifted would be telling the hand the opposite of
 * what the screen was doing.
 */
export function useTap(): (run: () => void) => TapHandlers {
  return usePressGuard<() => void>((run) => run(), 'bounds');
}

/**
 * Swallow a click that belongs to a press this screen never received.
 *
 * The guards above are per-control, and they cannot be the whole answer.
 *
 * A gesture is not one event. A tap is `pointerdown`, `pointerup`, then
 * `click` — and the browser decides who receives that last one by hit-testing
 * the coordinates *at the moment it dispatches it*, against whatever the DOM
 * holds by then. Every control on this kiosk commits earlier than that:
 * `useTap` on the lift, the keyboard on contact, `HoldButton` on a timer while
 * the finger is still down. So a control that changes screens has already
 * changed them before its own gesture has finished being delivered, and the
 * leftovers land on the screen that arrived.
 *
 * That is not hypothetical. Opening the printer screen from the staff screen
 * put the trailing click on **Choose a different printer** — the one call to
 * `requestDevice` — at every viewport this kiosk runs at, so looking at a
 * connected printer opened the browser's device chooser, every time.
 *
 * The guards above already make React's own controls immune: a lift is only an
 * act on the control that took the press, so an orphan click reaches a handler
 * that is not listening for it. What they cannot cover is the browser's own
 * widgets. A `<summary>` toggles its `<details>` on a bare click, a `<label>`
 * moves focus, an `<a>` navigates — none of that is ours to guard, and all of
 * it answers a press made on another screen. The printer screen's settings
 * fold opened by itself for exactly that reason.
 *
 * So the rule is enforced once, above both React's root listener and the
 * browser's default action: **a click is not an act if the screen changed out
 * from under the press that produced it.**
 *
 * `screen` is what the kiosk is showing — any string that changes when the
 * glass does. It is the signal rather than "is the pressed node still in the
 * document", because React reconciles: two screens that both put a button in
 * the same slot share one DOM node, and the press would look untouched across
 * a swap that replaced everything the person could see. Node identity is kept
 * as a second net, for a screen that rearranges without changing its name.
 *
 * What it deliberately does not touch:
 *
 *  - **A click with no press at all.** A keyboard `Enter`, or one dispatched
 *    by a test, has no gesture behind it to be orphaned from.
 *  - **An ordinary click**, where the glass never changed and the press is the
 *    control being clicked. That is every real press by a real finger.
 *  - **A press that never became a click** — a scroll, a cancelled hold. The
 *    record is dropped on `pointercancel`, on any key, and after
 *    {@link GESTURE_MS}, so a stale one cannot swallow a later click.
 */
export const GESTURE_MS = 1000;

export function useOrphanClickGuard(screen: string): void {
  /* Null between gestures. `stale` is set by the screen changing while it is
     still in flight, which is the whole question. */
  const pressRef = useRef<{ node: Node | null; at: number; stale: boolean } | null>(null);

  /*
   * Layout, not passive: the swap happens inside the `pointerup` handler that
   * commits it, and React flushes that render before the browser goes on to
   * dispatch the click. A passive effect can land after the click it exists to
   * catch.
   */
  useLayoutEffect(() => {
    const press = pressRef.current;
    if (press) press.stale = true;
  }, [screen]);

  useEffect(() => {
    const remember = (event: Event) => {
      pressRef.current = {
        node: event.target instanceof Node ? event.target : null,
        at: Date.now(),
        stale: false,
      };
    };
    const forget = () => {
      pressRef.current = null;
    };
    const check = (event: MouseEvent) => {
      const press = pressRef.current;
      pressRef.current = null;
      // Nothing to orphan it from, or too old to be this gesture's.
      if (!press || Date.now() - press.at > GESTURE_MS) return;
      if (!press.stale) {
        // The second net: the control that took the press is still here and is
        // the one being clicked. Either direction, because a press lands on the
        // deepest node under the finger and a click may be reported against its
        // parent.
        const target = event.target;
        if (
          press.node?.isConnected &&
          target instanceof Node &&
          (press.node === target || press.node.contains(target) || target.contains(press.node))
        ) {
          return;
        }
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener('pointerdown', remember, { capture: true });
    window.addEventListener('pointercancel', forget, { capture: true });
    window.addEventListener('keydown', forget, { capture: true });
    window.addEventListener('click', check, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', remember, { capture: true });
      window.removeEventListener('pointercancel', forget, { capture: true });
      window.removeEventListener('keydown', forget, { capture: true });
      window.removeEventListener('click', check, { capture: true });
    };
  }, []);
}
