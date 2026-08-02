import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAttendanceByEvent } from '@/services/attendance';
import type { EventAttendanceSnapshot, TallyEvent } from '@/types';

/**
 * Attendance history is read once, not streamed.
 *
 * A Friday from three weeks ago will not change while a counselor is standing
 * at the door, so paying for a live listener per past event would be waste. The
 * results are memoised for the session because the predictive roster and the
 * dashboard ask for overlapping windows.
 */
const cache = new Map<string, ReadonlySet<string>>();

/** Drops cached history — call after editing attendance for a past event. */
export function invalidateSnapshotCache(eventId?: string): void {
  if (eventId) cache.delete(eventId);
  else cache.clear();
}

export interface EventSnapshotsResult {
  snapshots: EventAttendanceSnapshot[];
  loading: boolean;
  error: string | null;
}

/**
 * Loads "who attended" for each of `events`.
 *
 * Callers pass an already-narrowed list (one series' recent instances, or the
 * dashboard's recent recurring window) — this hook does no selection of its own.
 */
export function useEventSnapshots(events: readonly TallyEvent[]): EventSnapshotsResult {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(events.length > 0);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<string>('');

  // Identity of the request, so re-renders with an equivalent list do not refetch.
  const key = useMemo(
    () =>
      events
        .map((event) => event.id)
        .sort()
        .join(','),
    [events],
  );

  useEffect(() => {
    if (events.length === 0) {
      setLoading(false);
      setError(null);
      return;
    }

    const missing = events.map((event) => event.id).filter((id) => !cache.has(id));
    if (missing.length === 0) {
      setLoading(false);
      return;
    }

    if (inFlight.current === key) return;
    inFlight.current = key;

    let cancelled = false;
    setLoading(true);

    fetchAttendanceByEvent(missing)
      .then((result) => {
        if (cancelled) return;
        for (const [eventId, ids] of result) cache.set(eventId, ids);
        setError(null);
        setVersion((current) => current + 1);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (cancelled) return;
        inFlight.current = '';
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `key` is the stable identity of `events`; `version` re-runs after a cache fill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);

  /*
   * The previous answer, handed back whenever the new one says the same thing.
   *
   * `events` is in the dependency list because the snapshots wrap its members,
   * but several callers derive that array from a ticking clock, so its identity
   * can change while its contents do not — and each entry here is a fresh
   * wrapper object either way. Republishing an equivalent list makes every
   * consumer recompute: the check-in screen rebuilds its entire roster from it.
   */
  const last = useRef<EventAttendanceSnapshot[]>([]);

  const snapshots = useMemo(() => {
    const next = events
      .map((event) => ({ event, presentStudentIds: cache.get(event.id) }))
      .filter(
        (entry): entry is { event: TallyEvent; presentStudentIds: ReadonlySet<string> } =>
          entry.presentStudentIds !== undefined,
      )
      // This hook reads whole registers, so the set is the register and an empty
      // one really does mean nobody came.
      .map<EventAttendanceSnapshot>((entry) => ({ ...entry, held: entry.presentStudentIds.size > 0 }));

    const unchanged =
      next.length === last.current.length &&
      next.every(
        (entry, index) =>
          entry.event === last.current[index].event &&
          entry.presentStudentIds === last.current[index].presentStudentIds,
      );

    if (!unchanged) last.current = next;
    return last.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, events]);

  return { snapshots, loading, error };
}
