/**
 * The clock that makes temporal awareness happen.
 *
 * Without a ticking one, a counselor who opens Tally at 6:45pm and puts the
 * phone in a pocket is still looking at "no active event" when the doors open
 * at 7:00. The interval alone is not enough either: phones aggressively
 * throttle timers in a background tab, so the two resync events are what
 * actually make coming back to the app correct rather than merely eventual.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNow } from '@/hooks/useNow';

const START = new Date(2026, 1, 13, 18, 45, 0);

/** jsdom has no way to set `visibilityState`, so it is redefined per test. */
function visibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  visibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useNow', () => {
  it('opens at the current instant', () => {
    const { result } = renderHook(() => useNow());
    expect(result.current).toEqual(START);
  });

  it('ticks every thirty seconds unless told otherwise', () => {
    const { result } = renderHook(() => useNow());

    act(() => vi.advanceTimersByTime(29_000));
    expect(result.current).toEqual(START);

    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toEqual(new Date(START.getTime() + 30_000));
  });

  it('takes a cadence from a caller that has a coarser question', () => {
    // The calendar projection asks once a minute: a minute is finer than any
    // boundary it decides.
    const { result } = renderHook(() => useNow(60_000));

    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toEqual(START);

    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current).toEqual(new Date(START.getTime() + 60_000));
  });

  it('keeps ticking', () => {
    const { result } = renderHook(() => useNow(1_000));

    act(() => vi.advanceTimersByTime(3_000));

    expect(result.current).toEqual(new Date(START.getTime() + 3_000));
  });

  it('re-syncs the moment the tab comes back', () => {
    // A phone in a pocket throttles the interval to nothing; the clock has to
    // catch up when somebody looks at it again.
    const { result } = renderHook(() => useNow());

    vi.setSystemTime(new Date(START.getTime() + 20 * 60_000));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current).toEqual(new Date(START.getTime() + 20 * 60_000));
  });

  it('ignores a visibility change that hid the tab', () => {
    const { result } = renderHook(() => useNow());

    visibility('hidden');
    vi.setSystemTime(new Date(START.getTime() + 20 * 60_000));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(result.current).toEqual(START);
  });

  it('re-syncs on focus too, which is what a desktop tab gets', () => {
    const { result } = renderHook(() => useNow());

    vi.setSystemTime(new Date(START.getTime() + 5 * 60_000));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current).toEqual(new Date(START.getTime() + 5 * 60_000));
  });

  it('stops the interval and both listeners on unmount', () => {
    const { result, unmount } = renderHook(() => useNow(1_000));
    const last = result.current;

    unmount();
    vi.setSystemTime(new Date(START.getTime() + 60_000));
    act(() => {
      vi.advanceTimersByTime(5_000);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    expect(result.current).toBe(last);
  });

  it('takes back the exact interval and handlers it put out', () => {
    // The check-in screen mounts and unmounts this on every navigation, so a
    // handler left behind is a handler per visit for the rest of the session —
    // and `result.current` cannot see the leak, because an unmounted hook
    // stops reporting whether or not its timer is still firing.
    const addDocument = vi.spyOn(document, 'addEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const addWindow = vi.spyOn(window, 'addEventListener');
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const clear = vi.spyOn(globalThis, 'clearInterval');

    const { unmount } = renderHook(() => useNow(1_000));

    const added = addDocument.mock.calls.find(([type]) => type === 'visibilitychange');
    const addedFocus = addWindow.mock.calls.find(([type]) => type === 'focus');
    expect(added).toBeDefined();
    expect(addedFocus).toBeDefined();

    unmount();

    // The same name and the same function: `removeEventListener` matches on
    // both, so either being wrong leaves the handler attached.
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', added![1]);
    expect(removeWindow).toHaveBeenCalledWith('focus', addedFocus![1]);
    expect(clear).toHaveBeenCalled();
  });

  it('clears the old interval when the cadence changes', () => {
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { rerender } = renderHook(({ every }) => useNow(every), {
      initialProps: { every: 60_000 },
    });
    const before = clear.mock.calls.length;

    rerender({ every: 1_000 });

    // Otherwise a screen that adjusts its cadence accumulates timers, each of
    // them re-rendering it on its own schedule.
    expect(clear.mock.calls.length).toBeGreaterThan(before);
  });

  it('restarts the interval when the cadence changes', () => {
    const { result, rerender } = renderHook(({ every }) => useNow(every), {
      initialProps: { every: 60_000 },
    });

    rerender({ every: 1_000 });
    act(() => vi.advanceTimersByTime(1_000));

    expect(result.current).toEqual(new Date(START.getTime() + 1_000));
  });
});
