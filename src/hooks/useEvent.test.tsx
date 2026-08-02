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
import { renderHook, waitFor } from '@testing-library/react';
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

function wrapper(events: TallyEvent[], loading = false) {
  const value = {
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
    refreshRoster: vi.fn(async () => {}),
  } as unknown as DataContextValue;

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
