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
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@/test/rtl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TAP_SLOP_PX, useOrphanClickGuard, useTap, useTapGuard } from './tapGuard';

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

describe('a click belonging to a press this screen never received', () => {
  /*
   * The per-control guards make React's own controls immune, because a lift is
   * only an act on the control that took the press. What they cannot cover is
   * the browser's own widgets: a `<summary>` toggles its `<details>` on a bare
   * click, and that click can belong to a press made on the screen before.
   *
   * Which is not hypothetical — it is how opening the printer screen from the
   * staff screen both opened the device chooser and popped the settings fold.
   */
  function Guarded({ children, screen = 'one' }: { children: React.ReactNode; screen?: string }) {
    useOrphanClickGuard(screen);
    return <>{children}</>;
  }

  /**
   * The two screens, and the swap between them made the way the kiosk makes it.
   *
   * The row acts on `pointerup`, exactly as `useTap` does, so the *click* that
   * finishes the same tap is dispatched after the second screen has replaced
   * the first — which is the whole shape of the bug.
   */
  function Swapping({ onArrived }: { onArrived: () => void }) {
    const [arrived, setArrived] = useState(false);
    useOrphanClickGuard(arrived ? 'printer' : 'staff');
    return arrived ? (
      <button type="button" onClick={onArrived}>
        the screen that arrived
      </button>
    ) : (
      <button type="button" onPointerUp={() => setArrived(true)}>
        the screen that was
      </button>
    );
  }

  it('stops a click whose press landed on a control that is gone', () => {
    const acted = vi.fn();
    render(<Swapping onArrived={acted} />);
    const was = screen.getByRole('button', { name: 'the screen that was' });

    fireEvent.pointerDown(was, { pointerId: 1 });
    fireEvent.pointerUp(was, { pointerId: 1 });
    // The first screen is gone; the browser now delivers the click of that same
    // tap against whatever is under the finger, which is the second screen.
    fireEvent.click(screen.getByRole('button', { name: 'the screen that arrived' }));

    expect(acted).not.toHaveBeenCalled();
  });

  it('stops a click whose press landed on a different control', () => {
    const acted = vi.fn();
    render(
      <Guarded>
        <button type="button" id="elsewhere">
          elsewhere
        </button>
        <button type="button" onClick={acted}>
          here
        </button>
      </Guarded>,
    );

    fireEvent.pointerDown(document.getElementById('elsewhere') as HTMLElement, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'here' }));

    expect(acted).not.toHaveBeenCalled();
  });

  it('lets an ordinary press-and-click through', () => {
    const acted = vi.fn();
    render(
      <Guarded>
        <button type="button" onClick={acted}>
          here
        </button>
      </Guarded>,
    );
    const button = screen.getByRole('button');

    fireEvent.pointerDown(button, { pointerId: 1 });
    fireEvent.click(button);

    expect(acted).toHaveBeenCalledTimes(1);
  });

  it('lets a click with no press at all through', () => {
    // A keyboard Enter, or one a test dispatched: there is no gesture behind it
    // for it to have been orphaned from.
    const acted = vi.fn();
    render(
      <Guarded>
        <button type="button" onClick={acted}>
          here
        </button>
      </Guarded>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(acted).toHaveBeenCalledTimes(1);
  });

  it('forgets a press that a key interrupted, so it cannot swallow a later click', () => {
    /*
     * A press that never becomes a click — a scroll, a cancelled hold — would
     * otherwise sit in the record until some unrelated click came along.
     */
    const acted = vi.fn();
    render(
      <Guarded>
        <button type="button" id="scrolled">
          scrolled
        </button>
        <button type="button" onClick={acted}>
          here
        </button>
      </Guarded>,
    );
    const scrolled = document.getElementById('scrolled') as HTMLElement;

    fireEvent.pointerDown(scrolled, { pointerId: 1 });
    fireEvent.pointerCancel(scrolled, { pointerId: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'here' }));

    expect(acted).toHaveBeenCalledTimes(1);
  });

  it('does not stop the browser’s own widgets from answering a real press', () => {
    // The fold on the printer screen: guarded against a press it never had,
    // still a disclosure the moment somebody actually presses it.
    render(
      <Guarded>
        <details>
          <summary>QL-810W · 62mm endless</summary>
          <p>the settings</p>
        </details>
      </Guarded>,
    );
    const summary = screen.getByText('QL-810W · 62mm endless');

    fireEvent.pointerDown(summary, { pointerId: 1 });
    const stopped = !fireEvent.click(summary);

    expect(stopped).toBe(false);
  });
});
