import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAttendanceByEvent, type EventAttendanceIds } from '@/services/attendance';
import type { EventAttendanceSnapshot, TallyEvent } from '@/types';

/**
 * Attendance history is read once, not streamed.
 *
 * A Friday from three weeks ago will not change while a counselor is standing
 * at the door, so paying for a live listener per past event would be waste. The
 * results are memoised for the session because the predictive roster and the
 * dashboard ask for overlapping windows.
 */
const cache = new Map<string, EventAttendanceIds>();

/**
 * Events this session has been refused, so it stops asking.
 *
 * Beside the cache rather than in it, because the two answer different
 * questions and must never be confused: `cache` holds registers, this holds the
 * absence of permission to have one. A refusal is a settled fact about who the
 * reader is — unlike a network failure, asking again produces the same answer,
 * and asking again on every render produces it forever.
 *
 * Cleared with the cache: the one thing that changes a refusal is somebody
 * adding you to the gathering, and the access stream firing is what clears it.
 */
const refused = new Set<string>();

/** Drops cached history — call after editing attendance for a past event. */
export function invalidateSnapshotCache(eventId?: string): void {
  if (eventId) {
    cache.delete(eventId);
    refused.delete(eventId);
  } else {
    cache.clear();
    refused.clear();
  }
}

export interface EventSnapshotsResult {
  snapshots: EventAttendanceSnapshot[];
  /**
   * The events in `events` whose registers the reader may not see.
   *
   * Callers must not treat these as gatherings with nobody at them. There is no
   * entry in `snapshots` for any of them — deliberately, because an
   * `EventAttendanceSnapshot` with an empty `presentStudentIds` is a claim that
   * nobody came, and every derivation downstream believes it.
   */
  denied: ReadonlySet<string>;
  loading: boolean;
  error: string | null;
}

/** Shared so a caller with nothing to ask for does not allocate a new one. */
const NO_DENIALS: ReadonlySet<string> = new Set<string>();

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
  /** The request that already spent its one retry. See the catch below. */
  const failedKey = useRef<string>('');

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

    const missing = events
      .map((event) => event.id)
      .filter((id) => !cache.has(id) && !refused.has(id));
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
        for (const [eventId, ids] of result.byEvent) cache.set(eventId, ids);
        // Remembered so the next render does not ask again. Nothing is written
        // to `cache` for these: an absent register and an empty one must not
        // become the same thing.
        for (const eventId of result.denied) refused.add(eventId);
        failedKey.current = '';
        setError(null);
        setVersion((current) => current + 1);
      })
      .catch((cause: Error) => {
        if (cancelled) return;
        setError(cause.message);

        /*
         * One automatic retry per request, and then it stops.
         *
         * This used to be none at all, by accident: `version` was bumped only
         * on success, `inFlight` was cleared in `finally`, and the effect
         * depends on `[key, version]` — so a single failed batch left the hook
         * wedged for the rest of the session, with no path back short of
         * navigating somewhere that asked for a different set of events. On a
         * phone walking into a church hall, one dropped request is ordinary.
         *
         * It stays at one because bumping unconditionally is a hot loop
         * against Firestore, on a screen nobody is watching. After that the
         * error is surfaced and the hook waits for the caller's list to change.
         *
         * A refusal never lands here — `fetchAttendanceByEvent` returns those
         * in `denied` — so what is being retried really is a failure.
         */
        if (failedKey.current !== key) {
          failedKey.current = key;
          setVersion((current) => current + 1);
        }
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
      .map((event) => ({ event, ids: cache.get(event.id) }))
      .filter((entry): entry is { event: TallyEvent; ids: EventAttendanceIds } =>
        entry.ids !== undefined,
      )
      // This hook reads whole registers, so the set is the register and an empty
      // one really does mean nobody came. `held` stays keyed to who was checked
      // *in*: a gathering nobody remembered to check out of still happened.
      .map<EventAttendanceSnapshot>((entry) => ({
        event: entry.event,
        presentStudentIds: entry.ids.present,
        checkedOutStudentIds: entry.ids.checkedOut,
        held: entry.ids.present.size > 0,
      }));

    const unchanged =
      next.length === last.current.length &&
      next.every(
        (entry, index) =>
          entry.event === last.current[index].event &&
          entry.presentStudentIds === last.current[index].presentStudentIds &&
          entry.checkedOutStudentIds === last.current[index].checkedOutStudentIds,
      );

    if (!unchanged) last.current = next;
    return last.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, events]);

  /*
   * Narrowed to what this caller asked about, so a screen showing Friday is not
   * handed a refusal about Sunday it has no way to interpret. Identity is kept
   * stable when empty, which is the case on every screen in a deployment where
   * nobody has restricted anything.
   */
  const denied = useMemo(() => {
    if (refused.size === 0) return NO_DENIALS;
    const mine = new Set(events.map((event) => event.id).filter((id) => refused.has(id)));
    return mine.size === 0 ? NO_DENIALS : mine;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version, events]);

  return { snapshots, denied, loading, error };
}
