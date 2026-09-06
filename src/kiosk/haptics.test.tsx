/**
 * What the kiosk buzzes for.
 *
 * A tablet on a stand in a lobby is the one Tally surface nobody is holding.
 * The screen is a metre from a parent's face, angled away, and often being
 * looked past rather than at — so the vibrator carries feedback the eyes may
 * never collect: the key took, the child is checked in.
 *
 * These pin the deliberate asymmetry between the three. Keys buzz on contact,
 * every one of them, including the presses the buffer refuses — a key reports
 * that the glass took the press, not that the press meant anything. A hold
 * buzzes only when it completes, and that is the more important half: a hold
 * that buzzed on contact would tell a thumb the gesture had happened when it
 * had only started.
 *
 * The buttons sit between them and buzz on the lift, because that is when they
 * act. They used to buzz on contact, back when they also fired on contact, and
 * the two moved together on purpose: a buzz is the kiosk saying *taken*, and a
 * kiosk that said it while the finger could still slide off and mean nothing
 * would be lying in the one channel a parent is not looking at.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOLD_DELAY_MS, HoldButton, HOLD_MS } from '@/kiosk/components/HoldButton';
import { Keyboard } from '@/kiosk/components/Keyboard';
import { ConfirmScreen } from '@/kiosk/screens/ConfirmScreen';
import type { KioskStudent } from '@/kiosk/search';

const ADA: KioskStudent = {
  id: 'student-ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  grade: 8,
  searchName: 'ada lovelace',
  hasAllergies: false,
};

/*
 * The Vibration API is not in this project's DOM lib — which is the same reason
 * `haptic` casts for it rather than calling it straight, and why the setup file
 * has to install one for jsdom.
 */
type Vibrating = Navigator & { vibrate: (pattern: number | number[]) => boolean };

function spyOnVibrate() {
  return vi.spyOn(navigator as Vibrating, 'vibrate').mockReturnValue(true);
}

let vibrate: ReturnType<typeof spyOnVibrate>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vibrate = spyOnVibrate();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * `fireEvent.pointerDown` rather than a click: the keyboard delegates a single
 * listener on its container, so the event has to be a real bubbling one on the
 * key itself, and jsdom has no `PointerEvent` for a click to synthesise.
 *
 * Contact only, which is all a key is. The buttons need the lift as well and
 * have `tap` below — the split between the two is the point of this file's
 * second and third groups.
 */
function press(element: Element): void {
  fireEvent.pointerDown(element);
}

/** A whole press on a button: down, and the lift that means it. */
function tap(element: Element): void {
  fireEvent.pointerDown(element);
  fireEvent.pointerUp(element);
}

function key(label: string): Element {
  return screen.getByText(label, { selector: '[data-key]' });
}

describe('the kiosk keyboard', () => {
  it('buzzes on every key', () => {
    render(<Keyboard onKey={vi.fn()} />);

    press(key('A'));
    press(key('7'));
    press(screen.getByLabelText('Delete'));
    press(screen.getByText('Clear'));
    press(screen.getByLabelText('Space'));

    expect(vibrate).toHaveBeenCalledTimes(5);
  });

  it('buzzes shorter than a check-in does', () => {
    render(<Keyboard onKey={vi.fn()} />);

    press(key('A'));

    // A key is contact feedback under a moving finger, not a confirmation; it
    // has to stay under the buzz that says a child is checked in.
    expect(vibrate).toHaveBeenCalledWith(expect.any(Number));
    expect(vibrate.mock.calls[0]?.[0]).toBeLessThan(12);
  });

  it('stays silent on the gaps between the keys', () => {
    const onKey = vi.fn();
    const { container } = render(<Keyboard onKey={onKey} />);

    // The staggering spacers, which are part of the delegated container and
    // land under a thumb aiming at A or Z.
    press(container.querySelector('[data-gap]')!);

    expect(onKey).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('types the straight apostrophe, whatever the key shows', () => {
    const onKey = vi.fn();
    render(<Keyboard onKey={onKey} />);

    // The key wears a typographer's ’; the buffers accept the straight mark,
    // and for as long as the key typed what it showed, O'Brien registered as
    // Obrien with a buzz and no letter.
    press(screen.getByLabelText('Apostrophe'));
    press(screen.getByLabelText('Hyphen'));

    expect(onKey.mock.calls.map(([key]) => key)).toEqual([
      { kind: 'char', value: "'" },
      { kind: 'char', value: '-' },
    ]);
  });

  it('keeps each mark the only thing inside its key', () => {
    render(<Keyboard onKey={vi.fn()} />);

    // The handler types a key's text when it is one character long; a second
    // child, or a stray space, would silently fall the hyphen back to its name.
    expect(screen.getByLabelText('Hyphen').textContent).toBe('-');
    expect(screen.getByLabelText('Apostrophe').textContent).toBe('’');
  });
});

describe('the kiosk keyboard’s geometry', () => {
  /** A key's span on the board's twenty-cell track, read off its classes. */
  function span(element: Element): number {
    return Number(/col-span-(\d+)/.exec(element.className)?.[1]);
  }

  it('centres the space bar: both flanks of the bottom row weigh the same', () => {
    render(<Keyboard onKey={vi.fn()} />);

    const row = screen.getByLabelText('Space').parentElement!;
    const spans = [...row.children].map(span);
    // Clear · space · ’ · - — 4 · 12 · 2 · 2 of twenty, so the bar's centre is
    // the board's midline by construction, on every glass.
    expect(spans).toEqual([4, 12, 2, 2]);
    expect(spans.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it('lays every row on the same twenty cells', () => {
    const { container } = render(<Keyboard onKey={vi.fn()} shift="off" />);

    for (const row of container.firstElementChild!.children) {
      expect([...row.children].map(span).reduce((a, b) => a + b, 0)).toBe(20);
    }
  });

  it('gives the two seams that cost something more air than the rest', () => {
    const { container } = render(<Keyboard onKey={vi.fn()} />);

    // Clear gives 8px back on its bar side; the bottom row sits under a deeper
    // gutter than the 6px between the rows above.
    expect(screen.getByText('Clear').className).toMatch(/\bmr-2\b/);
    const rows = [...container.firstElementChild!.children];
    expect(rows.at(-1)!.className).toMatch(/\bmt-\[10px\]/);
    for (const row of rows.slice(0, -1)) expect(row.className).not.toMatch(/\bmt-/);
  });
});

describe('confirming at the kiosk', () => {
  it('buzzes on the tap that checks a child in', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmScreen
        student={ADA}
        intent="check-in"
        family={[]}
        skipped={new Set()}
        reprintOffer="none"
        onReprint={() => {}}
        onToggle={vi.fn()}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    tap(screen.getByText('Check in'));

    // On the lift, with the confirmation — not after the write, which the
    // success screen does not wait for either. The buzz moved off contact when
    // the button did: it says the press was taken, so it has to arrive when the
    // press is taken and not a gesture earlier.
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('says nothing to a parent tapping a child who is already checked in', () => {
    render(
      <ConfirmScreen
        student={ADA}
        intent="done"
        family={[]}
        skipped={new Set()}
        reprintOffer="none"
        onReprint={() => {}}
        onToggle={vi.fn()}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    tap(screen.getByText(/Already checked in/));

    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('the press-and-hold gate', () => {
  it('buzzes when the hold completes', () => {
    const onHeld = vi.fn();
    render(
      <HoldButton onHeld={onHeld}>
        Hold to collect
      </HoldButton>,
    );

    press(screen.getByText('Hold to collect'));
    expect(vibrate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_MS);

    // Two seconds is long enough that a thumb needs telling when it may
    // leave, and a buzz on contact would say the gesture had already happened.
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(onHeld).toHaveBeenCalledTimes(1);
  });

  it('stays silent when a hold is let go early', () => {
    const onHeld = vi.fn();
    render(
      <HoldButton onHeld={onHeld}>
        Hold to collect
      </HoldButton>,
    );

    const button = screen.getByText('Hold to collect');
    press(button);
    vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_MS - 100);
    fireEvent.pointerUp(button);
    vi.advanceTimersByTime(HOLD_DELAY_MS + HOLD_MS);

    expect(vibrate).not.toHaveBeenCalled();
    expect(onHeld).not.toHaveBeenCalled();
  });
});
