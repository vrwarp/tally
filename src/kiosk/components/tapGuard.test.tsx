/**
 * What counts as a press, on the two kinds of control that answer one.
 *
 * Both wait for the lift, and the whole question is what the lift is measured
 * against. A button asks whether the finger came off inside it, which is what
 * every control on every phone asks. A row in a scrolling list asks how far the
 * finger travelled, because there the travel is the other thing a press can
 * have meant — and a row cannot ask the button's question at all: a scroll that
 * starts on a row ends on a row, the list having moved underneath.
 *
 * jsdom gives every element a zero-sized box at the origin, so the bounds are
 * stubbed here rather than laid out. Without that these tests pass by accident:
 * `fireEvent` defaults every coordinate to zero, and zero sits on the edge of a
 * zero rect.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TAP_SLOP_PX, useTap, useTapGuard } from './tapGuard';

afterEach(cleanup);

/** A control 200×80, sitting at (100, 100). */
function boxed(node: HTMLElement): HTMLElement {
  node.getBoundingClientRect = () =>
    ({
      x: 100,
      y: 100,
      left: 100,
      top: 100,
      right: 300,
      bottom: 180,
      width: 200,
      height: 80,
      toJSON: () => ({}),
    }) as DOMRect;
  return node;
}

function Button({ onPress }: { onPress: () => void }) {
  const tap = useTap();
  return (
    <button type="button" {...tap(onPress)}>
      Press me
    </button>
  );
}

function Row({ onPick }: { onPick: (value: string) => void }) {
  const rowTap = useTapGuard(onPick);
  return (
    <button type="button" {...rowTap('ada')}>
      Ada Lovelace
    </button>
  );
}

/** The middle of the stubbed box. */
const CENTRE = { clientX: 200, clientY: 140 };

function down(node: HTMLElement, at: { clientX: number; clientY: number } = CENTRE): void {
  fireEvent.pointerDown(node, { pointerId: 1, ...at });
}

function up(node: HTMLElement, at: { clientX: number; clientY: number } = CENTRE): void {
  fireEvent.pointerUp(node, { pointerId: 1, ...at });
}

describe('a button', () => {
  it('fires when the finger comes off inside it', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress} />);
    const button = boxed(screen.getByRole('button'));

    down(button);
    up(button);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  /*
   * The reason the buttons are measured this way and not by the rows' dozen
   * pixels. A commit button here is the width of the screen and 64px tall, a
   * thumb on glass rolls further than that while pressing, and every platform
   * this kiosk's users have ever touched counts it. Cancelling on twelve pixels
   * meant a firm press did nothing at all, silently, on the one control that
   * checks a child in.
   */
  it('fires for a press that wanders well past what a row would allow', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress} />);
    const button = boxed(screen.getByRole('button'));

    down(button);
    up(button, { clientX: 200 + TAP_SLOP_PX * 3, clientY: 140 });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the finger leaves the control before lifting', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress} />);
    const button = boxed(screen.getByRole('button'));

    down(button);
    // Past the right edge, which is the whole of what sliding off means.
    up(button, { clientX: 340, clientY: 140 });

    expect(onPress).not.toHaveBeenCalled();
  });

  /*
   * Sliding off is a promise, not a trap: the control has to still be there
   * when the hand comes back. This is the half that a `pointermove` handler
   * dropping the press quietly broke — the button had stopped listening, and
   * nothing on the glass said so.
   */
  it('still fires for a finger that slides off and comes back', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress} />);
    const button = boxed(screen.getByRole('button'));

    down(button);
    fireEvent.pointerMove(button, { pointerId: 1, clientX: 400, clientY: 400 });
    fireEvent.pointerMove(button, { pointerId: 1, ...CENTRE });
    up(button);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  /* The browser's own word for "this touch was a scroll" still ends it. */
  it('does nothing once the browser has claimed the gesture', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress} />);
    const button = boxed(screen.getByRole('button'));

    down(button);
    fireEvent.pointerCancel(button, { pointerId: 1 });
    up(button);

    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('a row in a list that scrolls', () => {
  it('fires for a finger that stayed put', () => {
    const onPick = vi.fn();
    render(<Row onPick={onPick} />);
    const row = boxed(screen.getByRole('button'));

    down(row);
    up(row, { clientX: 200, clientY: 140 + TAP_SLOP_PX - 1 });

    expect(onPick).toHaveBeenCalledWith('ada');
  });

  /*
   * And here the travel is what matters, even though the lift landed on the row
   * — which after a scroll it always does, because the row came to meet it.
   */
  it('does nothing for a finger that dragged the list, wherever it ended up', () => {
    const onPick = vi.fn();
    render(<Row onPick={onPick} />);
    const row = boxed(screen.getByRole('button'));

    down(row);
    up(row, { clientX: 200, clientY: 140 + TAP_SLOP_PX * 4 });

    expect(onPick).not.toHaveBeenCalled();
  });
});
