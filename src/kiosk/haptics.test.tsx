/**
 * What the kiosk buzzes for.
 *
 * A tablet on a stand in a lobby is the one Tally surface nobody is holding.
 * The screen is a metre from a parent's face, angled away, and often being
 * looked past rather than at — so the vibrator carries feedback the eyes may
 * never collect: the key took, the child is checked in.
 *
 * These pin the deliberate asymmetry between the two. Keys buzz on contact,
 * every one of them, including the presses the buffer refuses — a key reports
 * that the glass took the press, not that the press meant anything. A hold
 * buzzes only when it completes, and that is the more important half: one of
 * the two holds is the invisible staff gate in the corner of the search screen,
 * and a buzz on contact would announce it to whoever brushed past.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoldButton, HOLD_MS } from '@/kiosk/components/HoldButton';
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
 * `fireEvent.pointerDown` rather than a click, throughout: the kiosk listens on
 * `pointerdown` because it fires on glass contact, and the keyboard delegates a
 * single listener on its container — so the event has to be a real bubbling one
 * on the key itself.
 */
function press(element: Element): void {
  fireEvent.pointerDown(element);
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
    press(container.querySelector('.flex-\\[0\\.5\\]')!);

    expect(onKey).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
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
        onToggle={vi.fn()}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );

    press(screen.getByText('Check in'));

    // On contact, with the confirmation — not after the write, which the
    // success screen does not wait for either.
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
        onToggle={vi.fn()}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    press(screen.getByText(/Already checked in/));

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

    vi.advanceTimersByTime(HOLD_MS);

    // Three seconds is long enough that a thumb needs telling when it may
    // leave, and the staff gate has no other feedback at all.
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
    vi.advanceTimersByTime(HOLD_MS - 100);
    fireEvent.pointerUp(button);
    vi.advanceTimersByTime(HOLD_MS);

    expect(vibrate).not.toHaveBeenCalled();
    expect(onHeld).not.toHaveBeenCalled();
  });
});
