/**
 * Resolving a gathering by id, on both sides of the loaded window.
 *
 * The bug this pins: the Events tab pages the whole past out of Firestore, so
 * it lists nights far older than the calendar `DataProvider` holds — and every
 * link down there resolved its id by scanning that calendar, so following one
 * landed on the chooser as though the tap had been swallowed. Importing years
 * of Check-Ins history turned that from unreachable into the common case.
 */
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { useEvent } from '@/hooks/useEvent';
import { makeEvent, makeSettings } from '../../tests/factories';
import type { TallyEvent } from '@/types';

const subscribeEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({
  USE_EMULATORS: false,
  firebaseApp: {},
  db: {},
  auth: {},
  popupRedirectResolver: vi.fn(),
}));
vi.mock('@/services/events', () => ({ subscribeEvent }));

/** A night inside the window, and one two years older that is not. */
const LOADED = makeEvent({ id: 'loaded-night', title: 'Footprints' });
const ARCHIVED = makeEvent({
  id: 'pco-checkins-698430-2024-03-22',
  title: 'Footprints',
  startAt: new Date('2024-03-23T02:30:00Z'),
});

function contextValue(events: TallyEvent[], loading = false): DataContextValue {
  return {
    students: [],
    events,
    series: [],
    settings: makeSettings(),
    loading,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: null,
    rosterBackends: [],
    refreshRoster: vi.fn(async () => {}),
  } as unknown as DataContextValue;
}

function wrapper(events: TallyEvent[], loading = false) {
  const value = contextValue(events, loading);

  return function Wrapper({ children }: { children: ReactNode }) {
    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
  };
}

describe('useEvent', () => {
  it('takes a loaded night from the calendar without reading anything', () => {
    const { result } = renderHook(() => useEvent('loaded-night'), {
      wrapper: wrapper([LOADED]),
    });

    expect(result.current.event).toBe(LOADED);
    expect(result.current.fromArchive).toBe(false);
    // The calendar is already open; paying for a second listener on a document
    // it is streaming anyway is waste on every phone in the building.
    expect(subscribeEvent).not.toHaveBeenCalled();
  });

  it('reads a night older than the window by name', async () => {
    subscribeEvent.mockImplementation((_id: string, onChange: (e: TallyEvent) => void) => {
      onChange(ARCHIVED);
      return () => {};
    });

    const { result } = renderHook(() => useEvent(ARCHIVED.id), { wrapper: wrapper([LOADED]) });

    await waitFor(() => expect(result.current.event).toBe(ARCHIVED));
    // The flag is what the check-in screen reads to know it cannot predict
    // anything about this night and must show it as a record.
    expect(result.current.fromArchive).toBe(true);
    expect(subscribeEvent).toHaveBeenCalledWith(ARCHIVED.id, expect.any(Function), expect.any(Function));
  });

  it('waits for the calendar before reading, so an arriving night costs nothing', () => {
    renderHook(() => useEvent(ARCHIVED.id), { wrapper: wrapper([], true) });

    // It may be in the window that is still streaming in. Opening a listener
    // for something already on its way is a read nobody needed.
    expect(subscribeEvent).not.toHaveBeenCalled();
  });

  it('reports a night that is genuinely gone as missing, not as loading', async () => {
    subscribeEvent.mockImplementation((_id: string, onChange: (e: TallyEvent | null) => void) => {
      onChange(null);
      return () => {};
    });

    const { result } = renderHook(() => useEvent('deleted-night'), { wrapper: wrapper([LOADED]) });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.event).toBeNull();
    expect(result.current.fromArchive).toBe(false);
  });

  it('treats a refused read the same way, so the screen says "not here"', async () => {
    subscribeEvent.mockImplementation(
      (_id: string, _onChange: unknown, onError: (e: Error) => void) => {
        onError(new Error('permission-denied'));
        return () => {};
      },
    );

    const { result } = renderHook(() => useEvent('forbidden-night'), {
      wrapper: wrapper([LOADED]),
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.event).toBeNull();
  });
});

describe('useEvent, between one night and the next', () => {
  /** Every render's answer, so the frame after a change is visible to a test. */
  function record(initial: string | null) {
    const seen: ReturnType<typeof useEvent>[] = [];
    const rendered = renderHook(
      ({ id }: { id: string | null }) => {
        const resolved = useEvent(id);
        seen.push(resolved);
        return resolved;
      },
      { wrapper: wrapper([LOADED]), initialProps: { id: initial } },
    );
    return { ...rendered, seen };
  }

  it('never says a night is missing before it has looked', () => {
    // Arriving at an archived night from a loaded calendar. This drew "no such
    // gathering" for a frame, which is the exact failure the fallback exists to
    // stop — a tap that reads as the app losing it.
    subscribeEvent.mockImplementation(() => () => {});

    const { seen } = record(ARCHIVED.id);

    expect(seen[0]?.loading).toBe(true);
    expect(seen.every((answer) => answer.loading || answer.event !== null)).toBe(true);
  });

  it('never shows the last night under this night’s id', async () => {
    // Tapping from one archived night straight to another. The effect that
    // cleared the previous answer ran after the render that changed the id, so
    // one frame drew the first night's title under the second night's URL.
    const OTHER = makeEvent({ id: 'pco-checkins-698430-2023-05-05', title: 'Older still' });
    subscribeEvent.mockImplementation((id: string, onChange: (e: TallyEvent) => void) => {
      onChange(id === ARCHIVED.id ? ARCHIVED : OTHER);
      return () => {};
    });

    const { result, rerender, seen } = record(ARCHIVED.id);
    await waitFor(() => expect(result.current.event).toBe(ARCHIVED));

    const before = seen.length;
    rerender({ id: OTHER.id });

    for (const answer of seen.slice(before)) {
      expect(answer.event === null || answer.event === OTHER).toBe(true);
    }
    expect(result.current.event).toBe(OTHER);
  });

  it('is not loading at all when there is no id to resolve', () => {
    // Even while the calendar is still arriving: there is nothing to wait for.
    const { result } = renderHook(() => useEvent(null), { wrapper: wrapper([], true) });

    expect(result.current).toEqual({ event: null, loading: false, fromArchive: false });
  });

  it('is not loading for a night the calendar already holds', () => {
    // The calendar can still be settling while the night in question is
    // already in it, and a screen that has its gathering should draw it.
    const { result } = renderHook(() => useEvent('loaded-night'), {
      wrapper: wrapper([LOADED], true),
    });

    expect(result.current.event).toBe(LOADED);
    expect(result.current.loading).toBe(false);
  });

  it('is loading while the calendar is still arriving', () => {
    const { result } = renderHook(() => useEvent(ARCHIVED.id), { wrapper: wrapper([], true) });

    expect(result.current.loading).toBe(true);
  });

  it('closes the listener when the id changes, and opens one for the new id', async () => {
    const stop = vi.fn();
    subscribeEvent.mockImplementation((_id: string, onChange: (e: TallyEvent) => void) => {
      onChange(ARCHIVED);
      return stop;
    });

    const { result, rerender } = renderHook(({ id }: { id: string }) => useEvent(id), {
      wrapper: wrapper([LOADED]),
      initialProps: { id: ARCHIVED.id },
    });
    await waitFor(() => expect(result.current.event).toBe(ARCHIVED));

    rerender({ id: 'another-night' });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(subscribeEvent).toHaveBeenLastCalledWith(
      'another-night',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('closes the listener on unmount', () => {
    const stop = vi.fn();
    subscribeEvent.mockImplementation(() => stop);

    const { unmount } = renderHook(() => useEvent(ARCHIVED.id), { wrapper: wrapper([LOADED]) });
    unmount();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('ignores a snapshot that arrives after the id moved on', async () => {
    // A slow listener for a night nobody is looking at any more must not
    // overwrite the one they are.
    let deliver: (event: TallyEvent | null) => void = () => {};
    subscribeEvent.mockImplementation((id: string, onChange: (e: TallyEvent | null) => void) => {
      if (id === ARCHIVED.id) deliver = onChange;
      return () => {};
    });

    const { result, rerender } = renderHook(({ id }: { id: string }) => useEvent(id), {
      wrapper: wrapper([LOADED]),
      initialProps: { id: ARCHIVED.id },
    });

    rerender({ id: 'another-night' });
    act(() => deliver(ARCHIVED));

    expect(result.current.event).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it('ignores a failure that arrives after the id moved on', async () => {
    let fail: () => void = () => {};
    subscribeEvent.mockImplementation(
      (id: string, _onChange: unknown, onError: () => void) => {
        if (id === ARCHIVED.id) fail = onError;
        return () => {};
      },
    );

    const { result, rerender } = renderHook(({ id }: { id: string }) => useEvent(id), {
      wrapper: wrapper([LOADED]),
      initialProps: { id: ARCHIVED.id },
    });

    rerender({ id: 'another-night' });
    act(() => fail());

    // Still waiting on the *new* night, not answered by the old one's failure.
    expect(result.current.loading).toBe(true);
  });

  it('closes the read the moment the calendar catches up with the night', () => {
    // The window can widen underneath a screen — a page of history landing, or
    // a projection tick. Once the night is in the calendar the second listener
    // is waste, and the answer has to come from the calendar rather than from
    // whichever read happened to run first.
    const stop = vi.fn();
    subscribeEvent.mockImplementation(() => stop);

    let calendar: TallyEvent[] = [LOADED];
    function Wrapper({ children }: { children: ReactNode }) {
      return <DataContext.Provider value={contextValue(calendar)}>{children}</DataContext.Provider>;
    }

    const { result, rerender } = renderHook(() => useEvent(ARCHIVED.id), { wrapper: Wrapper });
    expect(subscribeEvent).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    calendar = [LOADED, ARCHIVED];
    rerender();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.event).toBe(ARCHIVED);
    // From the calendar, so a screen may predict from the nights around it.
    expect(result.current.fromArchive).toBe(false);
    expect(result.current.loading).toBe(false);
  });
});
