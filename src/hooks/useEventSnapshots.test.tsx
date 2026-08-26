/**
 * The property the check-in screen leans on: an equivalent question gets the
 * *same* answer, not a fresh copy of it.
 *
 * The list of history events this hook is asked about is derived from a ticking
 * clock, so its identity changes once a minute while its members do not. The
 * snapshots' identity is what decides whether `buildRoster` reruns and the
 * whole roster repaints — republishing an equal answer repainted two hundred
 * rows a minute for as long as a counselor had the screen open.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateSnapshotCache, useEventSnapshots } from '@/hooks/useEventSnapshots';
import type { TallyEvent } from '@/types';
import { makeEvent } from '../../tests/factories';

const fetchAttendanceByEvent = vi.hoisted(() => vi.fn());

vi.mock('@/services/attendance', () => ({ fetchAttendanceByEvent }));

describe('useEventSnapshots', () => {
  beforeEach(() => {
    invalidateSnapshotCache();
    fetchAttendanceByEvent.mockReset();
    fetchAttendanceByEvent.mockImplementation((ids: string[]) =>
      Promise.resolve({
        byEvent: new Map(
          ids.map((id) => [
            id,
            { present: new Set([`student-of-${id}`]), checkedOut: new Set<string>() },
          ]),
        ),
        denied: new Set<string>(),
      }),
    );
  });

  it('keeps the same answer while the same instances are asked about', async () => {
    const friday = makeEvent({ id: 'evt_1' });
    const sunday = makeEvent({ id: 'evt_2' });

    const { result, rerender } = renderHook(
      ({ events }: { events: TallyEvent[] }) => useEventSnapshots(events),
      { initialProps: { events: [friday, sunday] } },
    );

    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
    const settled = result.current.snapshots;

    // The same instances in a new array — exactly what a clock tick hands over.
    rerender({ events: [friday, sunday] });

    expect(result.current.snapshots).toBe(settled);
    // And no second read either: the cache already holds both nights.
    expect(fetchAttendanceByEvent).toHaveBeenCalledTimes(1);
  });

  it('publishes a new answer when the window actually moves', async () => {
    const friday = makeEvent({ id: 'evt_1' });
    const sunday = makeEvent({ id: 'evt_2' });

    const { result, rerender } = renderHook(
      ({ events }: { events: TallyEvent[] }) => useEventSnapshots(events),
      { initialProps: { events: [friday, sunday] } },
    );

    await waitFor(() => expect(result.current.snapshots).toHaveLength(2));
    const settled = result.current.snapshots;

    rerender({ events: [friday] });

    expect(result.current.snapshots).not.toBe(settled);
    expect(result.current.snapshots).toHaveLength(1);
    expect(result.current.snapshots[0].event).toBe(friday);
  });

  describe('a gathering the reader is not on', () => {
    const denyingSunday = (ids: string[]) =>
      Promise.resolve({
        byEvent: new Map(
          ids
            .filter((id) => id !== 'evt_2')
            .map((id) => [
              id,
              { present: new Set([`student-of-${id}`]), checkedOut: new Set<string>() },
            ]),
        ),
        denied: new Set(ids.filter((id) => id === 'evt_2')),
      });

    it('builds no snapshot for it, and still builds the others', async () => {
      /*
       * The single most important assertion in the feature. A snapshot with an
       * empty `presentStudentIds` is read by `sessionOutcome` as
       * `presumed-cancelled`, which drops the night out of `buildChainHistory`,
       * inflates the dashboard's skipped count, and counts as an absence for
       * every student in `computeMiaByGathering` — a phone call to a family
       * about a gathering the reader was merely not allowed to look at.
       *
       * So: absent, not empty.
       */
      fetchAttendanceByEvent.mockImplementation(denyingSunday);

      const friday = makeEvent({ id: 'evt_1' });
      const sunday = makeEvent({ id: 'evt_2' });

      const { result } = renderHook(
        ({ events }: { events: TallyEvent[] }) => useEventSnapshots(events),
        { initialProps: { events: [friday, sunday] } },
      );

      await waitFor(() => expect(result.current.snapshots).toHaveLength(1));
      expect(result.current.snapshots[0].event).toBe(friday);
      expect(result.current.denied).toEqual(new Set(['evt_2']));
    });

    it('stops asking, because the answer will not change', async () => {
      // A refusal is a settled fact about who the reader is. Nothing is written
      // to the cache for it, so without a memory of its own the hook would
      // re-ask on every render for the rest of the session.
      fetchAttendanceByEvent.mockImplementation(denyingSunday);

      const friday = makeEvent({ id: 'evt_1' });
      const sunday = makeEvent({ id: 'evt_2' });

      const { result, rerender } = renderHook(
        ({ events }: { events: TallyEvent[] }) => useEventSnapshots(events),
        { initialProps: { events: [friday, sunday] } },
      );

      await waitFor(() => expect(result.current.denied.size).toBe(1));
      rerender({ events: [friday, sunday] });

      expect(fetchAttendanceByEvent).toHaveBeenCalledTimes(1);
    });

    it('reports only the refusals this caller asked about', async () => {
      // A screen showing Friday must not be handed a refusal about Sunday it
      // has no way to interpret or explain.
      fetchAttendanceByEvent.mockImplementation(denyingSunday);

      const friday = makeEvent({ id: 'evt_1' });
      const sunday = makeEvent({ id: 'evt_2' });

      const { result, rerender } = renderHook(
        ({ events }: { events: TallyEvent[] }) => useEventSnapshots(events),
        { initialProps: { events: [friday, sunday] } },
      );

      await waitFor(() => expect(result.current.denied.size).toBe(1));
      rerender({ events: [friday] });

      expect(result.current.denied.size).toBe(0);
    });
  });

  it('retries a failed read once, and then leaves it alone', async () => {
    /*
     * This used to be no retries at all, by accident: `version` was bumped only
     * on success and the effect depends on `[key, version]`, so one dropped
     * request wedged the hook for the rest of the session with no path back.
     * On a phone walking into a church hall that is an ordinary event.
     *
     * One, not more — bumping unconditionally is a hot loop against Firestore
     * on a screen nobody is watching.
     */
    fetchAttendanceByEvent.mockRejectedValue(new Error('network request failed'));

    const friday = makeEvent({ id: 'evt_1' });

    const { result } = renderHook(
      ({ events }: { events: TallyEvent[] }) => useEventSnapshots(events),
      { initialProps: { events: [friday] } },
    );

    await waitFor(() => expect(fetchAttendanceByEvent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.error).toBe('network request failed'));

    // Settle, and confirm it stayed settled rather than spinning.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchAttendanceByEvent).toHaveBeenCalledTimes(2);
  });

  it('is not loading when there is nothing to ask about', () => {
    // Every screen with no history to read renders this, and a spinner over an
    // empty list is a screen that never finishes.
    const { result } = renderHook(() => useEventSnapshots([]));

    expect(result.current.loading).toBe(false);
    expect(result.current.snapshots).toEqual([]);
    expect(fetchAttendanceByEvent).not.toHaveBeenCalled();
  });

  it('is loading from the first render when there is', () => {
    const seen: boolean[] = [];
    renderHook(() => {
      const state = useEventSnapshots([makeEvent({ id: 'evt_1' })]);
      seen.push(state.loading);
      return state;
    });

    expect(seen[0]).toBe(true);
  });

  it('settles without asking again when the session already holds the answer', async () => {
    const friday = makeEvent({ id: 'evt_1' });
    const first = renderHook(() => useEventSnapshots([friday]));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const { result } = renderHook(() => useEventSnapshots([friday]));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchAttendanceByEvent).toHaveBeenCalledTimes(1);
    expect(result.current.snapshots).toHaveLength(1);
  });

  it('asks only about the instances it does not hold', async () => {
    const friday = makeEvent({ id: 'evt_1' });
    const sunday = makeEvent({ id: 'evt_2' });
    const first = renderHook(() => useEventSnapshots([friday]));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    renderHook(() => useEventSnapshots([friday, sunday]));

    await waitFor(() => expect(fetchAttendanceByEvent).toHaveBeenCalledTimes(2));
    expect(fetchAttendanceByEvent).toHaveBeenLastCalledWith(['evt_2']);
  });

  it('reads a gathering with nobody checked in as one that did not happen', async () => {
    // The set here is the whole register, so empty really does mean nobody
    // came — which is the reading every window over history depends on.
    fetchAttendanceByEvent.mockResolvedValue({
      byEvent: new Map([['evt_1', { present: new Set<string>(), checkedOut: new Set<string>() }]]),
      denied: new Set<string>(),
    });

    const { result } = renderHook(() => useEventSnapshots([makeEvent({ id: 'evt_1' })]));

    await waitFor(() => expect(result.current.snapshots).toHaveLength(1));
    expect(result.current.snapshots[0]?.held).toBe(false);
  });

  it('reads a gathering with somebody checked in as held', async () => {
    const { result } = renderHook(() => useEventSnapshots([makeEvent({ id: 'evt_1' })]));

    await waitFor(() => expect(result.current.snapshots).toHaveLength(1));
    expect(result.current.snapshots[0]?.held).toBe(true);
  });

  it('keeps who was checked out apart from who was checked in', async () => {
    // A gathering nobody remembered to check out of still happened.
    fetchAttendanceByEvent.mockResolvedValue({
      byEvent: new Map([
        ['evt_1', { present: new Set(['pco_1', 'pco_2']), checkedOut: new Set(['pco_1']) }],
      ]),
      denied: new Set<string>(),
    });

    const { result } = renderHook(() => useEventSnapshots([makeEvent({ id: 'evt_1' })]));

    await waitFor(() => expect(result.current.snapshots).toHaveLength(1));
    expect([...(result.current.snapshots[0]?.presentStudentIds ?? [])]).toEqual(['pco_1', 'pco_2']);
    expect([...(result.current.snapshots[0]?.checkedOutStudentIds ?? [])]).toEqual(['pco_1']);
  });

  it('hands back the same empty set of refusals on every screen that has none', async () => {
    const friday = makeEvent({ id: 'evt_1' });
    const first = renderHook(() => useEventSnapshots([friday]));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    const second = renderHook(() => useEventSnapshots([makeEvent({ id: 'evt_2' })]));
    await waitFor(() => expect(second.result.current.loading).toBe(false));

    expect(first.result.current.denied).toBe(second.result.current.denied);
  });

  it('reports the failure and stops loading', async () => {
    fetchAttendanceByEvent.mockRejectedValue(new Error('unavailable'));

    const { result } = renderHook(() => useEventSnapshots([makeEvent({ id: 'evt_1' })]));

    await waitFor(() => expect(result.current.error).toBe('unavailable'));
    expect(result.current.loading).toBe(false);
  });

  it('clears the failure once the one retry lands', async () => {
    // One dropped request is ordinary on a phone walking into a church hall,
    // and the retry is what stops that wedging the hook for the session.
    fetchAttendanceByEvent.mockRejectedValueOnce(new Error('unavailable'));

    const { result } = renderHook(() => useEventSnapshots([makeEvent({ id: 'evt_1' })]));

    await waitFor(() => expect(result.current.snapshots).toHaveLength(1));
    expect(fetchAttendanceByEvent).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('forgets one gathering without forgetting the rest', async () => {
    const friday = makeEvent({ id: 'evt_1' });
    const sunday = makeEvent({ id: 'evt_2' });
    const first = renderHook(() => useEventSnapshots([friday, sunday]));
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    invalidateSnapshotCache('evt_1');
    renderHook(() => useEventSnapshots([friday, sunday]));

    await waitFor(() => expect(fetchAttendanceByEvent).toHaveBeenCalledTimes(2));
    expect(fetchAttendanceByEvent).toHaveBeenLastCalledWith(['evt_1']);
  });

  it('forgets a refusal when the one thing that changes it happens', async () => {
    // Somebody adding you to the gathering; the access stream firing is what
    // clears it.
    fetchAttendanceByEvent.mockResolvedValueOnce({
      byEvent: new Map(),
      denied: new Set(['evt_1']),
    });
    const friday = makeEvent({ id: 'evt_1' });
    const first = renderHook(() => useEventSnapshots([friday]));
    await waitFor(() => expect(first.result.current.denied.has('evt_1')).toBe(true));

    invalidateSnapshotCache('evt_1');
    const second = renderHook(() => useEventSnapshots([friday]));

    await waitFor(() => expect(second.result.current.snapshots).toHaveLength(1));
    expect(second.result.current.denied.has('evt_1')).toBe(false);
  });
});
