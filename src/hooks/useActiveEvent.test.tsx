/**
 * Which gathering a counselor is checking into, and which nights predict it.
 *
 * Two claims, and both are about *not* deciding things. The choice of event is
 * the URL and nothing else — Tally used to make it from the clock, and on a
 * night with two gatherings on, forty students could be filed against the wrong
 * one before anybody noticed. And the history behind it is the chain the event
 * predicts from, which for a one-off is whatever a leader pointed it at and for
 * a trip pointed at nothing is nothing at all.
 *
 * The third claim is about identity, not values: this array's identity decides
 * whether the whole check-in roster rebuilds, and the clock ticks under it once
 * a minute. Handing back an equal-but-new array once a minute repainted the
 * screen for the entire time it was open.
 */
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataContext, type DataContextValue } from '@/context/dataContext';
import { useActiveEvent, useSeriesHistoryEvents } from '@/hooks/useActiveEvent';
import { makeEvent, makeSettings } from '../../tests/factories';
import type { TallyEvent } from '@/types';

const useEvent = vi.hoisted(() => vi.fn());
const useNow = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useEvent', () => ({ useEvent }));
vi.mock('@/hooks/useNow', () => ({ useNow }));

/** Friday 13 February 2026, 19:30 — mid-gathering. */
const NOW = new Date(2026, 1, 13, 19, 30);

function wrapper(events: TallyEvent[], settings = makeSettings()) {
  const value = {
    students: [],
    events,
    series: [],
    settings,
    loading: false,
    error: null,
  } as unknown as DataContextValue;

  return function Wrapper({ children }: { children: ReactNode }) {
    return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
  };
}

/** A past instance of the Friday chain, `days` before NOW and already closed. */
function pastFriday(id: string, days: number): TallyEvent {
  const startAt = new Date(NOW.getTime() - days * 86_400_000);
  return makeEvent({
    id,
    seriesId: 'friday-fellowship',
    startAt,
    endAt: new Date(startAt.getTime() + 2 * 3_600_000),
    checkInOpensAt: new Date(startAt.getTime() - 3_600_000),
    checkInClosesAt: new Date(startAt.getTime() + 3 * 3_600_000),
  });
}

beforeEach(() => {
  useNow.mockReturnValue(NOW);
  useEvent.mockReturnValue({ event: null, loading: false, fromArchive: false });
});

describe('useActiveEvent', () => {
  it('resolves the event the URL names and passes the id straight through', () => {
    const tonight = pastFriday('tonight', 0);
    useEvent.mockReturnValue({ event: tonight, loading: false, fromArchive: false });

    const { result } = renderHook(() => useActiveEvent('tonight'), {
      wrapper: wrapper([tonight]),
    });

    expect(useEvent).toHaveBeenCalledWith('tonight');
    expect(result.current.event).toBe(tonight);
    expect(result.current.eventLoading).toBe(false);
    expect(result.current.fromArchive).toBe(false);
    expect(result.current.now).toBe(NOW);
  });

  it('carries the loading and archive flags out of useEvent unchanged', () => {
    useEvent.mockReturnValue({ event: null, loading: true, fromArchive: true });

    const { result } = renderHook(() => useActiveEvent('older-night'), {
      wrapper: wrapper([]),
    });

    expect(result.current.eventLoading).toBe(true);
    expect(result.current.fromArchive).toBe(true);
  });

  it('names the gathering whose window is open without selecting it', () => {
    // `liveEvent` puts the live gathering at the top of the chooser with a ring
    // around it. It decides nothing on the counselor's behalf.
    const live = pastFriday('live', 0);
    const other = pastFriday('other', 7);

    const { result } = renderHook(() => useActiveEvent(null), {
      wrapper: wrapper([live, other]),
    });

    expect(result.current.liveEvent).toBe(live);
    expect(result.current.event).toBeNull();
  });

  it('offers the last month plus everything ahead, newest first', () => {
    const recent = pastFriday('recent', 7);
    const older = pastFriday('older', 40);
    const ahead = makeEvent({ id: 'ahead', startAt: new Date(NOW.getTime() + 86_400_000) });

    const { result } = renderHook(() => useActiveEvent(null), {
      wrapper: wrapper([older, recent, ahead]),
    });

    expect(result.current.selectableEvents.map((event) => event.id)).toEqual(['ahead', 'recent']);
  });

  it('keeps a gathering exactly a month old and drops one a day past that', () => {
    // The boundary is 31 days, and it is the difference between back-filling a
    // missed Sunday and scrolling through a year.
    const inside = pastFriday('inside', 30);
    const outside = pastFriday('outside', 32);

    const { result } = renderHook(() => useActiveEvent(null), {
      wrapper: wrapper([inside, outside]),
    });

    expect(result.current.selectableEvents.map((event) => event.id)).toEqual(['inside']);
  });

  it('never offers a gathering somebody called off', () => {
    const cancelled = makeEvent({ id: 'cancelled', status: 'cancelled', startAt: NOW });

    const { result } = renderHook(() => useActiveEvent(null), {
      wrapper: wrapper([cancelled]),
    });

    expect(result.current.selectableEvents).toEqual([]);
    expect(result.current.liveEvent).toBeNull();
  });
});

describe('useSeriesHistoryEvents', () => {
  it('reads the chain a recurring gathering belongs to', () => {
    const tonight = pastFriday('tonight', 0);
    const lastWeek = pastFriday('last-week', 7);
    const fortnightAgo = pastFriday('fortnight', 14);

    const { result } = renderHook(() => useSeriesHistoryEvents(tonight), {
      wrapper: wrapper([tonight, lastWeek, fortnightAgo]),
    });

    expect(result.current.map((event) => event.id)).toEqual(['last-week', 'fortnight']);
  });

  it('leaves the gathering being checked into out of its own history', () => {
    const tonight = pastFriday('tonight', 1);

    const { result } = renderHook(() => useSeriesHistoryEvents(tonight), {
      wrapper: wrapper([tonight]),
    });

    expect(result.current).toEqual([]);
  });

  it('reads nothing at all for an event that is null', () => {
    const { result } = renderHook(() => useSeriesHistoryEvents(null), {
      wrapper: wrapper([pastFriday('last-week', 7)]),
    });

    expect(result.current).toEqual([]);
  });

  it('reads nothing for a trip pointed at no gathering', () => {
    // A retreat is not evidence about who turns up to a retreat.
    const trip = makeEvent({
      id: 'retreat',
      mode: 'oneoff',
      seriesId: null,
      recurrenceRootId: null,
      predictFromChain: null,
      startAt: NOW,
    });

    const { result } = renderHook(() => useSeriesHistoryEvents(trip), {
      wrapper: wrapper([trip, pastFriday('last-week', 7)]),
    });

    expect(result.current).toEqual([]);
  });

  it('reads the chain a trip was pointed at', () => {
    const trip = makeEvent({
      id: 'retreat',
      mode: 'oneoff',
      seriesId: null,
      recurrenceRootId: null,
      predictFromChain: 'friday-fellowship',
      startAt: NOW,
    });
    const lastWeek = pastFriday('last-week', 7);

    const { result } = renderHook(() => useSeriesHistoryEvents(trip), {
      wrapper: wrapper([trip, lastWeek]),
    });

    expect(result.current.map((event) => event.id)).toEqual(['last-week']);
  });

  it('hands back the same array when the clock ticks and nothing else moves', () => {
    // This identity is what decides whether the check-in screen rebuilds its
    // whole roster. A new array for the same nights repainted it once a minute.
    const tonight = pastFriday('tonight', 0);
    const lastWeek = pastFriday('last-week', 7);
    const events = [tonight, lastWeek];

    const { result, rerender } = renderHook(() => useSeriesHistoryEvents(tonight), {
      wrapper: wrapper(events),
    });
    const first = result.current;

    useNow.mockReturnValue(new Date(NOW.getTime() + 60_000));
    rerender();

    expect(result.current).toBe(first);
  });

  it('hands back the same empty array for every event with no chain', () => {
    const trip = makeEvent({ id: 'retreat', mode: 'oneoff', predictFromChain: null });
    const other = makeEvent({ id: 'other-trip', mode: 'oneoff', predictFromChain: null });

    const { result, rerender } = renderHook(({ event }) => useSeriesHistoryEvents(event), {
      wrapper: wrapper([]),
      initialProps: { event: trip },
    });
    const first = result.current;

    rerender({ event: other });

    expect(result.current).toBe(first);
  });

  it('reads deeper than the prediction window so a cancelled night costs nothing', () => {
    // `buildSeriesHistory` drops nights that never happened and only then takes
    // the most recent `ofLastN`, so the read has to reach further back than the
    // rule does — twelve instances, or the setting plus two, whichever is more.
    const tonight = pastFriday('tonight', 0);
    const history = Array.from({ length: 14 }, (_, index) =>
      pastFriday(`past-${index}`, index + 1),
    );

    const { result } = renderHook(() => useSeriesHistoryEvents(tonight), {
      wrapper: wrapper([tonight, ...history], makeSettings({ predictiveOfLastN: 3 })),
    });

    expect(result.current).toHaveLength(12);
  });

  it('follows a larger prediction window past the twelve-instance floor', () => {
    const tonight = pastFriday('tonight', 0);
    const history = Array.from({ length: 20 }, (_, index) =>
      pastFriday(`past-${index}`, index + 1),
    );

    const { result } = renderHook(() => useSeriesHistoryEvents(tonight), {
      wrapper: wrapper([tonight, ...history], makeSettings({ predictiveOfLastN: 15 })),
    });

    // Fifteen wanted, plus two spare for nights that did not happen.
    expect(result.current).toHaveLength(17);
  });
});
