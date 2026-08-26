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

  it('restarts the interval when the cadence changes', () => {
    const { result, rerender } = renderHook(({ every }) => useNow(every), {
      initialProps: { every: 60_000 },
    });

    rerender({ every: 1_000 });
    act(() => vi.advanceTimersByTime(1_000));

    expect(result.current).toEqual(new Date(START.getTime() + 1_000));
  });
});
