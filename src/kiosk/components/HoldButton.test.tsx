/**
 * The two-second hold, and the one caller that needs it to be strict.
 *
 * `HoldButton` is deliberately forgiving by default: on a chooser row the thumb
 * is already on the thing it means, and two seconds is a long time to ask
 * anybody to hold still. The list under it is the browser's to arbitrate — it
 * sends `pointercancel` the moment a press becomes a scroll — so a drift that
 * survives that far is a thumb wobbling on the row it picked.
 *
 * The reprint offer on the already-checked-in screen is not that. It shares
 * glass with the band a parent's thumb travels through on its way to the green
 * `Check in`, on a lobby tablet people lean on — and without a drift check *any*
 * contact persisting two seconds anywhere inside the control prints, wherever it
 * slid to: a planted palm, a bag strap, a hand steadying the tablet. `touchAction`
 * is `none` there, so the browser never calls the contact a scroll, and implicit
 * pointer capture means `pointerleave` never fires on touch either.
 *
 * The hint is the other half, and it is not decoration. `haptic()` is
 * `navigator.vibrate`, which iOS Safari does not implement, so on the iPads these
 * kiosks are, a cancelled hold and a broken button were the same event: an empty
 * bar under a thumb that kept pressing.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOLD_DELAY_MS, HOLD_MS, HoldButton, STRAY_HINT_MS } from './HoldButton';
import { TAP_SLOP_PX } from './tapGuard';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** One contact, from `down` to wherever it drifts, held past the threshold. */
async function holdFrom(
  button: HTMLElement,
  { dx = 0, dy = 0 }: { dx?: number; dy?: number } = {},
): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, clientY: 100 });
  });
  if (dx !== 0 || dy !== 0) {
    await act(async () => {
      fireEvent.pointerMove(button, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy });
    });
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS + HOLD_MS + 50);
  });
}

/**
 * Which of the two strings the control is actually saying.
 *
 * Both are in the DOM at once — the hidden one is what keeps the button from
 * narrowing when the other takes over — so `getByText` alone answers "is this
 * string rendered", which is now always yes. What a person sees, and what a
 * screen reader reads, is the cell that is not hidden.
 */
function saying(): string {
  // The cells, not the wrapper that holds them and not the fill bar: both of
  // those are spans too, and the wrapper's text is every string at once.
  const label = screen
    .getByRole('button')
    .querySelectorAll<HTMLElement>('span > span:not([aria-hidden])');
  return [...label]
    .map((node) => node.textContent ?? '')
    .join('')
    .trim();
}

/** The fill, which is the first thing inside the button and always there. */
function bar(): HTMLElement {
  return screen.getByRole('button').querySelector('span')!;
}

describe('the grace before the count', () => {
  /*
   * A press and the first frame of a drag are the same event. The delay is the
   * kiosk declining to guess, and it is the whole reason the gesture can be
   * arbitrated at all — so the two seconds are two seconds *of holding*, and
   * they start when the holding is established rather than when the glass is
   * touched.
   */
  it('does not fire at two seconds flat', async () => {
    const onHeld = vi.fn();
    render(<HoldButton onHeld={onHeld}>Hold me</HoldButton>);

    await act(async () => {
      fireEvent.pointerDown(screen.getByText('Hold me'), { pointerId: 1, clientX: 100, clientY: 100 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOLD_MS);
    });
    expect(onHeld).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS);
    });
    expect(onHeld).toHaveBeenCalledTimes(1);
  });

  /*
   * And nothing is drawn inside it. On the chooser's rows a press means
   * *select* as well as *hold*, so a bar that flashed on every selection would
   * report a hold begun and abandoned on the one gesture that succeeded.
   */
  it('draws nothing until the count starts', async () => {
    render(
      <HoldButton onHeld={vi.fn()} onTap={vi.fn()}>
        Hold me
      </HoldButton>,
    );
    const button = screen.getByText('Hold me');

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, clientY: 100 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS - 50);
    });
    expect(bar().style.transform).toBe('scaleX(0)');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(bar().style.transform).toBe('scaleX(1)');
  });

  /* A tap is still a tap, and lands inside the window every time. */
  it('lets a short press through as a tap, having drawn nothing', async () => {
    const onTap = vi.fn();
    const onHeld = vi.fn();
    render(
      <HoldButton onHeld={onHeld} onTap={onTap}>
        Hold me
      </HoldButton>,
    );
    const button = screen.getByText('Hold me');

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerUp(button, { pointerId: 1, clientX: 100, clientY: 100 });
    });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onHeld).not.toHaveBeenCalled();
    expect(bar().style.transform).toBe('scaleX(0)');
  });
});

describe('a drag that beats the hold', () => {
  /*
   * The arbitration, and the kiosk's side of it.
   *
   * A hold on a row cannot pin the list under it — `touch-action` is read when
   * the gesture begins and the pan is on the compositor by the time the count
   * starts, which a version of this component learned the hard way (the note in
   * HoldButton.tsx has the measurement). So the browser decides, and it says the
   * scroll wins: `pointercancel` arrives, and everything this control was in the
   * middle of has to stop with it — no fire, and an emptied bar, because a bar
   * left filling under a list that is moving is the control lying about what it
   * is still doing.
   */
  it('gives up the count the moment the browser claims the gesture', async () => {
    const onHeld = vi.fn();
    render(
      <HoldButton onHeld={onHeld} onTap={vi.fn()}>
        Hold me
      </HoldButton>,
    );
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, clientY: 100 });
      await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS + 50);
    });
    expect(bar().style.transform).toBe('scaleX(1)');

    await act(async () => {
      fireEvent.pointerCancel(button, { pointerId: 1 });
    });
    expect(bar().style.transform).toBe('scaleX(0)');

    // And the count that was running does not go off in the background.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
    });
    expect(onHeld).not.toHaveBeenCalled();
  });

  /*
   * The grace is the only real say the kiosk has, and this is what it buys: a
   * finger still at `HOLD_DELAY_MS` has not asked the browser for a scroll, so
   * the fight never starts.
   */
  it('is not started at all by a press that was already moving', async () => {
    const onHeld = vi.fn();
    render(
      <HoldButton onHeld={onHeld} onTap={vi.fn()}>
        Hold me
      </HoldButton>,
    );
    const button = screen.getByRole('button');

    await act(async () => {
      fireEvent.pointerDown(button, { pointerId: 1, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(button, { pointerId: 1, clientX: 100, clientY: 100 + TAP_SLOP_PX * 4 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOLD_DELAY_MS + HOLD_MS + 50);
    });

    expect(onHeld).not.toHaveBeenCalled();
    expect(bar().style.transform).toBe('scaleX(0)');
  });
});

describe('a hold that stands alone', () => {
  it('fires after two seconds', async () => {
    const onHeld = vi.fn();
    render(<HoldButton onHeld={onHeld}>Hold me</HoldButton>);

    await holdFrom(screen.getByText('Hold me'));

    expect(onHeld).toHaveBeenCalledTimes(1);
  });

  /*
   * The forgiveness is the documented default and two shipping screens rely on
   * it. This is the regression test for leaving them alone.
   */
  it('forgives a finger that wanders, when nothing asks it not to', async () => {
    const onHeld = vi.fn();
    render(<HoldButton onHeld={onHeld}>Hold me</HoldButton>);

    await holdFrom(screen.getByText('Hold me'), { dx: TAP_SLOP_PX * 4 });

    expect(onHeld).toHaveBeenCalledTimes(1);
  });
});

describe('a hold that shares glass with something else', () => {
  it('cancels when the finger wanders past the slop', async () => {
    const onHeld = vi.fn();
    render(
      <HoldButton onHeld={onHeld} cancelOnStray>
        Hold me
      </HoldButton>,
    );

    await holdFrom(screen.getByText('Hold me'), { dx: TAP_SLOP_PX + 1 });

    expect(onHeld).not.toHaveBeenCalled();
  });

  it('still fires for the wobble of a thumb held still', async () => {
    const onHeld = vi.fn();
    render(
      <HoldButton onHeld={onHeld} cancelOnStray>
        Hold me
      </HoldButton>,
    );

    await holdFrom(screen.getByText('Hold me'), { dx: TAP_SLOP_PX - 1, dy: TAP_SLOP_PX - 1 });

    expect(onHeld).toHaveBeenCalledTimes(1);
  });

  /*
   * Without this the control is indistinguishable from a broken one: the fill
   * snaps to empty with no transition, nothing happens in the hand, and pressing
   * harder does not help because only a fresh `pointerdown` can re-arm it.
   */
  it('says what happened, and says it until the next press', async () => {
    const onHeld = vi.fn();
    render(
      <HoldButton onHeld={onHeld} cancelOnStray strayHint="Lift, then hold again">
        Hold me
      </HoldButton>,
    );
    const button = screen.getByText('Hold me');
    expect(saying()).toBe('Hold me');

    await holdFrom(button, { dx: TAP_SLOP_PX + 1 });
    expect(saying()).toBe('Lift, then hold again');

    // The finger comes off to read it, and the sentence is still there.
    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(saying()).toBe('Lift, then hold again');

    // One press re-arms it, and the label comes back with the count.
    await holdFrom(button);
    expect(onHeld).toHaveBeenCalledTimes(1);
    expect(saying()).toBe('Hold me');
  });

  /*
   * The instruction is addressed to a hand, and outlives it by seconds rather
   * than by the evening.
   *
   * Nothing else on this screen has a clock, so a parent whose thumb wandered
   * and who then walked off used to leave *Lift, then hold again* on the glass
   * for the next family — on the one element that would otherwise have told them
   * a name tag was there for the asking.
   */
  it('puts the label back a few seconds after the hand comes off', async () => {
    render(
      <HoldButton onHeld={vi.fn()} cancelOnStray strayHint="Lift, then hold again">
        Hold me
      </HoldButton>,
    );
    const button = screen.getByText('Hold me');

    await holdFrom(button, { dx: TAP_SLOP_PX + 1 });
    await act(async () => {
      fireEvent.pointerUp(button, { pointerId: 1 });
    });
    expect(saying()).toBe('Lift, then hold again');

    // Still there while somebody could plausibly be reading it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STRAY_HINT_MS - 500);
    });
    expect(saying()).toBe('Lift, then hold again');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(saying()).toBe('Hold me');
  });

  /*
   * And the clock belongs to the gesture: a thumb still down is somebody still
   * reading, and the sentence must not go while they are looking at it.
   */
  it('does not start that clock while the finger is still down', async () => {
    render(
      <HoldButton onHeld={vi.fn()} cancelOnStray strayHint="Lift, then hold again">
        Hold me
      </HoldButton>,
    );
    const button = screen.getByText('Hold me');

    await holdFrom(button, { dx: TAP_SLOP_PX + 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STRAY_HINT_MS * 2);
    });
    expect(saying()).toBe('Lift, then hold again');
  });
});
