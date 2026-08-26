/**
 * Paging back through a ministry's history without showing a night twice.
 *
 * Three separate things here have each caused a duplicate row, and each one is
 * pinned below: a page that arrives twice (React's development double-effect
 * does exactly that on first render), a cursor that moves after a failure, and
 * a `before` boundary derived from a ticking clock that creeps forward between
 * pages until a gathering slips past it from the other side.
 *
 * `fetchPastEvents` is mocked at the service boundary — this is a hook about
 * paging, and the query it builds has its own tests.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePastEvents } from '@/hooks/usePastEvents';
import { makeEvent } from '../../tests/factories';
import type { TallyEvent } from '@/types';

const fetchPastEvents = vi.hoisted(() => vi.fn());

vi.mock('@/services/events', () => ({
  fetchPastEvents,
  PAST_EVENTS_PAGE_SIZE: 12,
}));

const BOUNDARY = new Date('2026-02-13T19:00:00');

function page(events: TallyEvent[], hasMore: boolean) {
  return { events, cursor: hasMore ? ({ id: events.at(-1)?.id } as never) : null, hasMore };
}

function nights(...ids: string[]): TallyEvent[] {
  return ids.map((id) => makeEvent({ id, title: id }));
}

beforeEach(() => {
  fetchPastEvents.mockReset();
});

describe('usePastEvents', () => {
  it('reads the first page on mount and settles', async () => {
    fetchPastEvents.mockResolvedValue(page(nights('a', 'b'), false));

    const { result } = renderHook(() => usePastEvents(BOUNDARY, 2));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.events.map((event) => event.id)).toEqual(['a', 'b']);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
    expect(fetchPastEvents).toHaveBeenCalledWith(BOUNDARY, null, 2);
  });

  it('appends the next page behind the first', async () => {
    fetchPastEvents
      .mockResolvedValueOnce(page(nights('a', 'b'), true))
      .mockResolvedValueOnce(page(nights('c'), false));

    const { result } = renderHook(() => usePastEvents(BOUNDARY, 2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.loadMore();
    });

    expect(result.current.events.map((event) => event.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.hasMore).toBe(false);
    // The cursor from the first page, not a fresh read from the top.
    expect(fetchPastEvents).toHaveBeenLastCalledWith(BOUNDARY, { id: 'b' }, 2);
  });

  it('drops a night it is already holding', async () => {
    // Firestore's cursor is exact, but a page can still arrive twice — React
    // 18's development double-effect does it on the first render alone, and a
    // duplicate key is a warning followed by two identical rows.
    fetchPastEvents
      .mockResolvedValueOnce(page(nights('a', 'b'), true))
      .mockResolvedValueOnce(page(nights('b', 'c'), false));

    const { result } = renderHook(() => usePastEvents(BOUNDARY, 2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.loadMore();
    });

    expect(result.current.events.map((event) => event.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores loadMore once the collection is exhausted', async () => {
    fetchPastEvents.mockResolvedValue(page(nights('a'), false));

    const { result } = renderHook(() => usePastEvents(BOUNDARY, 2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.loadMore();
    });

    expect(fetchPastEvents).toHaveBeenCalledTimes(1);
  });

  it('reports a failed page and stops asking', async () => {
    fetchPastEvents.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => usePastEvents(BOUNDARY, 2));
    await waitFor(() => expect(result.current.error).toBe('Could not load older gatherings.'));

    expect(result.current.loading).toBe(false);

    // A sentinel scrolling into view must not spin on a failure.
    await act(async () => {
      result.current.loadMore();
    });
    expect(fetchPastEvents).toHaveBeenCalledTimes(1);
  });

  it('retries the page that failed rather than skipping it', async () => {
    fetchPastEvents
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page(nights('a'), false));

    const { result } = renderHook(() => usePastEvents(BOUNDARY, 2));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      result.current.retry();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.events.map((event) => event.id)).toEqual(['a']);
    // The cursor was left where it was, so the same page is asked for again.
    expect(fetchPastEvents).toHaveBeenLastCalledWith(BOUNDARY, null, 2);
  });

  it('holds the boundary still while the pages last', async () => {
    // `before` comes from a ticking clock. A bound that crept forward between
    // pages would eventually hand back a gathering that had slipped into the
    // past underneath one already on screen.
    fetchPastEvents
      .mockResolvedValueOnce(page(nights('a'), true))
      .mockResolvedValueOnce(page(nights('b'), false));

    const { result, rerender } = renderHook(({ before }) => usePastEvents(before, 2), {
      initialProps: { before: BOUNDARY },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ before: new Date('2026-02-13T19:05:00') });
    await act(async () => {
      result.current.loadMore();
    });

    expect(fetchPastEvents).toHaveBeenLastCalledWith(BOUNDARY, { id: 'a' }, 2);
  });

  it('picks up the caller latest boundary when it starts over', async () => {
    const later = new Date('2026-02-13T19:05:00');
    fetchPastEvents
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page(nights('a'), false));

    const { result, rerender } = renderHook(({ before }) => usePastEvents(before, 2), {
      initialProps: { before: BOUNDARY },
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    rerender({ before: later });
    await act(async () => {
      result.current.retry();
    });

    // A retry after a failure resumes rather than resets, so the boundary it
    // was reading against is the one it keeps.
    expect(fetchPastEvents).toHaveBeenLastCalledWith(BOUNDARY, null, 2);
  });

  it('starts over from the top when the page size changes', async () => {
    fetchPastEvents.mockResolvedValue(page(nights('a'), true));

    const { result, rerender } = renderHook(({ size }) => usePastEvents(BOUNDARY, size), {
      initialProps: { size: 2 },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    fetchPastEvents.mockResolvedValue(page(nights('x', 'y', 'z'), false));
    rerender({ size: 3 });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchPastEvents).toHaveBeenLastCalledWith(BOUNDARY, null, 3);
    expect(result.current.events.map((event) => event.id)).toEqual(['x', 'y', 'z']);
  });

  it('refuses a second read while one is in flight', async () => {
    let release: (value: unknown) => void = () => {};
    fetchPastEvents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const { result } = renderHook(() => usePastEvents(BOUNDARY, 2));

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    expect(fetchPastEvents).toHaveBeenCalledTimes(1);

    await act(async () => {
      release(page(nights('a'), false));
    });
    expect(result.current.events.map((event) => event.id)).toEqual(['a']);
  });

  it('is loading from the very first render, before anything is in flight', async () => {
    // The list renders skeletons off this flag. Starting at `false` shows an
    // empty history for one frame, which reads as "this ministry has no past".
    fetchPastEvents.mockResolvedValue(page(nights('a'), false));
    const seen: boolean[] = [];

    const { result } = renderHook(() => {
      const state = usePastEvents(BOUNDARY, 2);
      seen.push(state.loading);
      return state;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(seen[0]).toBe(true);
  });

  it('still offers more after the first page fails', async () => {
    // Nothing has been read, so nothing is known to be exhausted — and a
    // history that says "that is everything" over an error is a lie.
    fetchPastEvents.mockRejectedValueOnce(new Error('offline'));

    const { result } = renderHook(() => usePastEvents(BOUNDARY, 2));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.hasMore).toBe(true);
  });

  it('clears a failure when a page lands without anybody pressing retry', async () => {
    // The boundary moving is enough to start over, and a stale error sitting
    // over a list that has just refilled is the banner nobody believes.
    fetchPastEvents.mockRejectedValueOnce(new Error('offline'));

    const { result, rerender } = renderHook(({ size }) => usePastEvents(BOUNDARY, size), {
      initialProps: { size: 2 },
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    fetchPastEvents.mockResolvedValueOnce(page(nights('a'), false));
    rerender({ size: 3 });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
  });

  it('takes the error down the moment retry is pressed, not when the page lands', async () => {
    // Otherwise the button sits under its own failure for the length of a
    // round trip and reads as not having done anything.
    let release: (value: unknown) => void = () => {};
    fetchPastEvents
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );

    const { result } = renderHook(() => usePastEvents(BOUNDARY, 2));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.retry());
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      release(page(nights('a'), false));
    });
  });

  it('reads from the caller latest boundary when it starts over', async () => {
    const later = new Date('2026-02-13T19:05:00');
    fetchPastEvents.mockResolvedValue(page(nights('a'), true));

    const { result, rerender } = renderHook(
      ({ before, size }) => usePastEvents(before, size),
      { initialProps: { before: BOUNDARY, size: 2 } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ before: later, size: 3 });
    await waitFor(() => expect(fetchPastEvents).toHaveBeenCalledTimes(2));

    expect(fetchPastEvents).toHaveBeenLastCalledWith(later, null, 3);
  });

  it('retries with the page size in force now', async () => {
    fetchPastEvents.mockRejectedValue(new Error('offline'));

    const { result, rerender } = renderHook(({ size }) => usePastEvents(BOUNDARY, size), {
      initialProps: { size: 2 },
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    rerender({ size: 3 });
    await waitFor(() => expect(fetchPastEvents).toHaveBeenCalledTimes(2));

    await act(async () => {
      result.current.retry();
    });

    expect(fetchPastEvents).toHaveBeenLastCalledWith(BOUNDARY, null, 3);
  });

  it('defaults to the service page size when the caller does not say', async () => {
    fetchPastEvents.mockResolvedValue(page(nights('a'), false));

    const { result } = renderHook(() => usePastEvents(BOUNDARY));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetchPastEvents).toHaveBeenCalledWith(BOUNDARY, null, 12);
  });
});
