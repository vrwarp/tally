/**
 * Telling a tap from the start of a scroll, for the rows that can be both.
 *
 * Nearly everything on the kiosk commits on `pointerdown`, because that is what
 * makes a key feel instant on glass. A row inside a list that scrolls cannot:
 * the first touch of a scroll gesture lands on a row, and firing there would
 * send a parent to the confirm screen for whichever child they happened to push
 * off with — or untick a sibling they were only scrolling past.
 *
 * So a row waits for the finger to come off, and only counts as a tap if it
 * came off near where it went on. The browser sends `pointercancel` the moment
 * it decides a touch is a scroll, which handles the fling; the slop below covers
 * the slower drag that ends with the finger lifted back close to its start.
 *
 * The cost is the few milliseconds between contact and lift, paid on the taps
 * where being right matters more than being quick.
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

/** Where a finger landed on a row, and which finger it was. */
interface Press {
  pointerId: number;
  x: number;
  y: number;
}

/** Whether this pointer has moved far enough to have meant a scroll. */
function strayed(press: Press | null, event: React.PointerEvent): boolean {
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
 * Returns a factory: call it with whatever the row stands for, spread the
 * result onto the row, and `onTap` fires with that value on a real tap.
 *
 * One press is tracked at a time — a lobby kiosk has one thumb on it — so the
 * handlers all share the hook's own ref rather than one per row.
 */
export function useTapGuard<T>(onTap: (value: T) => void): (value: T) => TapHandlers {
  const pressRef = useRef<Press | null>(null);
  const tapRef = useRef(onTap);
  tapRef.current = onTap;

  return useCallback((value: T) => {
    const clear = () => {
      pressRef.current = null;
    };
    return {
      onPointerDown: (event: React.PointerEvent) => {
        // Keeps the touch from selecting text or focusing the row mid-drag.
        event.preventDefault();
        pressRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      },
      onPointerMove: (event: React.PointerEvent) => {
        if (pressRef.current && strayed(pressRef.current, event)) clear();
      },
      onPointerUp: (event: React.PointerEvent) => {
        const wasTap = !strayed(pressRef.current, event);
        clear();
        if (wasTap) tapRef.current(value);
      },
      onPointerCancel: clear,
      onPointerLeave: clear,
    };
  }, []);
}
