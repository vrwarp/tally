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
 * saying what it meant.
 *
 * The keyboard is the exception, and stays on contact — see components/
 * Keyboard.tsx. A key reports that the glass took the press, and a letter that
 * waits for the lift is a keyboard that feels broken rather than careful.
 *
 * The browser sends `pointercancel` the moment it decides a touch is a scroll,
 * which handles the fling; the slop below covers the slower drag that ends with
 * the finger lifted back close to its start.
 */
import { useCallback, useRef } from 'react';

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

export interface TapHandlers {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
}

/**
 * Returns a factory: call it with whatever the control stands for, spread the
 * result onto the control, and `onTap` fires with that value on a real tap.
 *
 * One press is tracked at a time — a lobby kiosk has one thumb on it — so the
 * handlers all share the hook's own ref rather than one per control.
 *
 * Which is also why the element that took the press is remembered alongside the
 * point. Rows in a list sit far enough apart that the slop alone told them
 * apart, but the buttons this now guards do not: two doors in a stack, or Back
 * beside Cancel, are a handful of pixels from each other, and a press that went
 * down on one and came up on the next must be neither rather than both.
 */
export function useTapGuard<T>(onTap: (value: T) => void): (value: T) => TapHandlers {
  const pressRef = useRef<(Press & { node: EventTarget }) | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;

  return useCallback((value: T) => {
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
      onPointerMove: (event: React.PointerEvent) => {
        if (pressRef.current && strayed(pressRef.current, event)) clear();
      },
      onPointerUp: (event: React.PointerEvent) => {
        const wasTap =
          pressRef.current?.node === event.currentTarget && !strayed(pressRef.current, event);
        clear();
        if (wasTap) tapRef.current(value);
      },
      onPointerCancel: clear,
      onPointerLeave: clear,
    };
  }, []);
}

/**
 * The same guard, for a control that means one thing rather than one of many.
 *
 * A button is a row whose value is the act itself, so this is `useTapGuard`
 * with the act passed where the row passes its student: call the hook once per
 * component, spread `tap(() => …)` onto each button, and the callback runs when
 * a finger that went down on *that* button comes off it having stayed put.
 *
 * Anything the press should also do at the moment of the act — the buzz, most
 * often — goes inside the callback, which is why the buzzes moved off contact
 * with the presses that raise them. A kiosk that vibrated when a thumb landed
 * and then did nothing when it lifted would be telling the hand the opposite of
 * what the screen was doing.
 */
export function useTap(): (run: () => void) => TapHandlers {
  return useTapGuard<() => void>((run) => run());
}
