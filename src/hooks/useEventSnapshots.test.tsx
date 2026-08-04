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
      Promise.resolve(
        new Map(
          ids.map((id) => [
            id,
            { present: new Set([`student-of-${id}`]), checkedOut: new Set<string>() },
          ]),
        ),
      ),
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
});
