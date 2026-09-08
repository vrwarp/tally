/**
 * The bar that sits over the bottom of the check-in screen.
 *
 * Two things about it are safety properties rather than polish, and both are
 * pinned below.
 *
 * The panel must pass taps through. It is fixed over exactly where the roster
 * rows a counselor is tapping live — on a 412px phone it covers the bottom half
 * of the most-tapped row, and three of them stack two rows deep. A tap the
 * panel swallows produces no flash, no haptic and no write, so a student who is
 * standing right there is recorded absent; and the moment it is most likely is
 * straight after an undo, re-tapping the correct name. Only the two controls
 * take taps back.
 *
 * And the timers have to be cleaned up — on dismiss, on replacement, and on
 * unmount — or a toast dismissed by hand still fires its own dismissal later,
 * against whatever id has since been minted.
 */
import { act, fireEvent, render, screen } from '@/test/rtl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DURATION_MS,
  SHORT_DURATION_MS,
  ToastProvider,
} from '@/context/ToastProvider';
import { useToast, type ToastContextValue } from '@/context/toastContext';

let latest: ToastContextValue | null = null;

function Probe() {
  latest = useToast();
  return null;
}

function mount() {
  return render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );
}

const messages = () =>
  screen.queryAllByRole('status').flatMap((region) =>
    [...region.querySelectorAll('span')].map((span) => span.textContent),
  );

beforeEach(() => {
  latest = null;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('showing a toast', () => {
  it('puts the message on screen and hands back its id', () => {
    mount();

    let id = '';
    act(() => {
      id = latest?.show('Checked in') ?? '';
    });

    expect(id).toBe('toast-1');
    expect(messages()).toEqual(['Checked in']);
  });

  it('gives every toast an id of its own', () => {
    mount();

    let first = '';
    let second = '';
    act(() => {
      first = latest?.show('One') ?? '';
      second = latest?.show('Two') ?? '';
    });

    expect(first).not.toBe(second);
  });

  it('is informational unless the caller says otherwise', () => {
    mount();
    act(() => void latest?.show('Checked in'));

    expect(latest?.toasts[0]?.tone).toBe('info');
  });

  it('takes the tone the caller chose', () => {
    mount();
    act(() => void latest?.show('Saved', { tone: 'success' }));
    expect(latest?.toasts[0]?.tone).toBe('success');
  });

  it('draws each tone in its own colour', () => {
    /*
     * The tone is the whole message for somebody who has glanced up from a
     * queue: green means the check-in landed, red means it did not. Three
     * toasts that look alike put the difference entirely in words nobody has
     * time to read.
     */
    mount();
    act(() => void latest?.show('Saved', { tone: 'success' }));
    act(() => void latest?.show('Failed', { tone: 'error' }));
    act(() => void latest?.show('Heads up', { tone: 'info' }));

    const rows = ['Saved', 'Failed', 'Heads up'].map(
      (message) => screen.getByText(message).parentElement!,
    );

    expect(rows[0]!.className).toContain('bg-present-600');
    expect(rows[1]!.className).toContain('bg-danger-600');
    expect(rows[2]!.className).toContain('bg-ink-800');
    // And no row wears another's colour.
    expect(rows[0]!.className).not.toContain('bg-danger-600');
    expect(rows[1]!.className).not.toContain('bg-present-600');
  });

  it('carries an action when there is one, and none when there is not', () => {
    mount();
    act(() => void latest?.show('Checked in', { action: { label: 'Undo', onPress: vi.fn() } }));
    expect(latest?.toasts[0]?.action?.label).toBe('Undo');

    act(() => void latest?.show('Saved'));
    expect(latest?.toasts.at(-1)).not.toHaveProperty('action');
  });

  it('keeps at most three, dropping the oldest', () => {
    // Three stack two rows deep over the roster. A fourth would reach the row
    // a thumb is actually aiming at.
    mount();
    act(() => {
      latest?.show('One');
      latest?.show('Two');
      latest?.show('Three');
      latest?.show('Four');
    });

    expect(messages()).toEqual(['Two', 'Three', 'Four']);
  });
});

describe('how long a toast stays up', () => {
  it('clears itself after the default four seconds', () => {
    mount();
    act(() => void latest?.show('Checked in'));

    act(() => vi.advanceTimersByTime(DEFAULT_DURATION_MS - 1));
    expect(messages()).toEqual(['Checked in']);

    act(() => vi.advanceTimersByTime(1));
    expect(messages()).toEqual([]);
  });

  it('clears sooner when the screen has already said it another way', () => {
    // A check-in recolours the row it happened on, so the toast is a second
    // copy of an answer already on screen — sitting in the thumb zone, over the
    // next name in the queue.
    mount();
    act(() => void latest?.show('Checked in', { durationMs: SHORT_DURATION_MS }));

    act(() => vi.advanceTimersByTime(SHORT_DURATION_MS));
    expect(messages()).toEqual([]);
  });

  it('holds the short one for its whole window', () => {
    mount();
    act(() => void latest?.show('Checked in', { durationMs: SHORT_DURATION_MS }));

    act(() => vi.advanceTimersByTime(SHORT_DURATION_MS - 1));
    expect(messages()).toEqual(['Checked in']);
  });

  it('clears each one on its own clock', () => {
    mount();
    act(() => void latest?.show('Quick', { durationMs: 1000 }));
    act(() => void latest?.show('Slow', { durationMs: 5000 }));

    act(() => vi.advanceTimersByTime(1000));
    expect(messages()).toEqual(['Slow']);

    act(() => vi.advanceTimersByTime(4000));
    expect(messages()).toEqual([]);
  });
});

describe('dismissing', () => {
  it('takes exactly the named toast off', () => {
    mount();
    let first = '';
    act(() => {
      first = latest?.show('One') ?? '';
      latest?.show('Two');
    });

    act(() => latest?.dismiss(first));

    expect(messages()).toEqual(['Two']);
  });

  it('forgets the timer, so a later id cannot be dismissed by an old one', () => {
    // The timers are keyed by id and the ids are minted from a counter. A timer
    // left running fires `dismiss` against an id that may have come back round.
    mount();
    let id = '';
    act(() => {
      id = latest?.show('One') ?? '';
    });

    act(() => latest?.dismiss(id));
    act(() => void latest?.show('Two'));

    act(() => vi.advanceTimersByTime(DEFAULT_DURATION_MS - 1));
    expect(messages()).toEqual(['Two']);
  });

  it('does nothing at all for an id that is not up', () => {
    mount();
    act(() => void latest?.show('One'));

    expect(() => act(() => latest?.dismiss('toast-999'))).not.toThrow();
    expect(messages()).toEqual(['One']);
  });

  it('is what the × button does', () => {
    mount();
    act(() => void latest?.show('Checked in'));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(messages()).toEqual([]);
  });

  it('follows the action button, after the action', () => {
    const onPress = vi.fn();
    mount();
    act(() => void latest?.show('Checked in', { action: { label: 'Undo', onPress } }));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual([]);
  });

  it('clears every timer on unmount', () => {
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = mount();
    act(() => {
      latest?.show('One');
      latest?.show('Two');
    });

    unmount();

    expect(cleared).toHaveBeenCalledTimes(2);
  });

  it('takes the timer down with the toast', () => {
    // Otherwise a lobby screen that shows a toast per check-in keeps a live
    // timeout per check-in for the rest of the evening.
    mount();
    act(() => void latest?.show('Checked in'));
    expect(vi.getTimerCount()).toBe(1);

    act(() => latest?.dismiss('toast-1'));

    expect(vi.getTimerCount()).toBe(0);
  });

  it('forgets a timer it has already cleared, rather than clearing it twice', () => {
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = mount();
    act(() => {
      latest?.show('One');
      latest?.show('Two');
    });

    act(() => latest?.dismiss('toast-1'));
    unmount();

    // One for the dismiss, one for the toast still up. A third would mean the
    // map is still holding the dismissed one.
    expect(cleared).toHaveBeenCalledTimes(2);
  });
});

describe('the panel over the roster', () => {
  it('passes taps through to whatever is under it', () => {
    // A tap the panel swallows produces no flash, no haptic and no write — and
    // a student standing right there is recorded absent.
    mount();
    act(() => void latest?.show('Checked in'));

    const region = screen.getByRole('status');
    expect(region.className).toContain('pointer-events-none');
    expect(region.firstElementChild?.className).toContain('pointer-events-none');
  });

  it('takes taps back on the two controls and nowhere else', () => {
    mount();
    act(() => void latest?.show('Checked in', { action: { label: 'Undo', onPress: vi.fn() } }));

    for (const name of ['Undo', 'Dismiss']) {
      expect(screen.getByRole('button', { name }).className).toContain('pointer-events-auto');
    }
  });

  it('is announced politely rather than interrupting', () => {
    mount();

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('colours the three tones apart', () => {
    mount();
    act(() => {
      latest?.show('Saved', { tone: 'success' });
      latest?.show('Failed', { tone: 'error' });
      latest?.show('Noted', { tone: 'info' });
    });

    const panels = [...screen.getByRole('status').children].map((node) => node.className);
    expect(panels[0]).toContain('bg-present-600');
    expect(panels[1]).toContain('bg-danger-600');
    expect(panels[2]).toContain('bg-ink-800');

    // And *only* its own: three background classes on one panel is a toast
    // whose colour depends on which rule the stylesheet happens to win with.
    expect(panels[0]).not.toContain('bg-danger-600');
    expect(panels[0]).not.toContain('bg-ink-800');
    expect(panels[1]).not.toContain('bg-present-600');
    expect(panels[1]).not.toContain('bg-ink-800');
    expect(panels[2]).not.toContain('bg-present-600');
    expect(panels[2]).not.toContain('bg-danger-600');
  });

  it('draws no action button when there is no action', () => {
    mount();
    act(() => void latest?.show('Checked in'));

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('useToast outside the provider', () => {
  it('says so rather than handing back nothing', () => {
    const noisy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useToast must be used inside <ToastProvider>.');
    noisy.mockRestore();
  });
});
