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
});
